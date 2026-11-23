/**
 * 应用全局状态（最小发布订阅 store）。
 */
import { DEFAULT_ATMOSPHERE } from './physics/constants.ts';
import type { AtmosphereParams, ScenarioId, Town } from './physics/constants.ts';
import { buildDefaultTowns, DEFAULT_OBSERVER } from './data/countyData.ts';
import { scenarioPreset, scenarioTowns } from './data/scenarios.ts';

export interface Observer {
  x: number;
  y: number;
  h: number;
  name: string;
}

export interface AppState {
  observer: Observer;
  /** 基础（现状）城镇数据，所有情景在其上派生 */
  baseTowns: Town[];
  scenario: ScenarioId;
  atmo: AtmosphereParams;
  /** SQM 实测标定系数，1=未标定 */
  calibration: number;
  /** 月相 0..1（照亮比例） */
  moonFraction: number;
  /** 月亮仰角（度），-90..90 */
  moonElDeg: number;
  /** 月亮方位角（度，北=0 顺时针） */
  moonAzDeg: number;
  /** 云量 0..1 */
  cloud: number;
  /** 星空时间：恒星时角（度），旋转天球 */
  siderealDeg: number;
  /** 渲染质量：视线积分步数 */
  gpuSteps: number;
  /** 鱼眼视图曝光倍率 */
  exposure: number;
  /** 当前激活面板 */
  activeTab: 'map' | 'retrofit' | 'sky' | 'report' | 'validation';
}

export function initialState(): AppState {
  return {
    observer: { ...DEFAULT_OBSERVER },
    baseTowns: buildDefaultTowns(),
    scenario: 'current',
    atmo: { ...DEFAULT_ATMOSPHERE },
    calibration: 1,
    moonFraction: 0,
    moonElDeg: 30,
    moonAzDeg: 180,
    cloud: 0,
    siderealDeg: 0,
    gpuSteps: 24,
    exposure: 1,
    activeTab: 'sky',
  };
}

/** 应用当前情景后的城镇数据 */
export function effectiveTowns(state: AppState): Town[] {
  return scenarioTowns(state.baseTowns, scenarioPreset(state.scenario));
}

type Listener = (s: AppState) => void;

class Store {
  private state: AppState = initialState();
  private listeners = new Set<Listener>();

  get(): AppState {
    return this.state;
  }

  /** 局部更新（浅合并） */
  set(patch: Partial<AppState>): void {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  /** 在当前状态上原子更新 */
  update(fn: (s: AppState) => Partial<AppState>): void {
    this.set(fn(this.state));
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private emit(): void {
    for (const l of this.listeners) l(this.state);
  }
}

export const store = new Store();
