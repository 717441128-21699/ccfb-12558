/**
 * 观测点地图（Canvas 2D）：县域灯光分布、可拖动观测点、天顶等亮度线、方位指北。
 */
import { DEFAULT_OBSERVER, MAP_EXTENT, TIER_COLORS, TIER_LABELS } from '../data/countyData.ts';
import type { Town } from '../physics/constants.ts';
import { store, effectiveTowns } from '../state.ts';
import { button, el } from './dom.ts';
import { computeMapHeat } from '../physics/skyMap.ts';
import type { HeatPoint } from '../physics/skyMap.ts';

const W = 640;
const H = 520;
const HEAT_NX = 26;
const HEAT_NY = 21;

/** mag → 热力色（暗=蓝绿，亮=红） */
function heatColor(mag: number): string {
  // 18(亮城市) .. 22(暗) 映射到红→黄→绿→蓝
  const t = Math.max(0, Math.min(1, (22 - mag) / 4));
  const stops: [number, [number, number, number]][] = [
    [0, [30, 70, 140]],
    [0.35, [40, 150, 110]],
    [0.6, [210, 180, 70]],
    [0.8, [225, 120, 55]],
    [1, [210, 55, 55]],
  ];
  let a = stops[0];
  let b = stops[stops.length - 1];
  for (let k = 0; k < stops.length - 1; k++) {
    if (t >= stops[k][0] && t <= stops[k + 1][0]) { a = stops[k]; b = stops[k + 1]; break; }
  }
  const f = (t - a[0]) / Math.max(1e-6, b[0] - a[0]);
  const c = a[1].map((v, idx) => Math.round(v + (b[1][idx] - v) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export class MapView {
  readonly node: HTMLElement;
  private canvas: HTMLCanvasElement;
  private heat: HeatPoint[] | null = null;
  private heatKey = '';
  private dragging = false;

  constructor() {
    this.node = el('div', { class: 'panel map-panel' });
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.canvas.className = 'map-canvas';
    const hint = el('p', { class: 'hint' }, '拖动观测点标记或点击地图移动观测点；背景为模型计算的天顶亮度热力分布（单位 mag/arcsec²，越红越亮、越蓝越暗）。');
    const legend = el('div', { class: 'legend' });
    for (const tier of ['county_seat', 'central_town', 'town', 'village'] as const) {
      const item = el('span', { class: 'legend-item' });
      const dot = el('i', { class: 'legend-dot', style: `background:${TIER_COLORS[tier]}` });
      item.append(dot, document.createTextNode(TIER_LABELS[tier]));
      legend.append(item);
    }
    const scale = el('div', { class: 'heat-scale' });
    for (const m of [22, 21, 20, 19, 18]) {
      const chip = el('span', { class: 'heat-chip' }, el('i', { style: `background:${heatColor(m)}` }), document.createTextNode(` ${m}`));
      scale.append(chip);
    }
    this.node.append(this.canvas, hint, legend, scale);
    const resetRow = el('div', { class: 'ctrl-row' });
    resetRow.append(button('回到默认观测点', () => store.set({ observer: { ...DEFAULT_OBSERVER } })));
    this.node.append(resetRow);
    this.bind();
    this.draw();
  }

  /** 由 App 在报告/情景变化时调用，重算热力网格 */
  refreshHeat(): void {
    const s = store.get();
    const towns = effectiveTowns(s);
    const key = JSON.stringify([s.scenario, s.atmo, s.calibration, s.baseTowns.map((t) => [t.fixture, t.dim])]);
    if (key === this.heatKey) return;
    this.heatKey = key;
    // 异步计算避免阻塞拖动（地图热力对实时性要求低）
    setTimeout(() => {
      this.heat = computeMapHeat(MAP_EXTENT, HEAT_NX, HEAT_NY, towns, s.atmo, s.calibration);
      this.draw();
    }, 0);
  }

  private toScreen(x: number, y: number): [number, number] {
    const sx = ((x - MAP_EXTENT.minX) / (MAP_EXTENT.maxX - MAP_EXTENT.minX)) * W;
    const sy = H - ((y - MAP_EXTENT.minY) / (MAP_EXTENT.maxY - MAP_EXTENT.minY)) * H;
    return [sx, sy];
  }

  private toMap(px: number, py: number): [number, number] {
    const x = MAP_EXTENT.minX + (px / W) * (MAP_EXTENT.maxX - MAP_EXTENT.minX);
    const y = MAP_EXTENT.minY + (1 - py / H) * (MAP_EXTENT.maxY - MAP_EXTENT.minY);
    return [x, y];
  }

  private bind(): void {
    const move = (clientX: number, clientY: number) => {
      const rect = this.canvas.getBoundingClientRect();
      const px = ((clientX - rect.left) / rect.width) * W;
      const py = ((clientY - rect.top) / rect.height) * H;
      const [x, y] = this.toMap(px, py);
      const s = store.get();
      store.set({ observer: { ...s.observer, x: +x.toFixed(2), y: +y.toFixed(2) } });
    };
    this.canvas.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.canvas.setPointerCapture(e.pointerId);
      move(e.clientX, e.clientY);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (this.dragging) move(e.clientX, e.clientY);
    });
    window.addEventListener('pointerup', () => (this.dragging = false));
  }

  draw(): void {
    const ctx = this.canvas.getContext('2d')!;
    const s = store.get();
    const towns = effectiveTowns(s);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0b1020';
    ctx.fillRect(0, 0, W, H);
    this.drawHeatmap(ctx);
    this.drawGridLines(ctx);
    this.drawTowns(ctx, towns);
    this.drawObserver(ctx);
    this.drawCompass(ctx);
    this.drawScale(ctx);
  }

  /** 真实模型天顶亮度热力网格 */
  private drawHeatmap(ctx: CanvasRenderingContext2D): void {
    if (!this.heat) return;
    const cw = W / (HEAT_NX - 1);
    const ch = H / (HEAT_NY - 1);
    ctx.save();
    ctx.globalAlpha = 0.72;
    for (const p of this.heat) {
      const [sx, sy] = this.toScreen(p.x, p.y);
      ctx.fillStyle = heatColor(p.mag);
      ctx.fillRect(sx - cw / 2, sy - ch / 2, cw + 0.6, ch + 0.6);
    }
    ctx.restore();
  }

  private drawGridLines(ctx: CanvasRenderingContext2D): void {
    ctx.strokeStyle = 'rgba(120,150,200,0.18)';
    ctx.lineWidth = 1;
    for (let gx = MAP_EXTENT.minX; gx <= MAP_EXTENT.maxX; gx += 10) {
      const [x] = this.toScreen(gx, 0);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let gy = MAP_EXTENT.minY; gy <= MAP_EXTENT.maxY; gy += 10) {
      const [, y] = this.toScreen(0, gy);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    // 县界（示意矩形）
    const [x0, y0] = this.toScreen(MAP_EXTENT.minX, MAP_EXTENT.maxY);
    const [x1, y1] = this.toScreen(MAP_EXTENT.maxX, MAP_EXTENT.minY);
    ctx.strokeStyle = 'rgba(160,190,240,0.5)';
    ctx.setLineDash([6, 5]);
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    ctx.setLineDash([]);
  }

  private drawTowns(ctx: CanvasRenderingContext2D, towns: Town[]): void {
    for (const t of towns) {
      const [x, y] = this.toScreen(t.x, t.y);
      const size = t.tier === 'county_seat' ? 9 : t.tier === 'central_town' ? 7 : t.tier === 'town' ? 5.5 : 4;
      // 光晕
      const glow = ctx.createRadialGradient(x, y, 0, x, y, size * 3.2);
      glow.addColorStop(0, TIER_COLORS[t.tier] + 'cc');
      glow.addColorStop(1, TIER_COLORS[t.tier] + '00');
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(x, y, size * 3.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = TIER_COLORS[t.tier];
      ctx.beginPath(); ctx.arc(x, y, size, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(230,238,255,0.92)';
      ctx.font = '11px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(t.name, x, y - size - 4);
    }
  }

  private drawObserver(ctx: CanvasRenderingContext2D): void {
    const s = store.get();
    const [x, y] = this.toScreen(s.observer.x, s.observer.y);
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = '#57e0ff';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -15); ctx.lineTo(5, -6); ctx.lineTo(-5, -6); ctx.closePath();
    ctx.fillStyle = '#57e0ff';
    ctx.fill();
    ctx.fillStyle = '#bff3ff';
    ctx.font = 'bold 11px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(s.observer.name, 0, 24);
    ctx.restore();
  }

  private drawCompass(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.translate(W - 34, 38);
    ctx.strokeStyle = 'rgba(200,220,255,0.7)';
    ctx.fillStyle = 'rgba(200,220,255,0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, 0, 18, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -16); ctx.lineTo(4, 0); ctx.lineTo(0, 16); ctx.lineTo(-4, 0); ctx.closePath();
    ctx.fill();
    ctx.font = 'bold 12px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('N', 0, -22);
    ctx.restore();
  }

  private drawScale(ctx: CanvasRenderingContext2D): void {
    const [sx] = this.toScreen(MAP_EXTENT.minX + 10, MAP_EXTENT.minY);
    const [ex] = this.toScreen(MAP_EXTENT.minX + 20, MAP_EXTENT.minY);
    const y = H - 18;
    ctx.strokeStyle = 'rgba(220,235,255,0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(sx, y); ctx.lineTo(ex, y); ctx.stroke();
    ctx.fillStyle = 'rgba(220,235,255,0.9)';
    ctx.font = '11px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('10 km', (sx + ex) / 2, y - 5);
  }
}
