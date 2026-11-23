/**
 * 天空亮度报告：核心指标、仰角剖面、城镇贡献分解、情景对比、CSV 导出。
 */
import { SCENARIOS } from '../physics/constants.ts';
import { scenarioPreset, scenarioTowns, totalLumens } from '../data/scenarios.ts';
import { buildReport } from '../physics/skyMap.ts';
import type { SkyReport, TownContribution } from '../physics/skyMap.ts';
import { store } from '../state.ts';
import { button, clear, el, fmtLumens } from './dom.ts';

export class ReportView {
  readonly node: HTMLElement;
  private report: SkyReport | null = null;

  constructor() {
    this.node = el('div', { class: 'panel report-panel' });
    this.node.append(el('p', { class: 'hint' }, '观测点或情景变化后自动重算；可输入 SQM 实测天顶星等进行标定。'));
    this.renderLoading();
  }

  setReport(report: SkyReport): void {
    this.report = report;
    this.render();
  }

  private renderLoading(): void {
    clear(this.node);
    this.node.append(el('div', { class: 'loading' }, '正在计算天空亮度场…'));
  }

  private render(): void {
    if (!this.report) return this.renderLoading();
    const r = this.report;
    clear(this.node);

    const cards = el('div', { class: 'metric-grid' });
    cards.append(
      this.metric('天顶亮度', r.zenithMag.toFixed(2), 'mag/arcsec²'),
      this.metric('Bortle 分级', String(r.bortle.class), r.bortle.label),
      this.metric('裸眼极限星等', r.nelm.toFixed(1), 'NELM'),
      this.metric('地平线平均', r.horizonMeanMag.toFixed(2), 'mag/arcsec²'),
      this.metric('人工分量', r.artificialZenithMicroCd.toFixed(1), 'μcd/m²'),
      this.metric('重算耗时', r.recomputeMs.toFixed(0), 'ms (<500)')
    );
    this.node.append(cards);
    this.node.append(el('p', { class: 'bortle-desc' }, r.bortle.description));

    // 散射占比
    const split = el('div', { class: 'stat-bar' });
    split.append(
      this.pill('瑞利散射', r.rayleighShare * 100, '#6aa7ff'),
      this.pill('气溶胶米氏散射', r.aerosolShare * 100, '#ffc46b')
    );
    this.node.append(split);

    // 仰角剖面
    this.node.append(this.elevationProfile(r));

    // 城镇贡献
    this.node.append(this.contributionTable(r.contributions));

    // 情景对比
    this.node.append(this.scenarioCompare());

    // 导出
    const actions = el('div', { class: 'ctrl-row' });
    actions.append(button('导出报告 CSV', () => this.exportCsv()));
    this.node.append(actions);
  }

  private metric(label: string, value: string, unit: string): HTMLElement {
    return el('div', { class: 'metric' }, el('span', { class: 'metric-label' }, label), el('strong', {}, value), el('span', { class: 'metric-unit' }, unit));
  }

  private pill(label: string, pct: number, color: string): HTMLElement {
    const wrap = el('div', { class: 'pill' });
    wrap.append(el('span', {}, `${label} ${pct.toFixed(1)}%`));
    const bar = el('div', { class: 'pill-bar' });
    const fill = document.createElement('i');
    fill.style.width = pct.toFixed(1) + '%';
    fill.style.background = color;
    bar.append(fill);
    wrap.append(bar);
    return wrap;
  }

  private elevationProfile(r: SkyReport): HTMLElement {
    const wrap = el('div', { class: 'profile' });
    wrap.append(el('h4', {}, '仰角—平均亮度剖面'));
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 480 150');
    svg.setAttribute('class', 'profile-svg');
    const n = r.grid.ringAverageMag.length;
    const pts = r.grid.ringAverageMag.map((m, i) => {
      const x = (i / (n - 1)) * 460 + 10;
      const y = 135 - ((m - 16) / 6.5) * 120;
      return [x, Math.max(10, Math.min(135, y))] as const;
    });
    const poly = document.createElementNS(svgNS, 'polyline');
    poly.setAttribute('points', pts.map((p) => p.join(',')).join(' '));
    poly.setAttribute('fill', 'none');
    poly.setAttribute('stroke', '#57e0ff');
    poly.setAttribute('stroke-width', '2');
    svg.append(poly);
    for (let i = 0; i < n; i++) {
      const [x, y] = pts[i];
      const c = document.createElementNS(svgNS, 'circle');
      c.setAttribute('cx', String(x)); c.setAttribute('cy', String(y)); c.setAttribute('r', '2.5');
      c.setAttribute('fill', '#ffd166');
      svg.append(c);
      const t = document.createElementNS(svgNS, 'text');
      t.setAttribute('x', String(x)); t.setAttribute('y', '148'); t.setAttribute('fill', '#9fb3d9');
      t.setAttribute('font-size', '9'); t.setAttribute('text-anchor', 'middle');
      t.textContent = String(Math.round(10 + (80 * i) / Math.max(1, n - 1))) + '°';
      svg.append(t);
    }
    wrap.append(svg);
    return wrap;
  }

  private contributionTable(rows: TownContribution[]): HTMLElement {
    const wrap = el('div', { class: 'contrib' });
    wrap.append(el('h4', {}, '城镇天顶贡献分解'));
    const table = el('div', { class: 'town-table contrib-table' });
    const head = el('div', { class: 'town-row town-head' });
    head.append(el('span', {}, '城镇'), el('span', {}, '距离'), el('span', {}, '方位'), el('span', {}, '贡献 μcd/m²'), el('span', {}, '占比'), el('span', {}, 'R/A'));
    table.append(head);
    for (const c of rows) {
      const row = el('div', { class: 'town-row' });
      const ra = c.rayleighMicroCd / Math.max(c.aerosolMicroCd, 1e-9);
      row.append(
        el('span', { class: 'town-name' }, c.town.name),
        el('span', {}, c.distanceKm.toFixed(1) + ' km'),
        el('span', {}, c.azDeg.toFixed(0) + '°'),
        el('span', {}, c.zenithMicroCd.toFixed(2)),
        el('span', {}, (c.share * 100).toFixed(1) + '%'),
        el('span', {}, ra.toFixed(1))
      );
      table.append(row);
    }
    wrap.append(table);
    return wrap;
  }

  private scenarioCompare(): HTMLElement {
    const s = store.get();
    const wrap = el('div', { class: 'compare' });
    wrap.append(el('h4', {}, '改造情景对比（同一观测点天顶）'));
    const table = el('div', { class: 'town-table' });
    const head = el('div', { class: 'town-row town-head' });
    head.append(el('span', {}, '情景'), el('span', {}, '天顶 mag'), el('span', {}, 'Bortle'), el('span', {}, '上射光通'), el('span', {}, '相对现状'));
    table.append(head);
    const base = buildReport(s.observer, scenarioTowns(s.baseTowns, scenarioPreset('current')), s.atmo, {
      moonFraction: s.moonFraction, moonEl: (s.moonElDeg * Math.PI) / 180, cloud: s.cloud, calibration: s.calibration,
    });
    for (const sc of SCENARIOS) {
      const towns = scenarioTowns(s.baseTowns, scenarioPreset(sc.id));
      const rep = buildReport(s.observer, towns, s.atmo, {
        moonFraction: s.moonFraction, moonEl: (s.moonElDeg * Math.PI) / 180, cloud: s.cloud, calibration: s.calibration,
      });
      const up = totalLumens(towns).upward;
      const row = el('div', { class: 'town-row' + (s.scenario === sc.id ? ' active-row' : '') });
      const delta = rep.zenithMag - base.zenithMag;
      row.append(
        el('span', { class: 'town-name' }, sc.label),
        el('span', {}, rep.zenithMag.toFixed(2)),
        el('span', {}, String(rep.bortle.class)),
        el('span', {}, fmtLumens(up)),
        el('span', { class: delta >= 0 ? 'pos' : 'neg' }, (delta >= 0 ? '+' : '') + delta.toFixed(2) + ' 等')
      );
      table.append(row);
    }
    wrap.append(table);
    return wrap;
  }

  private exportCsv(): void {
    if (!this.report) return;
    const r = this.report;
    const lines = [
      '指标,数值,单位',
      `天顶亮度,${r.zenithMag.toFixed(3)},mag/arcsec2`,
      `天顶亮度,${r.zenithMicroCd.toFixed(2)},uCd/m2`,
      `Bortle,${r.bortle.class},级`,
      `NELM,${r.nelm.toFixed(2)},星等`,
      `地平线平均,${r.horizonMeanMag.toFixed(3)},mag/arcsec2`,
      `瑞利占比,${(r.rayleighShare * 100).toFixed(1)},%`,
      `气溶胶占比,${(r.aerosolShare * 100).toFixed(1)},%`,
      `重算耗时,${r.recomputeMs.toFixed(0)},ms`,
      '',
      '城镇,距离km,方位度,贡献uCd/m2,占比%',
      ...r.contributions.map((c) => `${c.town.name},${c.distanceKm.toFixed(2)},${c.azDeg.toFixed(1)},${c.zenithMicroCd.toFixed(3)},${(c.share * 100).toFixed(2)}`),
    ];
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `夜空亮度报告_${store.get().observer.name}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
}
