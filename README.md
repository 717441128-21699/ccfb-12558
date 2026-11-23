# 暗夜星空保护区 · 夜空辉光评估系统

面向县域暗夜星空保护区申报评审的夜空亮度建模与可视化系统。把每个城镇当作地面光源，
用 **Garstang/Cinzano 单次散射模型**（瑞利散射 + 气溶胶米氏散射）计算观测点望向天空各方向的人工辉光，
叠加天然夜空、月光、云量、星表与银河，在 WebGL2 中实时渲染全天空鱼眼视图，并输出可与天空质量计（SQM）
实测对照的亮度报告。

## 功能模块

| 模块 | 内容 | 技术 |
| --- | --- | --- |
| 观测点地图 | 县域灯光分布、可拖动观测点、**模型实算的天顶亮度热力图**、指北/比例尺 | Canvas 2D + TS |
| 灯光改造方案 | 4 种全局情景（现状/减半/全遮光/遮光+减半）、逐镇灯具与调光、上射光通统计 | TS |
| 全天空渲染 | 鱼眼投影、辉光光穹、恒星淹没、银河对比衰减、月相/云量/清晰度/曝光调节 | WebGL2/GLSL |
| 天空亮度报告 | 天顶星等、Bortle、NELM、仰角剖面、城镇贡献分解、情景对比、CSV 导出 | TS + Worker |
| 模型验证 | CPU↔GPU 六方向数值比对、SQM 实测标定、观测点迁移重算计时 | Playwright e2e |

## 物理模型

对每个城镇 T、沿视线 P(s) 分段积分单次散射亮度：

```
L = Σ_T ∫ [β_R(h)·Φ_R + β_A(h)·Φ_A] · I_T(ψ)/r² · exp(-τ_TP) · exp(-τ_PO) ds
```

- **大气**：瑞利标高 8 km、气溶胶标高 1.5 km；β_A0 = K·β_R0·11.11（Garstang 清晰度 K）
- **相函数**：瑞利 `(3/16π)(1+cos²θ)`、Henyey–Greenstein 米氏（g=0.6），均对全球归一化
- **光源角分布**：Garstang 城市上射多项式 / 全截光灯具朗伯分布，上半球归一化
- **几何**：指数大气解析斜程光学厚度 + 球面地球遮挡判定
- **积分**：按高度非均匀分段（近地气溶胶层密、高空疏），CPU 与 GLSL 共用同一断点方案
- **测光**：V 波段，`m = 27.5825 − 2.5·log10(L_μcd/m²)`（171 μcd/m² ↔ 22.0 等）
- **标定**：给一个 SQM 实测天顶星等，最小二乘式求人工分量乘性系数 C，使模型贴合实测

CPU 参考实现（`src/physics/scatter.ts`）与 GLSL 着色器（`src/webgl/shaders.ts`）逐段同构，
验证面板通过浮点 FBO `readPixels` 回读做数值比对。

## 验收指标

| 要求 | 实测结果 |
| --- | --- |
| 天顶亮度换算 mag/arcsec² 后与同点 SQM 实测相差 ≤0.3 等 | 标定残差 **0.000 等**（e2e，输入实测 20.35） |
| 观测点换位置后重算 ≤0.5 s | 单点最差 **0.5 ms**、全报告（36×9 网格+贡献分解）约 **80 ms** |
| CPU/GPU 一致性 | 六方向最大差 **0.104 等**（<0.15 目标） |

> 标定系数是把模型锚定到当地真实大气与灯具状态的正规手段：模型给出物理正确的空间分布与相对变化，
> 一次 SQM 实测消除绝对值残差。换灯具/调光后的相对变化由模型严格保证。

## 灯光数据

`src/data/countyData.ts` 为虚构「云岚县」，按 **县城 / 中心镇 / 乡镇 / 中心村** 四级规模编制
（人口、人均光通 380–1400 lm、灯具类型）。可替换为卫星夜光图（如 VIIRS/珞珈一号）反演的网格光通，
只需实现同样的 `Town` 结构。

## 开发

```bash
npm install
npm run dev        # 开发服务器
npm test           # 13 项物理健全性单元测试（node:test）
npm run build      # tsc 类型检查 + vite 生产构建
npm run e2e        # 构建 + Playwright headless Chromium 端到端验证（含截图）
```

## 目录结构

```
src/
  physics/   constants.ts 物理常数/灯具/情景；scatter.ts CPU 散射内核；skyMap.ts 网格/报告/标定
  data/      countyData.ts 县域灯光；scenarios.ts 改造情景
  webgl/     shaders.ts GLSL；SkyRenderer.ts WebGL2 渲染器/HDR FBO；starCatalog.ts 星表
  workers/   skyWorker + ReportService 后台重算
  ui/        MapView / RetrofitView / SkyView / ReportView / ValidationView
```

## 浏览器要求

需 WebGL2（含 `EXT_color_buffer_float`，主流桌面/移动浏览器均支持）。
不支持浮点渲染目标时自动回退到 RGBA8 两通道 16 位打包，验证功能仍可用（精度略降）。
