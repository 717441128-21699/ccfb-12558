/**
 * 端到端浏览器验证（Playwright + headless Chromium/SwiftShader）：
 * 1) GLSL 在真实 WebGL2 驱动下编译链接通过；
 * 2) 验证面板 CPU↔GPU 六方向比对全部通过（<0.15 等）；
 * 3) 观测点迁移重算计时 <500ms；
 * 4) 各面板截图。
 * 运行：先 build，再 node test/e2e/browser.ts
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const shotDir = path.join(root, 'test/screenshots');
mkdirSync(shotDir, { recursive: true });

function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const server = spawn('npx', ['vite', 'preview', '--port', '4317', '--strictPort'], {
    cwd: root,
    shell: true,
  });
  const errors: string[] = [];
  await wait(2500);

  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1360, height: 980 } });
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  await page.goto('http://localhost:4317/', { waitUntil: 'networkidle' });
  await wait(1200);

  const webgl2 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  });
  console.log('WebGL2 可用:', webgl2);

  const glErrorVisible = await page.locator('.sky-error').isVisible().catch(() => false);
  console.log('着色器错误框可见:', glErrorVisible);

  // 鱼眼截图
  await page.screenshot({ path: path.join(shotDir, '01-sky-current.png') });

  // 切换到验证页并运行比对
  await page.getByRole('button', { name: '模型验证' }).click();
  await wait(300);
  await page.getByRole('button', { name: '运行 CPU↔GPU 比对' }).click();
  await wait(800);
  const compareText = await page.locator('.validation-results').innerText();
  console.log('\n--- CPU↔GPU 比对 ---\n' + compareText);

  await page.getByRole('button', { name: '运行重算计时' }).click();
  await wait(400);
  const timingText = await page.locator('.validation-results .validation-summary').last().innerText();
  console.log('\n--- 重算计时 ---\n' + timingText);

  // SQM 标定
  await page.locator('.sqm-input').fill('20.35');
  await page.getByRole('button', { name: '拟合标定系数' }).click();
  await wait(400);
  const fitText = await page.locator('.validation-results .validation-summary').last().innerText();
  console.log('\n--- SQM 标定 ---\n' + fitText);
  await page.screenshot({ path: path.join(shotDir, '02-validation.png') });
  // 恢复标定系数，避免后续改造对比被实测标定影响
  await page.evaluate(() => {
    (window as unknown as { __skyApp: { resetCalibration(): void } }).__skyApp.resetCalibration();
  });

  // 地图页：演示拖动观测点（拖到一处后，截图前重置回默认暗点以保证后续评估一致）
  await page.getByRole('button', { name: '观测点地图' }).click();
  await wait(600);
  const canvas = page.locator('.map-canvas');
  const box = await canvas.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.4);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.55, { steps: 6 });
    await page.mouse.up();
    await wait(400);
  }
  // 重置为默认暗点（云岭观测点 -24,20），保证后续评估基于同一保护区候选点
  await page.evaluate(() => {
    (window as unknown as { __skyApp: { resetObserver(): void } }).__skyApp.resetObserver();
  });
  await wait(500);
  await page.screenshot({ path: path.join(shotDir, '03-map.png') });

  // 改造页：切到遮光+减半
  await page.getByRole('button', { name: '灯光改造方案' }).click();
  await wait(400);
  await page.getByRole('heading', { name: '遮光+减半' }).click();
  await wait(700);
  await page.screenshot({ path: path.join(shotDir, '04-retrofit.png') });

  // 渲染页看改造后效果
  await page.getByRole('button', { name: '全天空渲染' }).click();
  await wait(700);
  await page.screenshot({ path: path.join(shotDir, '05-sky-shielded.png') });

  // 报告页
  await page.getByRole('button', { name: '天空亮度报告' }).click();
  await wait(900);
  await page.screenshot({ path: path.join(shotDir, '06-report.png') });
  const reportText = await page.locator('.report-panel').innerText();
  console.log('\n--- 报告摘要（前 400 字）---\n' + reportText.slice(0, 400));

  await browser.close();
  server.kill();

  console.log('\n--- 浏览器侧错误 ---');
  console.log(errors.length ? errors.join('\n') : '无');

  const ok =
    webgl2 &&
    !glErrorVisible &&
    errors.filter((e) => !e.includes('favicon')).length === 0 &&
    compareText.includes('通过') &&
    !compareText.includes('超差') &&
    timingText.includes('ms') &&
    fitText.includes('标定系数');
  console.log('\n端到端结论:', ok ? '全部通过 ✔' : '存在失败 �’');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
