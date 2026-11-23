/**
 * Worker 包装：Promise 化请求、序号管理、失败时同步降级。
 */
import { buildReport } from '../physics/skyMap.ts';
import type { SkyReport } from '../physics/skyMap.ts';
import type { AppState } from '../state.ts';
import { effectiveTowns } from '../state.ts';
import type { WorkerRequest, WorkerResponse } from './skyWorker.ts';

export class ReportService {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, (r: SkyReport) => void>();
  private fallbackUsed = false;

  constructor() {
    try {
      this.worker = new Worker(new URL('./skyWorker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
        const cb = this.pending.get(ev.data.id);
        if (cb) {
          this.pending.delete(ev.data.id);
          cb(ev.data.report);
        }
      };
      this.worker.onerror = () => {
        this.fallbackUsed = true;
      };
    } catch {
      this.fallbackUsed = true;
      this.worker = null;
    }
  }

  compute(state: AppState): Promise<SkyReport> {
    const towns = effectiveTowns(state);
    const req: WorkerRequest = {
      id: ++this.seq,
      observer: state.observer,
      towns,
      atmo: state.atmo,
      env: {
        moonFraction: state.moonFraction,
        moonEl: (state.moonElDeg * Math.PI) / 180,
        cloud: state.cloud,
        calibration: state.calibration,
      },
    };
    if (this.fallbackUsed || !this.worker) {
      return Promise.resolve(buildReport(req.observer, req.towns, req.atmo, req.env));
    }
    return new Promise((resolve) => {
      this.pending.set(req.id, resolve);
      this.worker!.postMessage(req);
    });
  }
}
