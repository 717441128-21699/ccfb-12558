/**
 * 物理常数与模型参数（Garstang 1986/1989, Cinzano et al. 2001/2004 单次散射模型）
 *
 * 单位约定：距离 km；亮度内部计算为 cd/km²，输出时 ×1e-6 得 cd/m²。
 * 光谱：RGB 三通道（620/550/450 nm），星等与 SQM 数取 V 波段（G 通道，550 nm）。
 */

export const KM_TO_M = 1000;

/** 地球半径 (km) */
export const EARTH_RADIUS = 6371;
/** 积分大气顶高度 (km)，超过此高度散射可忽略 */
export const ATM_TOP_H = 60;

/** 瑞利（分子）大气标高 (km)，Garstang 标准值 8.0 */
export const H_RAYLEIGH = 8.0;
/** 气溶胶标高 (km)，Garstang 标准值 1.5 */
export const H_AEROSOL = 1.5;

/**
 * 海平面 V 波段（550nm）瑞利体积散射系数 (1/km)。
 * τ_R = βR0·H_R ≈ 0.094，与标准晴空 V 波段分子消光 ~0.1 一致。
 */
export const BETA_R0 = 0.0117;
/**
 * Garstang 清晰度 K 与气溶胶散射系数的换算因子：
 * βA0 = K · βR0 · 11.11（Garstang 1986, Cinzano 2004 eq.17）
 * K=1 代表一般清晰度大气（τ_a≈0.20），K=0.5 较通透。
 */
export const AEROSOL_RATIO = 11.11;
/** 米氏/Henyey-Greenstein 不对称因子，Garstang 取 0.6（前向散射为主） */
export const MIE_G = 0.6;
/** 气溶胶 Angstrom 波长指数 */
export const ANGSTROM_ALPHA = 1.0;
/** 瑞利 λ⁻⁴ 指数 */
export const RAYLEIGH_LAMBDA_POWER = 4.0;

/** 三通道中心波长 (nm) */
export const WAVELENGTHS = [620, 550, 450] as const;
/** V 波段参考波长 */
export const LAMBDA_V = 550;

/**
 * SQM/V 波段星等换算：m = MAG_ZERO - 2.5·log10(L_μcd_m2)
 * 171 μcd/m² ↔ 22.0 mag/arcsec²（Garstang 2002 零点）
 */
export const MAG_ZERO = 27.5825;
/** 天然暗夜天顶亮度（mag/arcsec²），Cinzano 2004 标定 21.74；取 21.9 为一般乡村洁净夜空 */
export const NATURAL_ZENITH_MAG = 21.9;
/** 天然地平线辉光经验附加项（mag/arcsec²，大气气辉/黄道光累积） */
export const NATURAL_HORIZON_MAG = 19.8;

/** 满月时天顶夜空亮度（mag/arcsec²，经验值，SQM 实测约 17.5–18.5） */
export const FULL_MOON_ZENITH_MAG = 18.0;

/** 灯具类型 */
export type FixtureType =
  | 'unshielded_hps' // 无罩高压钠灯（存量）
  | 'partial_led' // 半截光 LED
  | 'cool_led_open' // 无罩冷白光 LED（蓝光风险最高）
  | 'full_cutoff_led' // 全截光暖白 LED
  | 'full_cutoff_warm'; // 全截光 2700K 暖色 LED（最佳实践）

export interface FixtureSpec {
  label: string;
  /** 向上光通占比 F（含地面反射回天空部分） */
  upFraction: number;
  /** 相关色温 K */
  cct: number;
  /** 出射角分布形态：garstang=直接上射+反射混合；lambert=仅地面反射的余弦分布 */
  shape: 'garstang' | 'lambert';
  /** 相对光输出（改造时若换灯可能改变总流明） */
  lumenFactor: number;
  /** 光谱 RGB 相对权重（G=1 对应测光 V 波段） */
  rgb: [number, number, number];
}

export const FIXTURES: Record<FixtureType, FixtureSpec> = {
  unshielded_hps: {
    label: '无罩高压钠灯',
    upFraction: 0.12, // Garstang F(c), c≈0.15
    cct: 2200,
    shape: 'garstang',
    lumenFactor: 1.0,
    rgb: [1.08, 0.62, 0.07],
  },
  partial_led: {
    label: '半截光 LED 4000K',
    upFraction: 0.08,
    cct: 4000,
    shape: 'garstang',
    lumenFactor: 0.95,
    rgb: [1.0, 0.82, 0.48],
  },
  cool_led_open: {
    label: '无罩冷白 LED 5700K',
    upFraction: 0.15,
    cct: 5700,
    shape: 'garstang',
    lumenFactor: 1.05,
    rgb: [0.95, 0.95, 1.0],
  },
  full_cutoff_led: {
    label: '全截光 LED 3000K',
    upFraction: 0.03, // ULR<1%，加地面反射约 2–3%
    cct: 3000,
    shape: 'lambert',
    lumenFactor: 0.9,
    rgb: [1.04, 0.78, 0.34],
  },
  full_cutoff_warm: {
    label: '全截光暖 LED 2700K',
    upFraction: 0.025,
    cct: 2700,
    shape: 'lambert',
    lumenFactor: 0.88,
    rgb: [1.06, 0.72, 0.26],
  },
};

/** 城镇规模分级（用于自行编制的县域灯光数据） */
export type TownTier = 'county_seat' | 'central_town' | 'town' | 'village';

export interface Town {
  id: string;
  name: string;
  /** 地图坐标 (km)，x=东向，y=北向 */
  x: number;
  y: number;
  population: number;
  /** 人均光通量 (lm/人) */
  lumensPerCapita: number;
  fixture: FixtureType;
  /** 本地调光系数 0..1（1=全开） */
  dim: number;
  tier: TownTier;
}

export interface AtmosphereParams {
  /** Garstang 清晰度 K（0.5 通透 / 1 一般 / 2 浑浊） */
  clarity: number;
  /** 气溶胶标高覆盖（默认 1.5km） */
  hAerosol: number;
  /** 观测点海拔 (km) */
  observerHeight: number;
}

export const DEFAULT_ATMOSPHERE: AtmosphereParams = {
  clarity: 1.0,
  hAerosol: H_AEROSOL,
  observerHeight: 0.0,
};

/** 改造情景 */
export type ScenarioId = 'current' | 'half_brightness' | 'full_shield' | 'shield_and_dim';

export interface ScenarioSpec {
  id: ScenarioId;
  label: string;
  description: string;
}

export const SCENARIOS: ScenarioSpec[] = [
  { id: 'current', label: '现状灯具', description: '维持当前无罩钠灯/冷白 LED 与全开亮度' },
  { id: 'half_brightness', label: '亮度减半', description: '所有灯具夜间调光至 50%，灯具不变' },
  { id: 'full_shield', label: '全遮光改造', description: '统一更换为全截光 3000K 暖白 LED，消除直接上射光' },
  { id: 'shield_and_dim', label: '遮光+减半', description: '全截光暖白 LED 并整体调光 50%（推荐方案）' },
];

/** 波长散射比（相对 550nm），在启动时计算一次 */
export function wavelengthScatterRatios(): { rayleigh: number[]; aerosol: number[] } {
  const rayleigh = WAVELENGTHS.map((w) => (LAMBDA_V / w) ** RAYLEIGH_LAMBDA_POWER);
  const aerosol = WAVELENGTHS.map((w) => (LAMBDA_V / w) ** ANGSTROM_ALPHA);
  return { rayleigh, aerosol };
}
