/**
 * 全天空渲染面板：WebGL2 鱼眼视图与环境控制。
 */
import { SkyRenderer } from '../webgl/SkyRenderer.ts';
import { store } from '../state.ts';
import { effectiveTowns } from '../state.ts';
import { microCdToMag } from '../physics/scatter.ts';
import type { AppState } from '../state.ts';
import type { Town } from '../physics/constants.ts';
import { button, clear, el, slider } from './dom.ts';

export class SkyView {
  readonly node: HTMLElement;
  private renderer: SkyRenderer | null = null;
  private readout: HTMLElement;
  private perf: HTMLElement;
  private canvas: HTMLCanvasElement;
  private errorBox: HTMLElement;

  constructor() {
    this.node = el('div', { class: 'panel sky-panel' });
    const stage = el('div', { class: 'sky-stage' });
    this.canvas = document.createElement('canvas');
    this.canvas.width = 620;
    this.canvas.height = 620;
    this.canvas.className = 'sky-canvas';
    this.errorBox = el('div', { class: 'sky-error', hidden: '' });
    this.readout = el('div', { class: 'sky-readout' });
    this.perf = el('div', { class: 'sky-perf' });
    stage.append(this.canvas, this.errorBox, this.readout, this.perf);

    const controls = el('div', { class: 'sky-controls' });
    controls.append(
      slider('月相（照亮比例）', store.get().moonFraction, 0, 1, 0.01, (v) => store.set({ moonFraction: v }), (v) => Math.round(v * 100) + '%'),
      slider('月亮高度角', store.get().moonElDeg, -10, 80, 1, (v) => store.set({ moonElDeg: v }), (v) => v.toFixed(0) + '°'),
      slider('月亮方位角', store.get().moonAzDeg, 0, 360, 1, (v) => store.set({ moonAzDeg: v }), (v) => v.toFixed(0) + '°'),
      slider('云量', store.get().cloud, 0, 1, 0.01, (v) => store.set({ cloud: v }), (v) => Math.round(v * 100) + '%'),
      slider('大气清晰度 K', store.get().atmo.clarity, 0.3, 2.5, 0.05, (v) =>
        store.update((s) => ({ atmo: { ...s.atmo, clarity: v } })), (v) => v.toFixed(2)),
      slider('积分步数', store.get().gpuSteps, 12, 36, 2, (v) => store.set({ gpuSteps: v }), (v) => v.toFixed(0)),
      slider('曝光', store.get().exposure, 0.3, 3, 0.05, (v) => store.set({ exposure: v }), (v) => v.toFixed(2) + '×'),
      slider('恒星时角', store.get().siderealDeg, 0, 360, 1, (v) => store.set({ siderealDeg: v }), (v) => v.toFixed(0) + '°')
    );
    const row = el('div', { class: 'ctrl-row' });
    row.append(
      button('晴空新月', () => store.set({ cloud: 0, moonFraction: 0 })),
      button('满月晴夜', () => store.set({ cloud: 0, moonFraction: 1, moonElDeg: 45 })),
      button('阴天', () => store.set({ cloud: 0.85 }))
    );
    controls.append(row);
    this.node.append(stage, controls);
    this.initRenderer();
  }

  private initRenderer(): void {
    try {
      this.renderer = new SkyRenderer(this.canvas);
    } catch (e) {
      this.errorBox.hidden = false;
      this.errorBox.textContent = 'WebGL2 初始化失败：' + (e as Error).message;
    }
  }

  /** 渲染一帧（App 在状态变化时调用） */
  render(state: AppState, towns: Town[]): void {
    if (!this.renderer) return;
    const t0 = performance.now();
    this.renderer.render(state, towns);
    const dt = performance.now() - t0;
    this.perf.textContent = `GPU 渲染 ${dt.toFixed(1)} ms · 步数 ${state.gpuSteps}`;
  }

  /** 供验证面板调用：回读 HDR 像素 */
  probe(az: number, el: number) {
    if (!this.renderer) return null;
    return this.renderer.readRawRadiance(store.get(), effectiveTowns(store.get()), az, el);
  }

  /** e2e 诊断：渲染器是否可用与 HDR 支持 */
  rendererInfo() {
    return this.renderer ? { ok: true, hdr: this.renderer.isHdrSupported() } : { ok: false, hdr: false };
  }

  dumpFbo(az: number, el: number) {
    if (!this.renderer) return null;
    return this.renderer.dumpFbo(store.get(), effectiveTowns(store.get()), az, el);
  }

  updateReadout(mag: number, microCd: number): void {
    clear(this.readout);
    this.readout.append(
      el('span', {}, `天顶 ${mag.toFixed(2)} 等/角秒²`),
      el('span', {}, `${microCd.toFixed(1)} μcd/m²`),
      el('span', {}, microCdToMag(microCd) === mag ? 'V 波段' : '')
    );
  }
}
