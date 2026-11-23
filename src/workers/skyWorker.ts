/**
 * 天空亮度网格/报告计算 Worker。
 * 输入当前状态快照，输出报告（含网格）。主线程超时可降级为同步计算。
 */
import { buildReport } from '../physics/skyMap.ts';
import type { SkyReport } from '../physics/skyMap.ts';
import type { Town, AtmosphereParams } from '../physics/constants.ts';
export interface WorkerRequest {
  id: number;
  observer: { x: number; y: number; h: number };
  towns: Town[];
  atmo: AtmosphereParams;
  env: { moonFraction: number; moonEl: number; cloud: number; calibration: number };
}

export interface WorkerResponse {
  id: number;
  report: SkyReport;
}

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  const report = buildReport(req.observer, req.towns, req.atmo, req.env);
  const res: WorkerResponse = { id: req.id, report };
  (self as unknown as Worker).postMessage(res);
};
