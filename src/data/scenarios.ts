/**
 * 灯光改造情景：在城镇数据上应用灯具替换、整体调光等方案，返回新数组（不可变更新）。
 */
import { FIXTURES } from '../physics/constants.ts';
import type { FixtureType, ScenarioId, Town } from '../physics/constants.ts';

export interface ScenarioOptions {
  id: ScenarioId;
  /** 自定义情景下的统一灯具（不替换则 null） */
  fixtureOverride?: FixtureType | null;
  /** 整体调光系数 */
  dimScale?: number;
}

export function scenarioTowns(towns: Town[], opts: ScenarioOptions): Town[] {
  const dimScale = opts.dimScale ?? 1;
  return towns.map((t) => {
    const next: Town = { ...t, dim: Math.max(0.05, t.dim * dimScale) };
    if (opts.fixtureOverride) {
      next.fixture = opts.fixtureOverride;
    }
    return next;
  });
}

export function scenarioPreset(id: ScenarioId): ScenarioOptions {
  switch (id) {
    case 'current':
      return { id };
    case 'half_brightness':
      return { id, dimScale: 0.5 };
    case 'full_shield':
      return { id, fixtureOverride: 'full_cutoff_led' };
    case 'shield_and_dim':
      return { id, fixtureOverride: 'full_cutoff_warm', dimScale: 0.5 };
  }
}

/** 单个城镇的灯具替换预览（面板里逐镇调整用） */
export function withFixture(towns: Town[], id: string, fixture: FixtureType): Town[] {
  return towns.map((t) => (t.id === id ? { ...t, fixture } : t));
}

export function withDim(towns: Town[], id: string, dim: number): Town[] {
  return towns.map((t) => (t.id === id ? { ...t, dim: Math.max(0.05, Math.min(1, dim)) } : t));
}

/** 全县光通统计（流明） */
export function totalLumens(towns: Town[]): { total: number; upward: number } {
  let total = 0;
  let upward = 0;
  for (const t of towns) {
    const spec = FIXTURES[t.fixture];
    const lum = t.population * t.lumensPerCapita * spec.lumenFactor * t.dim;
    total += lum;
    upward += lum * spec.upFraction;
  }
  return { total, upward };
}
