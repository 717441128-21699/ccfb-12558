/**
 * 夜空辉光单次散射模型（CPU 参考实现）
 *
 * 与 GLSL 着色器 src/webgl/shaders.ts 使用逐行对应的同一套公式与常数，
 * 验证面板比较两边输出（目标 < 0.1 等），报告与标定只用本文件的 CPU 结果。
 *
 * 参考：Garstang (1986, 1989)、Cinzano, Falchi & Elvidge (2001, 2004)。
 */
import {
  AEROSOL_RATIO,
  ANGSTROM_ALPHA,
  ATM_TOP_H,
  BETA_R0,
  DEFAULT_ATMOSPHERE,
  EARTH_RADIUS,
  FIXTURES,
  FULL_MOON_ZENITH_MAG,
  H_RAYLEIGH,
  LAMBDA_V,
  MAG_ZERO,
  MIE_G,
  NATURAL_HORIZON_MAG,
  NATURAL_ZENITH_MAG,
  RAYLEIGH_LAMBDA_POWER,
  WAVELENGTHS,
} from './constants.ts';
import type { AtmosphereParams, FixtureSpec, Town } from './constants.ts';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** 一次视线积分的 RGB 结果（cd/m²） */
export type RGB = [number, number, number];

/* ------------------------------------------------------------------ */
/* 波长散射比（相对 550nm V 波段）                                     */
/* ------------------------------------------------------------------ */

const RATIOS = WAVELENGTHS.map((w) => ({
  rayleigh: (LAMBDA_V / w) ** RAYLEIGH_LAMBDA_POWER,
  aerosol: (LAMBDA_V / w) ** ANGSTROM_ALPHA,
}));

/* ------------------------------------------------------------------ */
/* 上射光角分布 P(ψ)：相对光源天顶 ψ，归一化使 ∫ P dΩ = 1              */
/* ------------------------------------------------------------------ */

/**
 * 上射光角分布 P(ψ)：相对光源天顶 ψ，归一化使上半球 ∫ P dΩ = 1。
 * 光源强度 I(ψ) = F_up · P(ψ)，保证 ∫ I dΩ = F_up（能量守恒）。
 */

/** 多项式在 μ∈[0,1] 的积分：2/4 + 0.4/3 + 0.32/2 + 0.16 = 0.953333… */
const GARSTANG_POLY_INTEGRAL = 0.9533333333333332;

/** Garstang (1986) 城市上射光角分布：直接上射 + 地面反射混合 */
function garstangShape(cosPsi: number): number {
  const c = Math.max(0, cosPsi);
  const raw = 2 * c ** 3 + 0.4 * c ** 2 + 0.32 * c + 0.16;
  return raw / (2 * Math.PI * GARSTANG_POLY_INTEGRAL);
}

/** 全截光灯具：上射光仅来自地面反射 → 朗伯余弦分布 P=μ/π */
function lambertShape(cosPsi: number): number {
  return Math.max(0, cosPsi) / Math.PI;
}

export function emissionShape(spec: FixtureSpec, cosPsi: number): number {
  return spec.shape === 'lambert' ? lambertShape(cosPsi) : garstangShape(cosPsi);
}

/* ------------------------------------------------------------------ */
/* 几何与光学厚度                                                      */
/* ------------------------------------------------------------------ */

/** 视线方向（方位角 az 弧度，北=0 顺时针；仰角 el 弧度） */
export function rayDirection(az: number, el: number): Vec3 {
  const ce = Math.cos(el);
  return { x: Math.sin(az) * ce, y: Math.cos(az) * ce, z: Math.sin(el) };
}

/** 海平面瑞利散射系数（V 波段，1/km） */
export function betaRayleigh(atmo: AtmosphereParams): number {
  void atmo;
  return BETA_R0;
}

/** 海平面气溶胶散射系数（V 波段，1/km） */
export function betaAerosol(atmo: AtmosphereParams): number {
  return atmo.clarity * BETA_R0 * AEROSOL_RATIO;
}

/**
 * 光源 T → 散射点 P 直线光路的光学厚度（指数大气解析积分，平坦近似）。
 * τ = β·H/sinθ · (exp(-hT/H) - exp(-hP/H))
 */
export function slantOpticalDepth(
  beta0: number,
  scaleH: number,
  hT: number,
  hP: number,
  sinTheta: number
): number {
  const s = Math.max(sinTheta, 0.02);
  return (beta0 * scaleH * (Math.exp(-hT / scaleH) - Math.exp(-hP / scaleH))) / s;
}

/**
 * 曲面地球遮挡：光源（水平距离 d，海拔 hT）与视线点 P（沿仰角 el 的弧长 s）
 * 连线是否被地表截断。
 *
 * 2D 切面（x=朝光源的切向，z=径向），地心 C=(0,0)：
 *   观测点 O=(0, R+hO)，光源 T=(d, R+hT)，P=(s·cos el, R+hO+s·sin el)。
 * 求线段 TP 上到 C 的最近距离，与 R 比较。
 */
export function lineOfSightVisible(d: number, s: number, el: number, hT: number, hO = 0): boolean {
  const R = EARTH_RADIUS;
  const tx = d;
  const tz = R + hT;
  const px = s * Math.cos(el);
  const pz = R + hO + s * Math.sin(el);
  const ex = px - tx;
  const ez = pz - tz;
  const len2 = ex * ex + ez * ez;
  if (len2 < 1e-9) return true;
  // 参数 u∈[0,1]：Q(u)=T+u·E，|Q|² 最小值位置
  let u = -(tx * ex + tz * ez) / len2;
  u = Math.max(0, Math.min(1, u));
  const qx = tx + u * ex;
  const qz = tz + u * ez;
  return Math.hypot(qx, qz) >= R - 0.02;
}

/* ------------------------------------------------------------------ */
/* 相函数（对立体角平均归一化）                                        */
/* ------------------------------------------------------------------ */

/** 瑞利相函数（全球归一化 ∫ Φ dΩ = 1） */
export function rayleighPhase(cosTheta: number): number {
  return (3 / (16 * Math.PI)) * (1 + cosTheta * cosTheta);
}

/** Henyey-Greenstein 米氏相函数（全球归一化 ∫ Φ dΩ = 1） */
export function hgPhase(cosTheta: number, g: number = MIE_G): number {
  const g2 = g * g;
  const denom = 1 + g2 - 2 * g * cosTheta;
  return (1 - g2) / (4 * Math.PI * denom * Math.sqrt(denom));
}

/* ------------------------------------------------------------------ */
/* 城镇有效上射光通（流明）                                            */
/* ------------------------------------------------------------------ */

export function townUpwardLumens(town: Town): number {
  const spec = FIXTURES[town.fixture];
  return town.population * town.lumensPerCapita * spec.upFraction * spec.lumenFactor * town.dim;
}

export function townFixture(town: Town): FixtureSpec {
  return FIXTURES[town.fixture];
}

/* ------------------------------------------------------------------ */
/* 单次散射主积分                                                      */
/* ------------------------------------------------------------------ */

export interface SkySampleOptions {
  steps?: number;
  /** 只计算指定城镇（贡献分解），null=全部 */
  townFilter?: Set<string> | null;
}

export interface SkyContribution {
  total: RGB;
  rayleigh: RGB;
  aerosol: RGB;
}

const KM = 1000;

/**
 * 按高度分层的非均匀积分分段：近地（气溶胶层）密、高空疏。
 * 高度断点 (km)，每个区间在弧长上等分若干段，保证低仰角长路径下近地采样仍充分。
 * GLSL 着色器通过 uHBreaks/uSub 复用同一方案，确保 CPU/GPU 同构。
 */
export const HEIGHT_BREAKS = [0.15, 0.5, 1.2, 2.5, 5, 9, 16, 28, 45, 60];
const BAND_WEIGHTS = [3, 3, 3, 2.5, 2, 1.6, 1.2, 1, 0.8];

/** 每个高度带的积分段数（与 GLSL uSub 对应） */
export function bandSubCounts(steps: number): number[] {
  const wSum = BAND_WEIGHTS.reduce((a, b) => a + b, 0);
  return BAND_WEIGHTS.map((w) => Math.max(2, Math.round((w / wSum) * steps * 2.2)));
}

interface Segment {
  s0: number;
  s1: number;
  ds: number;
}

function buildSegments(hObs: number, sinEl: number, steps: number): Segment[] {
  const subs = bandSubCounts(steps);
  const segs: Segment[] = [];
  const sMax = (ATM_TOP_H - hObs) / sinEl;
  for (let i = 0; i < HEIGHT_BREAKS.length - 1; i++) {
    const hLo = Math.max(HEIGHT_BREAKS[i], hObs);
    const hHi = HEIGHT_BREAKS[i + 1];
    if (hHi <= hObs) continue;
    const sBeg = (hLo - hObs) / sinEl;
    const sEnd = Math.min((hHi - hObs) / sinEl, sMax);
    if (sEnd <= sBeg) continue;
    const n = subs[i];
    const ds = (sEnd - sBeg) / n;
    for (let k = 0; k < n; k++) segs.push({ s0: sBeg + k * ds, s1: sBeg + (k + 1) * ds, ds });
  }
  return segs;
}

/**
 * 观测点沿 (az, el) 方向的人工辉光亮度（RGB, cd/m²）。
 * L = Σ_T ∫ [βR·ΦR + βA·ΦA] · I_T(ψ)/r² · exp(-τ_TP) · exp(-τ_PO) ds
 */
export function artificialRadiance(
  observerXy: { x: number; y: number; h: number },
  az: number,
  el: number,
  towns: Town[],
  atmo: AtmosphereParams = DEFAULT_ATMOSPHERE,
  opts: SkySampleOptions = {}
): SkyContribution {
  const steps = opts.steps ?? 24;
  const elSafe = Math.max(el, 0.002);
  const ray = rayDirection(az, elSafe);
  const bR0 = betaRayleigh(atmo);
  const bA0 = betaAerosol(atmo);
  const hObs = observerXy.h + atmo.observerHeight;

  const total: RGB = [0, 0, 0];
  const rayPart: RGB = [0, 0, 0];
  const aerPart: RGB = [0, 0, 0];

  const sinEl = Math.max(Math.sin(elSafe), 0.002);
  const segments = buildSegments(hObs, sinEl, steps);

  const tauRayCum: RGB = [0, 0, 0];
  const tauAerCum: RGB = [0, 0, 0];

  for (const seg of segments) {
    const { s0, s1, ds } = seg;
    const sMid = 0.5 * (s0 + s1);
    const hMid = hObs + ray.z * sMid;
    if (hMid < 0) break;

    const densR = Math.exp(-hMid / H_RAYLEIGH);
    const densA = Math.exp(-hMid / atmo.hAerosol);

    const h0 = Math.max(hObs + ray.z * s0, 0);
    const h1 = Math.max(hObs + ray.z * s1, 0);
    for (let c = 0; c < 3; c++) {
      tauRayCum[c] += 0.5 * (Math.exp(-h0 / H_RAYLEIGH) + Math.exp(-h1 / H_RAYLEIGH)) * bR0 * RATIOS[c].rayleigh * ds;
      tauAerCum[c] += 0.5 * (Math.exp(-h0 / atmo.hAerosol) + Math.exp(-h1 / atmo.hAerosol)) * bA0 * RATIOS[c].aerosol * ds;
    }

    for (const town of towns) {
      if (opts.townFilter && !opts.townFilter.has(town.id)) continue;
      const dx = town.x - observerXy.x;
      const dy = town.y - observerXy.y;
      const d = Math.hypot(dx, dy);
      if (d < 0.05) continue;

      const px = observerXy.x + ray.x * sMid;
      const py = observerXy.y + ray.y * sMid;
      const tdx = px - town.x;
      const tdy = py - town.y;
      const horizTP = Math.hypot(tdx, tdy);
      const rise = hMid;
      const r2 = horizTP * horizTP + rise * rise;
      if (r2 < 0.01) continue;
      const r = Math.sqrt(r2);
      const sinTheta = rise / r;

      // T–P 竖直平面内的有效仰角（P 与 T 一般不在视线方位平面上）
      const elTP = Math.atan2(rise, horizTP);
      if (!lineOfSightVisible(d, r, elTP, 0, hObs)) continue;

      // P→T 方向，散射角 = 视线方向 与 P→T 夹角
      const dirTP: Vec3 = { x: tdx / r, y: tdy / r, z: -rise / r };
      const cosScat = ray.x * dirTP.x + ray.y * dirTP.y + ray.z * dirTP.z;
      const phiR = rayleighPhase(cosScat);
      const phiA = hgPhase(cosScat);

      const cosPsi = rise / r;
      const spec = FIXTURES[town.fixture];
      const pShape = emissionShape(spec, cosPsi);
      const fUp = townUpwardLumens(town);
      // I(ψ) = F_up·P(ψ)，单位 cd；RGB 以 G(V) 为测光基准
      const iV = fUp * pShape;
      const iRGB: RGB = [iV * spec.rgb[0], iV, iV * spec.rgb[2]];

      const geom = Math.max(sinTheta, 0.02);
      for (let c = 0; c < 3; c++) {
        const tauTP_R = slantOpticalDepth(bR0 * RATIOS[c].rayleigh, H_RAYLEIGH, 0, hMid, geom);
        const tauTP_A = slantOpticalDepth(bA0 * RATIOS[c].aerosol, atmo.hAerosol, 0, hMid, geom);
        const extTP = Math.exp(-(tauTP_R + tauTP_A));
        const extPO = Math.exp(-(tauRayCum[c] + tauAerCum[c]));
        const invR2 = 1 / (r2 * KM * KM);

        const dRay = bR0 * RATIOS[c].rayleigh * densR * phiR;
        const dAer = bA0 * RATIOS[c].aerosol * densA * phiA;
        const common = iRGB[c] * invR2 * extTP * extPO * ds * KM;
        const cR = common * dRay;
        const cA = common * dAer;
        total[c] += cR + cA;
        rayPart[c] += cR;
        aerPart[c] += cA;
      }
    }
  }

  return { total, rayleigh: rayPart, aerosol: aerPart };
}

/* ------------------------------------------------------------------ */
/* 星等换算、天然夜空、月光、云量                                      */
/* ------------------------------------------------------------------ */

export function magToMicroCd(mag: number): number {
  return 10 ** ((MAG_ZERO - mag) / 2.5);
}

export function microCdToMag(microCd: number): number {
  return MAG_ZERO - 2.5 * Math.log10(Math.max(microCd, 1e-9));
}

/** 天然夜空（气辉+黄道光+累积恒星背景），经验仰角剖面，μcd/m² */
export function naturalSkyMicroCd(el: number): number {
  const zen = magToMicroCd(NATURAL_ZENITH_MAG);
  const sinEl = Math.max(Math.sin(el), 0.02);
  const vanRhijn = 1 / Math.sqrt(sinEl * sinEl + 0.08);
  const horizon = magToMicroCd(NATURAL_HORIZON_MAG) * Math.exp(-Math.max(el, 0) / 0.12);
  return zen * vanRhijn + horizon;
}

/**
 * 月光背景抬升（μcd/m²，经验模型）。
 * @param fraction 月面照亮比例 0..1
 * @param moonEl 月亮仰角弧度，低于地平返回 0
 */
export function moonlightMicroCd(fraction: number, moonEl: number): number {
  if (fraction <= 0.001 || moonEl <= 0) return 0;
  const sinEl = Math.max(Math.sin(moonEl), 0.03);
  const airmass = 1 / sinEl;
  const zen = magToMicroCd(FULL_MOON_ZENITH_MAG);
  const phase = fraction ** 1.5;
  return zen * phase * Math.exp(-0.15 * (airmass - 1)) * (1 / Math.sqrt(sinEl * sinEl + 0.1));
}

/** 云量调制：云底反射增强人工辉光、衰减天体背景 */
export function cloudModulation(
  coverage: number,
  artificial: number
): { artificial: number; celestialTransmission: number } {
  const c = Math.max(0, Math.min(1, coverage));
  const gain = 1 + 1.85 * c * c;
  return {
    artificial: artificial * gain,
    celestialTransmission: Math.exp(-2.2 * c),
  };
}

/* ------------------------------------------------------------------ */
/* 综合天空亮度                                                        */
/* ------------------------------------------------------------------ */

export interface SkyPointInput {
  observerXy: { x: number; y: number; h: number };
  az: number;
  el: number;
  towns: Town[];
  atmo?: AtmosphereParams;
  moonFraction?: number;
  moonEl?: number;
  cloud?: number;
  /** SQM 标定系数（人工分量乘性修正），默认 1 */
  calibration?: number;
  steps?: number;
}

export interface SkyPointResult {
  microCd: number;
  mag: number;
  artificialMicroCd: number;
  naturalMicroCd: number;
  moonMicroCd: number;
  rgb: RGB;
}

export function evaluateSkyPoint(input: SkyPointInput): SkyPointResult {
  const atmo = input.atmo ?? DEFAULT_ATMOSPHERE;
  const calib = input.calibration ?? 1;
  const art = artificialRadiance(input.observerXy, input.az, input.el, input.towns, atmo, {
    steps: input.steps ?? 24,
  });
  const artV = art.total[1] * 1e6 * calib;
  const nat = naturalSkyMicroCd(input.el);
  const moon = moonlightMicroCd(input.moonFraction ?? 0, input.moonEl ?? -1);
  const cloud = cloudModulation(input.cloud ?? 0, artV);

  const celestial = (nat + moon) * cloud.celestialTransmission;
  const totalArt = cloud.artificial;
  const total = totalArt + celestial;

  // 彩色：V(G) 锚定测光，R/B 由散射谱权重带出，天然背景略偏冷
  const artScale = totalArt / Math.max(artV, 1e-12);
  const rgb: RGB = [
    art.total[0] * 1e6 * calib * artScale + celestial * 0.92,
    total,
    art.total[2] * 1e6 * calib * artScale + celestial * 1.12,
  ];

  return {
    microCd: total,
    mag: microCdToMag(total),
    artificialMicroCd: totalArt,
    naturalMicroCd: nat * cloud.celestialTransmission,
    moonMicroCd: moon * cloud.celestialTransmission,
    rgb,
  };
}

/* ------------------------------------------------------------------ */
/* Bortle 分级与裸眼极限星等                                           */
/* ------------------------------------------------------------------ */

export interface BortleInfo {
  class: number;
  label: string;
  description: string;
}

interface BortleRow {
  minMag: number;
  cls: number;
  label: string;
  desc: string;
}

const BORTLE_TABLE: BortleRow[] = [
  { minMag: 21.9, cls: 1, label: '极暗夜空', desc: '黄道光、对日照清晰，木星/金星影响暗适应，肉眼可见 M33' },
  { minMag: 21.7, cls: 2, label: '典型暗夜', desc: '气辉可见，夏季银河显现细节，近地平线云仅微亮' },
  { minMag: 21.5, cls: 3, label: '乡村夜空', desc: '银河有结构，地平线略亮，M15/M33 需一定高度' },
  { minMag: 21.3, cls: 4, label: '乡村/郊区过渡', desc: '银河仍可观，地平线多方向有光穹，M31 可见 M33 勉强' },
  { minMag: 20.8, cls: 5, label: '郊区夜空', desc: '银河在头顶褪色，四季光穹明显，M44 难辨' },
  { minMag: 20.3, cls: 6, label: '亮郊区', desc: '银河仅天顶可见，地平 35° 内发灰，M22 勉强可见' },
  { minMag: 19.5, cls: 7, label: '郊区/城市过渡', desc: '银河不可见，全天灰黄，主要星座结构弱化' },
  { minMag: 18.5, cls: 8, label: '城市夜空', desc: '仅亮星与主要星座可见，天空发橙/白光' },
  { minMag: -Infinity, cls: 9, label: '亮城市内环', desc: '仅最亮恒星可见，天顶亦明亮' },
];

export function bortleClass(mag: number): BortleInfo {
  for (const row of BORTLE_TABLE) {
    if (mag >= row.minMag) return { class: row.cls, label: row.label, description: row.desc };
  }
  return { class: 9, label: '亮城市内环', description: '仅最亮恒星可见，天顶亦明亮' };
}

/** 裸眼极限星等 NELM（Bortle 经验线性拟合，22 等≈6.5，19 等≈5.0，17 等≈4） */
export function limitingMagnitude(mag: number): number {
  const nelm = 0.52 * mag - 4.9;
  return Math.max(2.5, Math.min(7.5, nelm));
}
