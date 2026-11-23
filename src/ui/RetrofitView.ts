/**
 * 灯光改造方案面板：全局情景、逐镇灯具与调光、上射光通统计。
 */
import { FIXTURES, SCENARIOS } from '../physics/constants.ts';
import type { FixtureType, ScenarioId, Town } from '../physics/constants.ts';
import { scenarioPreset, scenarioTowns, totalLumens, withDim, withFixture } from '../data/scenarios.ts';
import { store } from '../state.ts';
import { effectiveTowns } from '../state.ts';
import { TIER_LABELS } from '../data/countyData.ts';
import { button, clear, el, fmtLumens, select, slider } from './dom.ts';

export class RetrofitView {
  readonly node: HTMLElement;

  constructor() {
    this.node = el('div', { class: 'panel retrofit-panel' });
    this.render();
    store.subscribe(() => this.render());
  }

  private render(): void {
    const s = store.get();
    clear(this.node);
    const towns = effectiveTowns(s);
    const lum = totalLumens(towns);
    const baseLum = totalLumens(scenarioTowns(s.baseTowns, scenarioPreset('current')));
    const upCut = (1 - lum.upward / baseLum.upward) * 100;

    // 情景卡片
    const cards = el('div', { class: 'scenario-grid' });
    for (const sc of SCENARIOS) {
      const card = el('div', { class: 'scenario-card' + (s.scenario === sc.id ? ' active' : '') });
      card.append(el('h4', {}, sc.label), el('p', {}, sc.description));
      card.addEventListener('click', () => store.set({ scenario: sc.id as ScenarioId }));
      cards.append(card);
    }
    this.node.append(cards);

    // 统计条
    const stats = el('div', { class: 'stat-bar' });
    stats.append(
      this.stat('总光通', fmtLumens(lum.total)),
      this.stat('上射光通', fmtLumens(lum.upward)),
      this.stat('上射削减', upCut.toFixed(1) + '%'),
      this.stat('灯具种类', new Set(towns.map((t) => t.fixture)).size + ' 类')
    );
    this.node.append(stats);

    // 全局快捷
    const quick = el('div', { class: 'ctrl-row' });
    quick.append(
      button('全部全截光 3000K', () => this.applyAllFixture('full_cutoff_led')),
      button('全部暖白 2700K', () => this.applyAllFixture('full_cutoff_warm')),
      button('恢复现状', () => {
        store.set({ scenario: 'current' });
        store.update((st) => ({ baseTowns: st.baseTowns.map((t) => ({ ...t, dim: 1 })) }));
      })
    );
    this.node.append(quick);

    // 逐镇表格
    const table = el('div', { class: 'town-table' });
    const head = el('div', { class: 'town-row town-head' });
    head.append(el('span', {}, '城镇'), el('span', {}, '规模'), el('span', {}, '灯具'), el('span', {}, '调光'), el('span', {}, '上射流明'));
    table.append(head);
    for (const t of towns) table.append(this.townRow(t));
    this.node.append(table);
  }

  private stat(label: string, value: string): HTMLElement {
    return el('div', { class: 'stat' }, el('span', { class: 'stat-label' }, label), el('strong', {}, value));
  }

  private applyAllFixture(f: FixtureType): void {
    store.update((s) => ({ baseTowns: s.baseTowns.map((t) => ({ ...t, fixture: f })) }));
  }

  private townRow(t: Town): HTMLElement {
    const s = store.get();
    const spec = FIXTURES[t.fixture];
    const upLm = t.population * t.lumensPerCapita * spec.upFraction * spec.lumenFactor * t.dim;
    const row = el('div', { class: 'town-row' });
    row.append(el('span', { class: 'town-name' }, t.name), el('span', { class: 'town-tier' }, TIER_LABELS[t.tier]));

    const fixtureSel = select(
      '',
      Object.entries(FIXTURES).map(([k, v]) => ({ value: k, text: v.label })),
      t.fixture,
      (v) => store.update((st) => ({ baseTowns: withFixture(st.baseTowns, t.id, v as FixtureType) }))
    );
    fixtureSel.classList.add('cell');
    row.append(fixtureSel);

    const dimCtrl = slider('', t.dim, 0.05, 1, 0.05, (v) =>
      store.update((st) => ({ baseTowns: withDim(st.baseTowns, t.id, v) })), (v) => Math.round(v * 100) + '%');
    dimCtrl.classList.add('cell');
    row.append(dimCtrl);
    row.append(el('span', { class: 'town-lum' }, fmtLumens(upLm)));
    void s;
    return row;
  }
}
