/**
 * 星表：40 余颗真实亮星（J2000 RA/Dec，弧度）+ 程序化生成的暗星。
 * tint: 0 白 / 1 暖 / 2 蓝 / 3 橙红
 */

export interface Star {
  ra: number; // 弧度
  dec: number; // 弧度
  mag: number; // V 星等
  tint: 0 | 1 | 2 | 3;
}

const D2R = Math.PI / 180;

/** 真实亮星（数据为常用近似值，用于示意渲染） */
const BRIGHT: Star[] = [
  { ra: 6.752 * D2R, dec: -16.716 * D2R, mag: -1.46, tint: 1 },    // 天狼
  { ra: 95.988 * D2R, dec: -52.696 * D2R, mag: -0.74, tint: 1 },   // 老人
  { ra: 213.915 * D2R, dec: 19.182 * D2R, mag: -0.05, tint: 3 },   // 大角
  { ra: 279.234 * D2R, dec: 38.784 * D2R, mag: 0.03, tint: 1 },    // 织女
  { ra: 79.172 * D2R, dec: 45.998 * D2R, mag: 0.08, tint: 0 },     // 五车二
  { ra: 78.634 * D2R, dec: -8.202 * D2R, mag: 0.13, tint: 2 },     // 参宿七
  { ra: 114.825 * D2R, dec: 5.225 * D2R, mag: 0.34, tint: 1 },     // 南河三
  { ra: 88.793 * D2R, dec: 7.407 * D2R, mag: 0.42, tint: 3 },      // 参宿四
  { ra: 297.696 * D2R, dec: 8.868 * D2R, mag: 0.77, tint: 1 },     // 河鼓二
  { ra: 68.98 * D2R, dec: 16.509 * D2R, mag: 0.85, tint: 3 },      // 毕宿五
  { ra: 247.352 * D2R, dec: -26.432 * D2R, mag: 0.96, tint: 3 },   // 心宿二
  { ra: 201.298 * D2R, dec: -11.161 * D2R, mag: 1.04, tint: 2 },   // 角宿一
  { ra: 116.329 * D2R, dec: 28.026 * D2R, mag: 1.14, tint: 0 },    // 北河三
  { ra: 344.413 * D2R, dec: -29.622 * D2R, mag: 1.16, tint: 1 },   // 北落师门
  { ra: 310.358 * D2R, dec: 45.28 * D2R, mag: 1.25, tint: 1 },     // 天津四
  { ra: 152.093 * D2R, dec: 11.967 * D2R, mag: 1.4, tint: 2 },     // 轩辕十四
  { ra: 113.65 * D2R, dec: 31.888 * D2R, mag: 1.58, tint: 1 },     // 北河二
  { ra: 81.283 * D2R, dec: 6.35 * D2R, mag: 1.64, tint: 2 },       // 参宿五
  { ra: 84.053 * D2R, dec: 28.608 * D2R, mag: 1.65, tint: 2 },     // 五车五
  { ra: 84.873 * D2R, dec: -1.202 * D2R, mag: 1.69, tint: 2 },     // 参宿二
  { ra: 51.081 * D2R, dec: 49.861 * D2R, mag: 1.79, tint: 0 },     // 天船三
  { ra: 90.488 * D2R, dec: 44.947 * D2R, mag: 1.9, tint: 1 },      // 五车三
  { ra: 95.675 * D2R, dec: 16.399 * D2R, mag: 1.93, tint: 1 },     // 井宿三
  { ra: 306.412 * D2R, dec: -56.735 * D2R, mag: 1.94, tint: 2 },   // 孔雀十一
  { ra: 346.201 * D2R, dec: -46.961 * D2R, mag: 1.74, tint: 2 },   // 鹤一
  { ra: 141.897 * D2R, dec: -8.659 * D2R, mag: 1.98, tint: 3 },    // 星宿一
  { ra: 30.51 * D2R, dec: 23.462 * D2R, mag: 2.0, tint: 3 },       // 娄宿三
  { ra: 37.954 * D2R, dec: 89.264 * D2R, mag: 1.98, tint: 0 },     // 北极星
  { ra: 95.078 * D2R, dec: -17.956 * D2R, mag: 1.98, tint: 2 },    // 军市一
  { ra: 276.044 * D2R, dec: -34.385 * D2R, mag: 1.85, tint: 2 },   // 箕宿三
  { ra: 10.897 * D2R, dec: -17.987 * D2R, mag: 2.04, tint: 3 },    // 土司空
  { ra: 290.402 * D2R, dec: -26.297 * D2R, mag: 2.05, tint: 2 },   // 斗宿六
  { ra: 16.887 * D2R, dec: 35.621 * D2R, mag: 2.05, tint: 3 },     // 奎宿九
  { ra: 86.939 * D2R, dec: -9.67 * D2R, mag: 2.09, tint: 2 },      // 参宿六
  { ra: 263.222 * D2R, dec: -37.104 * D2R, mag: 1.62, tint: 2 },   // 尾宿八
  { ra: 285.657 * D2R, dec: -8.215 * D2R, mag: 2.07, tint: 2 },    // 牛宿二
  { ra: 130.055 * D2R, dec: -69.028 * D2R, mag: 1.79, tint: 1 },   // 海山二
  { ra: 233.672 * D2R, dec: 26.715 * D2R, mag: 2.22, tint: 1 },    // 贯索四
  { ra: 187.275 * D2R, dec: 38.31 * D2R, mag: 2.23, tint: 0 },     // 常陈一
  { ra: 240.083 * D2R, dec: -22.622 * D2R, mag: 2.29, tint: 1 },   // 氐宿一
  { ra: 253.528 * D2R, dec: -15.725 * D2R, mag: 2.32, tint: 1 },   // 房宿四
];

/** mulberry32 确定性随机 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 程序化暗星：全天均匀分布，星等按数量指数增长 */
function procedural(count: number, seed: number, magMin: number, magMax: number): Star[] {
  const rnd = mulberry32(seed);
  const out: Star[] = [];
  for (let i = 0; i < count; i++) {
    const u = rnd();
    const dec = Math.asin(2 * rnd() - 1);
    const ra = rnd() * Math.PI * 2;
    // 暗星占多数：星等向 magMax 偏置
    const mag = magMin + (magMax - magMin) * Math.pow(u, 0.42);
    const t = rnd();
    const tint: Star['tint'] = t < 0.6 ? 0 : t < 0.78 ? 1 : t < 0.93 ? 2 : 3;
    out.push({ ra, dec, mag, tint });
  }
  return out;
}

export function buildStarCatalog(maxCount: number): Star[] {
  const all = [...BRIGHT, ...procedural(280, 20261124, 2.2, 6.4)];
  all.sort((a, b) => a.mag - b.mag);
  return all.slice(0, maxCount);
}
