/**
 * 应用外壳：标签页切换、状态变更后的 GPU 刷新与报告防抖重算。
 */
import { store } from './state.ts';
import type { AppState } from './state.ts';
import { effectiveTowns } from './state.ts';
import { DEFAULT_OBSERVER } from './data/countyData.ts';
import { MapView } from './ui/MapView.ts';
import { RetrofitView } from './ui/RetrofitView.ts';
import { SkyView } from './ui/SkyView.ts';
import { ReportView } from './ui/ReportView.ts';
import { ValidationView } from './ui/ValidationView.ts';
import { ReportService } from './workers/ReportService.ts';
import { button, el } from './ui/dom.ts';

const TABS: { id: AppState['activeTab']; label: string }[] = [
  { id: 'map', label: '观测点地图' },
  { id: 'retrofit', label: '灯光改造方案' },
  { id: 'sky', label: '全天空渲染' },
  { id: 'report', label: '天空亮度报告' },
  { id: 'validation', label: '模型验证' },
];

export class App {
  mapView = new MapView();
  retrofitView = new RetrofitView();
  skyView = new SkyView();
  reportView = new ReportView();
  validationView: ValidationView;
  private service = new ReportService();
  private views: Record<AppState['activeTab'], HTMLElement>;
  private tabBar: HTMLElement;
  private recomputeTimer = 0;
  private lastReportKey = '';

  constructor(root: HTMLElement) {
    this.validationView = new ValidationView(this.skyView);
    this.views = {
      map: this.mapView.node,
      retrofit: this.retrofitView.node,
      sky: this.skyView.node,
      report: this.reportView.node,
      validation: this.validationView.node,
    };
    this.tabBar = el('nav', { class: 'tab-bar' });
    this.buildTabs();
    const header = el('header', { class: 'app-header' },
      el('div', { class: 'title-block' },
        el('h1', {}, '云岚县暗夜星空保护区 · 夜空辉光评估系统'),
        el('p', {}, 'Garstang/Cinzano 单次散射模型 · 瑞利+米氏散射 · WebGL2 实时渲染')
      ),
      el('div', { class: 'header-badge' }, 'SQM 标定 · Bortle · NELM')
    );
    root.append(header, this.tabBar, ...Object.values(this.views));
    store.subscribe((s) => this.onState(s));
    this.switchTab(store.get().activeTab);
    this.scheduleRecompute(true);
  }

  private buildTabs(): void {
    for (const t of TABS) {
      const b = button(t.label, () => this.switchTab(t.id));
      b.classList.add('tab-btn');
      b.dataset.tab = t.id;
      this.tabBar.append(b);
    }
  }

  private switchTab(id: AppState['activeTab']): void {
    store.set({ activeTab: id });
    for (const [key, node] of Object.entries(this.views)) {
      (node as HTMLElement).hidden = key !== id;
    }
    this.tabBar.querySelectorAll<HTMLButtonElement>('.tab-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.tab === id);
    });
    if (id === 'sky') {
      const s = store.get();
      queueMicrotask(() => this.skyView.render(s, effectiveTowns(s)));
    }
  }

  private onState(s: AppState): void {
    // 任何状态变化都刷新鱼眼（隐藏时也渲染，保证验证回读有效）
    this.skyView.render(s, effectiveTowns(s));
    // 报告与地图等亮度环防抖重算
    this.scheduleRecompute();
  }

  /** 重置观测点到默认暗点（e2e 与用户恢复用） */
  resetObserver(): void {
    store.set({ observer: { ...DEFAULT_OBSERVER } });
  }

  /** 恢复 SQM 标定系数为 1（未标定） */
  resetCalibration(): void {
    store.set({ calibration: 1 });
  }

  private scheduleRecompute(immediate = false): void {
    clearTimeout(this.recomputeTimer);
    const run = () => {
      const s = store.get();
      const key = JSON.stringify([s.observer, s.scenario, s.atmo, s.moonFraction, s.moonElDeg, s.cloud, s.calibration, s.baseTowns.map((t) => [t.fixture, t.dim])]);
      if (key === this.lastReportKey) return;
      this.lastReportKey = key;
      this.service.compute(s).then((report) => {
        this.reportView.setReport(report);
        this.mapView.refreshHeat();
        this.skyView.updateReadout(report.zenithMag, report.zenithMicroCd);
      });
    };
    if (immediate) run();
    else this.recomputeTimer = window.setTimeout(run, 120);
  }
}
