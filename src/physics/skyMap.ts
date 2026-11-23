/**
 * 天空亮度网格、城镇贡献分解与改造对比计算。
 * 纯函数、无 DOM 依赖，可在主线程或 Worker 中运行。
 */
import { DEFAULT_ATMOSPHERE } from './constants.ts';
import type { Town, AtmosphereParams } from './constants.ts';
import {
  artificialRadiance,
  bortleClass,
  evaluateSkyPoint,
  limitingMagnitude,
  microCdToMag,
} from './scatter.ts';
import type { RGB, SkyContribution } from './scatter.ts';

export interface ObserverPos {
  x: number;
  y: number;
  h: number;
}

export interface GridOptions {
  /** 方位角采样数 */
  azCount?: number;
  /** 仰角采样层数 */
  elRings?: number;
  steps?: number;
}

export interface SkyGridCell {
  az: number;
  el: number;
  mag: number;
  microCd: number;
  rgb: RGB;
}

export interface SkyGrid {
  cells: SkyGridCell[];
  azCount: number;
  elRings: number;
  /** 各仰角环的方位平均亮度（mag） */
  ringAverageMag: number[];
  zenith: SkyGridCell;
  /** 全天空人工辉光平均（μcd/m²，立体角加权） */
  meanArtificialMicroCd: number;
}

/**
 * 计算鱼眼全天空网格亮度（不含月/云，仅人工+天然；月相云量在渲染端叠加，
 * 报告需要时通过参数传入 evaluateSkyPoint）。
 */
export function computeSkyGrid(
  observer: ObserverPos,
  towns: Town[],
  atmo: AtmosphereParams = DEFAULT_ATMOSPHERE,
  opts: GridOptions = {},
  env: { moonFraction?: number; moonEl?: number; cloud?: number; calibration?: number } = {}
): SkyGrid {
  const azCount = opts.azCount ?? 36;
  const elRings = opts.elRings ?? 9;
  const steps = opts.steps ?? 20;
  const cells: SkyGridCell[] = [];
  const ringSum = new Array(elRings).fill(0);
  let artWeighted = 0;
  let weightSum = 0;

  for (let r = 0; r < elRings; r++) {
    // 仰角 10°..90° 分层（<10° 由渲染端外推，避免地平线数值发散）
    const el = (10 + (80 * r) / Math.max(1, elRings - 1)) * (Math.PI / 180);
    for (let a = 0; a < azCount; a++) {
      const az = (a / azCount) * 2 * Math.PI;
      const res = evaluateSkyPoint({
        observerXy: observer,
        az,
        el,
        towns,
        atmo,
        steps,
        moonFraction: env.moonFraction,
        moonEl: env.moonEl,
        cloud: env.cloud,
        calibration: env.calibration,
      });
      cells.push({ az, el, mag: res.mag, microCd: res.microCd, rgb: res.rgb });
      ringSum[r] += res.microCd;
      // 立体角权重 ∝ cos(el)
      const w = Math.cos(el);
      artWeighted += res.artificialMicroCd * w;
      weightSum += w;
    }
  }

  const ringAverageMag = ringSum.map((sum, r) => {
    const el = (10 + (80 * r) / Math.max(1, elRings - 1)) * (Math.PI / 180);
    void el;
    return microCdToMag(sum / azCount);
  });

  const zenith = evaluateSkyPoint({
    observerXy: observer,
    az: 0,
    el: Math.PI / 2,
    towns,
    atmo,
    steps: steps + 8,
    moonFraction: env.moonFraction,
    moonEl: env.moonEl,
    cloud: env.cloud,
    calibration: env.calibration,
  });

  return {
    cells,
    azCount,
    elRings,
    ringAverageMag,
    zenith: {
      az: 0,
      el: Math.PI / 2,
      mag: zenith.mag,
      microCd: zenith.microCd,
      rgb: zenith.rgb,
    },
    meanArtificialMicroCd: artWeighted / Math.max(weightSum, 1e-9),
  };
}

/* ------------------------------------------------------------------ */
/* 城镇贡献分解                                                        */
/* ------------------------------------------------------------------ */

export interface TownContribution {
  town: Town;
  distanceKm: number;
  azDeg: number;
  zenithMicroCd: number;
  rayleighMicroCd: number;
  aerosolMicroCd: number;
  share: number;
}

export function townContributions(
  observer: ObserverPos,
  towns: Town[],
  atmo: AtmosphereParams = DEFAULT_ATMOSPHERE,
  steps = 24
): TownContribution[] {
  const rows: TownContribution[] = [];
  let total = 0;
  for (const town of towns) {
    const dx = town.x - observer.x;
    const dy = town.y - observer.y;
    const d = Math.hypot(dx, dy);
    const azDeg = (Math.atan2(dx, dy) * 180) / Math.PI;
    const c: SkyContribution = artificialRadiance(
      observer,
      0,
      Math.PI / 2,
      towns,
      atmo,
      { steps, townFilter: new Set([town.id]) }
    );
    const z = c.total[1] * 1e6;
    total += z;
    rows.push({
      town,
      distanceKm: d,
      azDeg: (azDeg + 360) % 360,
      zenithMicroCd: z,
      rayleighMicroCd: c.rayleigh[1] * 1e6,
      aerosolMicroCd: c.aerosol[1] * 1e6,
      share: 0,
    });
  }
  for (const r of rows) r.share = total > 0 ? r.zenithMicroCd / total : 0;
  rows.sort((a, b) => b.zenithMicroCd - a.zenithMicroCd);
  return rows;
}

/* ------------------------------------------------------------------ */
/* 报告汇总                                                            */
/* ------------------------------------------------------------------ */

export interface SkyReport {
  zenithMag: number;
  zenithMicroCd: number;
  bortle: ReturnType<typeof bortleClass>;
  nelm: number;
  horizonMeanMag: number;
  meanArtificialMicroCd: number;
  naturalZenithMicroCd: number;
  artificialZenithMicroCd: number;
  rayleighShare: number;
  aerosolShare: number;
  grid: SkyGrid;
  contributions: TownContribution[];
  recomputeMs: number;
}

export function buildReport(
  observer: ObserverPos,
  towns: Town[],
  atmo: AtmosphereParams = DEFAULT_ATMOSPHERE,
  env: { moonFraction?: number; moonEl?: number; cloud?: number; calibration?: number } = {}
): SkyReport {
  const t0 = performance.now();
  const grid = computeSkyGrid(observer, towns, atmo, { azCount: 36, elRings: 9, steps: 20 }, env);
  const contributions = townContributions(observer, towns, atmo, 22);

  // 瑞利/气溶胶占比（天顶，全部城镇）
  const split = artificialRadiance(observer, 0, Math.PI / 2, towns, atmo, { steps: 28 });
  const rSum = split.rayleigh[1] * 1e6;
  const aSum = split.aerosol[1] * 1e6;
  const splitTotal = rSum + aSum;

  const t1 = performance.now();

  return {
    zenithMag: grid.zenith.mag,
    zenithMicroCd: grid.zenith.microCd,
    bortle: bortleClass(grid.zenith.mag),
    nelm: limitingMagnitude(grid.zenith.mag),
    horizonMeanMag: grid.ringAverageMag[0],
    meanArtificialMicroCd: grid.meanArtificialMicroCd,
    naturalZenithMicroCd: grid.zenith.microCd - splitTotal * (env.calibration ?? 1),
    artificialZenithMicroCd: splitTotal * (env.calibration ?? 1),
    rayleighShare: splitTotal > 0 ? rSum / splitTotal : 0,
    aerosolShare: splitTotal > 0 ? aSum / splitTotal : 0,
    grid,
    contributions,
    recomputeMs: t1 - t0,
  };
}

/* ------------------------------------------------------------------ */
/* 地图热力网格：在规则 XY 格点上算天顶人工亮度（供 Canvas 填色）       */
/* ------------------------------------------------------------------ */

export interface HeatPoint {
  x: number;
  y: number;
  /** 天顶总亮度 mag/arcsec² */
  mag: number;
  microCd: number;
}

export function computeMapHeat(
  extent: { minX: number; maxX: number; minY: number; maxY: number },
  nx: number,
  ny: number,
  towns: Town[],
  atmo: AtmosphereParams = DEFAULT_ATMOSPHERE,
  calibration = 1
): HeatPoint[] {
  const out: HeatPoint[] = [];
  const steps = 14; // 地图用较低步数，整体仍在百毫秒内
  for (let j = 0; j < ny; j++) {
    const y = extent.maxY - (j / (ny - 1)) * (extent.maxY - extent.minY);
    for (let i = 0; i < nx; i++) {
      const x = extent.minX + (i / (nx - 1)) * (extent.maxX - extent.minX);
      const res = evaluateSkyPoint({
        observerXy: { x, y, h: 0 },
        az: 0,
        el: Math.PI / 2,
        towns,
        atmo,
        steps,
        calibration,
      });
      out.push({ x, y, mag: res.mag, microCd: res.microCd });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* SQM 标定：给定实测天顶星等，求乘性标定系数                          */
/* ------------------------------------------------------------------ */

/**
 * 由实测 SQM 天顶星等反推标定系数 C：
 *   L_meas = 10^((Z-m_meas)/2.5)，C = (L_meas - L_nat) / L_art_model
 */
export function fitCalibration(
  observer: ObserverPos,
  towns: Town[],
  measuredZenithMag: number,
  atmo: AtmosphereParams = DEFAULT_ATMOSPHERE
): { calibration: number; modelMagBefore: number; modelMagAfter: number } {
  const model = evaluateSkyPoint({ observerXy: observer, az: 0, el: Math.PI / 2, towns, atmo, steps: 32 });
  const measured = 10 ** ((27.5825 - measuredZenithMag) / 2.5);
  const artModel = model.artificialMicroCd;
  const natModel = model.naturalMicroCd;
  const calibration = Math.max(0.05, (measured - natModel) / Math.max(artModel, 1e-6));
  const after = evaluateSkyPoint({
    observerXy: observer,
    az: 0,
    el: Math.PI / 2,
    towns,
    atmo,
    steps: 32,
    calibration,
  });
  return { calibration, modelMagBefore: model.mag, modelMagAfter: after.mag };
}
