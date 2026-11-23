import './styles.css';
import { App } from './App.ts';

const root = document.getElementById('app');
if (!root) throw new Error('缺少 #app 挂载点');
const app = new App(root);
// 开发期诊断钩子（e2e 验证使用）
(window as unknown as Record<string, unknown>).__skyApp = app;
