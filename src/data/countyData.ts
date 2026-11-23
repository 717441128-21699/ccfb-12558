/**
 * 虚构县域「云岚县」夜间灯光数据（自行编制，按县城/中心镇/乡镇/村四级规模）。
 * 坐标单位 km，原点取县域几何中心；人口单位人；光通量按人均 lm 估算。
 * 可替换为卫星夜光图反演后的真实网格（见 state.ts 中的数据导入接口）。
 */
import type { FixtureType, Town } from '../physics/constants.ts';

export const MAP_EXTENT = { minX: -32, maxX: 32, minY: -26, maxY: 26 };

export const DEFAULT_OBSERVER = { x: -24, y: 20, h: 1.0, name: '云岭暗夜观测点' };

interface TownSeed {
  id: string;
  name: string;
  x: number;
  y: number;
  population: number;
  tier: Town['tier'];
  fixture: FixtureType;
  lumensPerCapita?: number;
}

/**
 * 人均光通量按规模分级（lm/人，含路灯、商铺、居民、公共照明综合估计）：
 * 县城 850、中心镇 700、乡镇 550、中心村 380。
 */
const LPC_BY_TIER: Record<Town['tier'], number> = {
  county_seat: 850,
  central_town: 700,
  town: 550,
  village: 380,
};

const SEEDS: TownSeed[] = [
  { id: 't01', name: '云岚县城（城关）', x: 4, y: -3, population: 92000, tier: 'county_seat', fixture: 'unshielded_hps' },
  { id: 't02', name: '河东新城', x: 9, y: -1, population: 38000, tier: 'central_town', fixture: 'cool_led_open' },
  { id: 't03', name: '青石镇', x: -8, y: -10, population: 21000, tier: 'central_town', fixture: 'unshielded_hps' },
  { id: 't04', name: '柳埠镇', x: 16, y: 8, population: 17000, tier: 'central_town', fixture: 'partial_led' },
  { id: 't05', name: '双溪镇', x: -16, y: -4, population: 9500, tier: 'town', fixture: 'unshielded_hps' },
  { id: 't06', name: '梅塘乡', x: 12, y: -15, population: 7200, tier: 'town', fixture: 'unshielded_hps' },
  { id: 't07', name: '白沙镇', x: -4, y: 14, population: 8400, tier: 'town', fixture: 'partial_led' },
  { id: 't08', name: '桐木乡', x: 22, y: -6, population: 5100, tier: 'town', fixture: 'unshielded_hps' },
  { id: 't09', name: '枫林镇', x: -22, y: 9, population: 6300, tier: 'town', fixture: 'unshielded_hps' },
  { id: 't10', name: '鹤田村', x: 6, y: 12, population: 2600, tier: 'village', fixture: 'unshielded_hps' },
  { id: 't11', name: '龙塘村', x: -11, y: 6, population: 1900, tier: 'village', fixture: 'partial_led' },
  { id: 't12', name: '高桥村', x: 19, y: 15, population: 2200, tier: 'village', fixture: 'unshielded_hps' },
  { id: 't13', name: '云岭驿站村', x: -10, y: 9, population: 1400, tier: 'village', fixture: 'partial_led' },
  { id: 't14', name: '工业园区', x: 11, y: -7, population: 6800, tier: 'town', fixture: 'cool_led_open', lumensPerCapita: 1400 },
];

export function buildDefaultTowns(): Town[] {
  return SEEDS.map((s) => ({
    ...s,
    lumensPerCapita: s.lumensPerCapita ?? LPC_BY_TIER[s.tier],
    dim: 1.0,
  }));
}

export const TIER_LABELS: Record<Town['tier'], string> = {
  county_seat: '县城',
  central_town: '中心镇',
  town: '乡镇',
  village: '中心村',
};

export const TIER_COLORS: Record<Town['tier'], string> = {
  county_seat: '#ffb347',
  central_town: '#ffd166',
  town: '#ffe8a3',
  village: '#f4f1de',
};
