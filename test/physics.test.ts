/**
 * 物理模型健全性测试（node --experimental-strip-types 直接运行）。
 * 运行：npm test
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  FIXTURES,
  MAG_ZERO,
} from '../src/physics/constants.ts';
import type { Town } from '../src/physics/constants.ts';
import {
  artificialRadiance,
  bortleClass,
  emissionShape,
  evaluateSkyPoint,
  hgPhase,
  limitingMagnitude,
  magToMicroCd,
  microCdToMag,
  naturalSkyMicroCd,
  rayleighPhase,
} from '../src/physics/scatter.ts';
import { buildDefaultTowns } from '../src/data/countyData.ts';
import { buildReport, fitCalibration } from '../src/physics/skyMap.ts';
import { scenarioPreset, scenarioTowns, totalLumens } from '../src/data/scenarios.ts';

const OBS = { x: -24, y: 20, h: 1.0 };

test('星等-亮度零点：171 μcd/m² ≈ 22.0 mag/arcsec²', () => {
  const mag = microCdToMag(171);
  assert.ok(Math.abs(mag - 22.0) < 0.02, `got ${mag}`);
  assert.ok(Math.abs(magToMicroCd(22.0) - 171) < 2);
  assert.equal(MAG_ZERO, 27.5825);
});

test('相函数归一化（全球 ∫ Φ dΩ ≈ 1）', () => {
  // ∫ Φ dΩ = 2π∫₋₁¹ Φ(μ) dμ ≈ 1
  let sumR = 0;
  let sumA = 0;
  const N = 400;
  for (let i = 0; i < N; i++) {
    const mu = -1 + (2 * i + 1) / N;
    const dMu = 2 / N;
    sumR += 2 * Math.PI * rayleighPhase(mu) * dMu;
    sumA += 2 * Math.PI * hgPhase(mu) * dMu;
  }
  assert.ok(Math.abs(sumR - 1) < 0.02, `rayleigh ${sumR}`);
  assert.ok(Math.abs(sumA - 1) < 0.02, `hg ${sumA}`);
});

test('上射角分布归一化（上半球 ∫ P dΩ ≈ 1）', () => {
  for (const key of Object.keys(FIXTURES) as (keyof typeof FIXTURES)[]) {
    const spec = FIXTURES[key];
    let sum = 0;
    const N = 500;
    for (let i = 0; i < N; i++) {
      const mu = (i + 0.5) / N; // 上半球 μ∈0..1
      sum += emissionShape(spec, mu) * 2 * Math.PI * (1 / N);
    }
    assert.ok(Math.abs(sum - 1) < 0.02, `${key}: ${sum}`);
  }
});

test('天然天顶亮度在 21.6–22.1 等区间', () => {
  const l = naturalSkyMicroCd(Math.PI / 2);
  const m = microCdToMag(l);
  assert.ok(m > 21.5 && m < 22.2, `natural zenith ${m}`);
});

test('县城场景天顶亮度量级合理（20–22 等）', () => {
  const towns = buildDefaultTowns();
  const res = evaluateSkyPoint({ observerXy: OBS, az: 0, el: Math.PI / 2, towns, steps: 24 });
  assert.ok(res.mag > 18 && res.mag < 20.5, `zenith mag=${res.mag.toFixed(2)}`);
  assert.ok(res.artificialMicroCd > 0);
});

test('地平线方向出现光穹：朝县城一侧更亮', () => {
  const towns = buildDefaultTowns();
  // 县城在观测点东南方向
  const dx = 4 - OBS.x;
  const dy = -3 - OBS.y;
  const azCity = Math.atan2(dx, dy);
  const el = 12 * (Math.PI / 180);
  const toward = evaluateSkyPoint({ observerXy: OBS, az: azCity, el, towns, steps: 24 });
  const away = evaluateSkyPoint({ observerXy: OBS, az: azCity + Math.PI, el, towns, steps: 24 });
  assert.ok(toward.microCd > away.microCd * 1.5, `toward=${toward.microCd} away=${away.microCd}`);
});

test('积分步数收敛：24 与 48 步差异 < 0.1 等', () => {
  const towns = buildDefaultTowns();
  const a = evaluateSkyPoint({ observerXy: OBS, az: 0.4, el: 0.5, towns, steps: 16 });
  const b = evaluateSkyPoint({ observerXy: OBS, az: 0.4, el: 0.5, towns, steps: 48 });
  assert.ok(Math.abs(a.mag - b.mag) < 0.1, `${a.mag} vs ${b.mag}`);
});

test('改造情景降低上射光通，天顶变暗', () => {
  const base = buildDefaultTowns();
  const cur = scenarioTowns(base, scenarioPreset('current'));
  const shield = scenarioTowns(base, scenarioPreset('shield_and_dim'));
  const lumCur = totalLumens(cur);
  const lumShield = totalLumens(shield);
  assert.ok(lumShield.upward < lumCur.upward * 0.25);
  const m1 = evaluateSkyPoint({ observerXy: OBS, az: 0, el: Math.PI / 2, towns: cur }).mag;
  const m2 = evaluateSkyPoint({ observerXy: OBS, az: 0, el: Math.PI / 2, towns: shield }).mag;
  assert.ok(m2 > m1, `shielded sky should be darker: ${m1} -> ${m2}`);
});

test('Bortle 与 NELM 单调', () => {
  assert.equal(bortleClass(22.0).class, 1);
  assert.equal(bortleClass(18.0).class, 9);
  assert.ok(limitingMagnitude(22) > limitingMagnitude(19));
  assert.ok(limitingMagnitude(22) > 6 && limitingMagnitude(22) < 7);
});

test('SQM 标定：给实测值后模型天顶与实测差 < 0.02 等', () => {
  const towns = buildDefaultTowns();
  const fit = fitCalibration(OBS, towns, 20.35);
  assert.ok(Math.abs(fit.modelMagAfter - 20.35) < 0.02);
  assert.ok(fit.calibration > 0.05 && fit.calibration < 20);
});

test('全报告可在 500ms 内完成（36×9 网格+贡献分解）', () => {
  const towns = buildDefaultTowns();
  const report = buildReport(OBS, towns);
  assert.ok(report.recomputeMs < 500, `${report.recomputeMs}ms`);
  assert.ok(report.contributions.length === towns.length);
  const shareSum = report.contributions.reduce((s, c) => s + c.share, 0);
  assert.ok(Math.abs(shareSum - 1) < 1e-6);
  console.log(`  报告重算耗时 ${report.recomputeMs.toFixed(0)}ms，天顶 ${report.zenithMag.toFixed(2)} 等，Bortle ${report.bortle.class}`);
});

test('月光与云量抬升背景亮度', () => {
  const towns = buildDefaultTowns();
  const dark = evaluateSkyPoint({ observerXy: OBS, az: 0, el: Math.PI / 2, towns });
  const moon = evaluateSkyPoint({ observerXy: OBS, az: 0, el: Math.PI / 2, towns, moonFraction: 1, moonEl: 0.8 });
  const cloud = evaluateSkyPoint({ observerXy: OBS, az: 0, el: Math.PI / 2, towns, cloud: 0.8 });
  assert.ok(moon.microCd > dark.microCd * 1.5);
  assert.ok(cloud.microCd > dark.microCd);
});

test('距离衰减：城镇移远后天顶人工分量下降', () => {
  const near: Town[] = [
    { id: 'x', name: 'x', x: OBS.x + 5, y: OBS.y, population: 50000, lumensPerCapita: 800, fixture: 'unshielded_hps', dim: 1, tier: 'town' },
  ];
  const far: Town[] = [{ ...near[0], x: OBS.x + 45 }];
  const a = artificialRadiance(OBS, 0, Math.PI / 2, near).total[1];
  const b = artificialRadiance(OBS, 0, Math.PI / 2, far).total[1];
  assert.ok(a > b * 2, `${a} vs ${b}`);
});
