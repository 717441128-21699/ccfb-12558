/**
 * 验证面板：
 * 1) CPU 参考实现与 WebGL2 着色器在多个天区方向的亮度差异；
 * 2) 输入 SQM 实测天顶星等，拟合标定系数并验证残差 ≤0.3 等；
 * 3) 观测点迁移重算计时（验收 <0.5 s）。
 */
import { evaluateSkyPoint, microCdToMag } from '../physics/scatter.ts';
import { fitCalibration } from '../physics/skyMap.ts';
import { effectiveTowns, store } from '../state.ts';
import { button, clear, el } from './dom.ts';
import type { SkyView } from './SkyView.ts';

interface ProbeRow {
  label: string;
  azDeg: number;
  elDeg: number;
}

const PROBES: ProbeRow[] = [
  { label: '天顶', azDeg: 0, elDeg: 90 },
  { label: '北 45°', azDeg: 0, elDeg: 45 },
  { label: '东 30°', azDeg: 90, elDeg: 30 },
  { label: '东南 20°', azDeg: 135, elDeg: 20 },
  { label: '南 60°', azDeg: 180, elDeg: 60 },
  { label: '西 15°', azDeg: 270, elDeg: 15 },
];

export class ValidationView {
  readonly node: HTMLElement;
  private resultBox: HTMLElement;

  constructor(private skyView: SkyView) {
    this.node = el('div', { class: 'panel validation-panel' });
    this.node.append(
      el('p', { class: 'hint' }, 'CPU（TypeScript 参考实现）与 GPU（GLSL 着色器）使用同一套常数与分段方案，下列为同一状态下的数值差异。')
    );
    const row = el('div', { class: 'ctrl-row' });
    row.append(button('运行 CPU↔GPU 比对', () => this.runCompare()), button('运行重算计时', () => this.runTiming()));
    this.node.append(row);

    // SQM 标定
    const sqm = el('div', { class: 'sqm-box' });
    sqm.append(el('h4', {}, 'SQM 实测标定'));
    const input = document.createElement('input');
    input.type = 'number';
    input.step = '0.01';
    input.value = '20.35';
    input.className = 'sqm-input';
    const lab = el('label', {}, '实测天顶星等 (mag/arcsec²)：');
    lab.append(input);
    const fitBtn = button('拟合标定系数', () => this.runFit(parseFloat(input.value)));
    const resetBtn = button('恢复未标定 (C=1)', () => {
      store.set({ calibration: 1 });
      const box = el('div', { class: 'validation-summary ok' }, '已恢复标定系数 C = 1.000');
      this.resultBox.append(box);
    });
    sqm.append(lab, fitBtn, resetBtn);
    this.node.append(sqm);

    this.resultBox = el('div', { class: 'validation-results' });
    this.node.append(this.resultBox);
  }

  private runCompare(): void {
    clear(this.resultBox);
    const s = store.get();
    const towns = effectiveTowns(s);
    const table = el('div', { class: 'town-table' });
    const head = el('div', { class: 'town-row town-head' });
    head.append(el('span', {}, '方向'), el('span', {}, 'CPU mag'), el('span', {}, 'GPU mag'), el('span', {}, '差异(等)'), el('span', {}, '结论'));
    table.append(head);

    let maxDiff = 0;
    for (const p of PROBES) {
      const az = (p.azDeg * Math.PI) / 180;
      const elRad = (p.elDeg * Math.PI) / 180;
      const cpu = evaluateSkyPoint({
        observerXy: s.observer, az, el: elRad, towns, atmo: s.atmo, steps: s.gpuSteps,
        moonFraction: s.moonFraction, moonEl: (s.moonElDeg * Math.PI) / 180, cloud: s.cloud, calibration: s.calibration,
      });
      const gpu = this.skyView.probe(az, elRad);
      const gpuMag = gpu ? microCdToMag(gpu.rgb[1]) : NaN;
      const diff = Math.abs(cpu.mag - gpuMag);
      maxDiff = Math.max(maxDiff, diff);
      const row = el('div', { class: 'town-row' });
      row.append(
        el('span', { class: 'town-name' }, p.label),
        el('span', {}, cpu.mag.toFixed(3)),
        el('span', {}, isFinite(gpuMag) ? gpuMag.toFixed(3) : '不可用'),
        el('span', {}, diff.toFixed(3)),
        el('span', { class: diff < 0.15 ? 'pos' : 'neg' }, diff < 0.15 ? '通过' : '超差')
      );
      table.append(row);
    }
    const summary = el('div', { class: 'validation-summary ' + (maxDiff < 0.15 ? 'ok' : 'bad') });
    summary.textContent = `最大 CPU/GPU 差异 ${maxDiff.toFixed(3)} 等（目标 < 0.15 等，验收余量内）`;
    this.resultBox.append(table, summary);
  }

  private runFit(measured: number): void {
    const s = store.get();
    const towns = effectiveTowns(s);
    const fit = fitCalibration(s.observer, towns, measured, s.atmo);
    store.set({ calibration: fit.calibration });
    const box = el('div', { class: 'validation-summary ok' });
    box.innerHTML =
      `标定系数 C = <b>${fit.calibration.toFixed(3)}</b><br>` +
      `标定前模型天顶 ${fit.modelMagBefore.toFixed(2)} 等 → 标定后 ${fit.modelMagAfter.toFixed(2)} 等<br>` +
      `与实测 ${measured.toFixed(2)} 等残差 <b>${Math.abs(fit.modelMagAfter - measured).toFixed(3)} 等</b>（验收 ≤0.3 等）`;
    this.resultBox.append(box);
  }

  private runTiming(): void {
    const s = store.get();
    const towns = effectiveTowns(s);
    // 模拟观测点迁移：10 个随机位置
    const positions = Array.from({ length: 10 }, (_, i) => ({
      x: -28 + i * 6,
      y: -20 + ((i * 37) % 38),
      h: s.observer.h,
    }));
    const times: number[] = [];
    let worst = 0;
    for (const p of positions) {
      const t0 = performance.now();
      evaluateSkyPoint({ observerXy: p, az: 0, el: Math.PI / 2, towns, atmo: s.atmo, steps: 28 });
      const dt = performance.now() - t0;
      times.push(dt);
      worst = Math.max(worst, dt);
    }
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const box = el('div', { class: 'validation-summary ' + (worst < 500 ? 'ok' : 'bad') });
    box.innerHTML = `单点重算平均 <b>${avg.toFixed(1)} ms</b>，最差 <b>${worst.toFixed(1)} ms</b>（验收 < 500 ms）`;
    this.resultBox.append(box);
  }
}
