/**
 * WebGL2 全天空渲染器：鱼眼投影、人工辉光积分、星空/银河/月相/云、色调映射。
 * HDR 浮点 FBO 保留线性 μcd/m² 供验证面板 readPixels 与 CPU 结果比对。
 */
import {
  AEROSOL_RATIO,
  ANGSTROM_ALPHA,
  BETA_R0,
  EARTH_RADIUS,
  FIXTURES,
  FULL_MOON_ZENITH_MAG,
  H_AEROSOL,
  H_RAYLEIGH,
  LAMBDA_V,
  MAG_ZERO,
  MIE_G,
  NATURAL_HORIZON_MAG,
  NATURAL_ZENITH_MAG,
  RAYLEIGH_LAMBDA_POWER,
  WAVELENGTHS,
} from '../physics/constants.ts';
import type { AtmosphereParams, Town } from '../physics/constants.ts';
import { ATM_TOP_H } from '../physics/constants.ts';
import { bandSubCounts, HEIGHT_BREAKS, townUpwardLumens } from '../physics/scatter.ts';
import { FRAG_SRC, MAX_STARS, MAX_TOWNS, N_HEIGHT_BANDS, VERT_SRC } from './shaders.ts';
import { buildStarCatalog } from './starCatalog.ts';
import type { AppState } from '../state.ts';

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error('着色器编译失败: ' + log);
  }
  return sh;
}

export class SkyRenderer {
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private loc: Record<string, WebGLUniformLocation | null> = {};
  private hdrTex: WebGLTexture | null = null;
  private hdrFbo: WebGLFramebuffer | null = null;
  private fboW = 0;
  private fboH = 0;
  /** 浮点渲染目标是否可用（EXT_color_buffer_float） */
  private hdrSupported = false;
  private stars = buildStarCatalog(MAX_STARS);
  private startTime = performance.now();

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false })!;
    if (!gl) throw new Error('当前浏览器不支持 WebGL2');
    this.gl = gl;
    // 浮点 FBO 渲染支持（WebGL2 需显式启用）
    this.hdrSupported = !!gl.getExtension('EXT_color_buffer_float');
    const vs = compile(gl, gl.VERTEX_SHADER, VERT_SRC);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error('着色器链接失败: ' + gl.getProgramInfoLog(prog));
    }
    this.prog = prog;
    gl.useProgram(prog);
    for (const name of [
      'uRes', 'uObserver', 'uTownCount', 'uTowns', 'uTownRGB',
      'uBR0', 'uBA0', 'uHR', 'uHA', 'uG', 'uAtmTop', 'uEarthR',
      'uRatioR', 'uRatioA', 'uHBreaks', 'uSub', 'uCalib',
      'uMoonFrac', 'uMoonEl', 'uMoonAz', 'uCloud', 'uExposure',
      'uLST', 'uLat', 'uStarCount', 'uStars', 'uMagZero',
      'uNaturalZenithMag', 'uNaturalHorizonMag', 'uFullMoonZenithMag', 'uTime', 'uRawMode', 'uRawScale',
    ]) {
      this.loc[name] = gl.getUniformLocation(prog, name);
    }
    // 全屏三角形
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.ensureFbo(canvas.width, canvas.height);
  }

  private ensureFbo(w: number, h: number): void {
    const gl = this.gl;
    if (w === this.fboW && h === this.fboH && this.hdrTex) return;
    if (this.hdrTex) gl.deleteTexture(this.hdrTex);
    if (this.hdrFbo) gl.deleteFramebuffer(this.hdrFbo);
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (this.hdrSupported) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    } else {
      // 回退：LDR RGBA8，raw 模式输出经压缩编码（验证面板标记为近似值）
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error('帧缓冲不可用');
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.hdrTex = tex;
    this.hdrFbo = fbo;
    this.fboW = w;
    this.fboH = h;
  }

  isHdrSupported(): boolean {
    return this.hdrSupported;
  }

  /** e2e 诊断：渲染并 dump 目标像素周围 3×3 的原始值 */
  dumpFbo(state: AppState, towns: Town[], az: number, el: number) {
    const gl = this.gl;
    const size = 128;
    this.ensureFbo(size, size);
    this.bindCommon(state, towns);
    gl.uniform1i(this.loc.uStarCount, 0);
    gl.uniform1i(this.loc.uRawMode, this.hdrSupported ? 1 : 2);
    gl.uniform1f(this.loc.uRawScale, this.hdrSupported ? 1 : 20000);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.hdrFbo);
    gl.viewport(0, 0, size, size);
    gl.uniform2f(this.loc.uRes, size, size);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const rr = 1 - el / (Math.PI * 0.5);
    const sx = Math.round(((rr * Math.sin(az) + 1) * 0.5) * (size - 1));
    const sy = Math.round(((-rr * Math.cos(az) + 1) * 0.5) * (size - 1));
    const out: Record<string, number[]> = {};
    if (this.hdrSupported) {
      const px = new Float32Array(size * size * 4);
      gl.readPixels(0, 0, size, size, gl.RGBA, gl.FLOAT, px);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const i = ((sy + dy) * size + (sx + dx)) * 4;
        out[`${dx},${dy}`] = [px[i], px[i + 1], px[i + 2]];
      }
      // 同时 dump 中心像素与鱼眼圆内随机点
      const c = (Math.floor(size / 2) * size + Math.floor(size / 2)) * 4;
      out['center'] = [px[c], px[c + 1], px[c + 2]];
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { hdr: this.hdrSupported, target: [sx, sy], samples: out };
  }

  private uploadTowns(towns: Town[]): void {
    const gl = this.gl;
    const n = Math.min(towns.length, MAX_TOWNS);
    const tv = new Float32Array(MAX_TOWNS * 4);
    const rgb = new Float32Array(MAX_TOWNS * 4);
    towns.slice(0, n).forEach((t, i) => {
      const spec = FIXTURES[t.fixture];
      tv[i * 4] = t.x;
      tv[i * 4 + 1] = t.y;
      tv[i * 4 + 2] = townUpwardLumens(t);
      tv[i * 4 + 3] = spec.shape === 'lambert' ? 1 : 0;
      rgb[i * 4] = spec.rgb[0];
      rgb[i * 4 + 1] = 1;
      rgb[i * 4 + 2] = spec.rgb[2];
    });
    gl.uniform4fv(this.loc.uTowns, tv);
    gl.uniform4fv(this.loc.uTownRGB, rgb);
    gl.uniform1i(this.loc.uTownCount, n);
  }

  private uploadConstants(atmo: AtmosphereParams, calibration: number, steps: number): void {
    const gl = this.gl;
    const ratioR = WAVELENGTHS.map((w) => (LAMBDA_V / w) ** RAYLEIGH_LAMBDA_POWER);
    const ratioA = WAVELENGTHS.map((w) => (LAMBDA_V / w) ** ANGSTROM_ALPHA);
    gl.uniform1f(this.loc.uBR0, BETA_R0);
    gl.uniform1f(this.loc.uBA0, atmo.clarity * BETA_R0 * AEROSOL_RATIO);
    gl.uniform1f(this.loc.uHR, H_RAYLEIGH);
    gl.uniform1f(this.loc.uHA, atmo.hAerosol || H_AEROSOL);
    gl.uniform1f(this.loc.uG, MIE_G);
    gl.uniform1f(this.loc.uAtmTop, ATM_TOP_H);
    gl.uniform1f(this.loc.uEarthR, EARTH_RADIUS);
    gl.uniform3fv(this.loc.uRatioR, ratioR);
    gl.uniform3fv(this.loc.uRatioA, ratioA);
    gl.uniform1f(this.loc.uCalib, calibration);
    gl.uniform1fv(this.loc.uHBreaks, HEIGHT_BREAKS.slice(0, 10));
    const subs = bandSubCounts(steps);
    const padded = new Array(N_HEIGHT_BANDS).fill(0);
    subs.slice(0, N_HEIGHT_BANDS).forEach((v, i) => (padded[i] = v));
    gl.uniform1iv(this.loc.uSub, padded.slice(0, N_HEIGHT_BANDS));
  }

  private uploadStars(): void {
    const gl = this.gl;
    const arr = new Float32Array(MAX_STARS * 4);
    this.stars.slice(0, MAX_STARS).forEach((s, i) => {
      arr[i * 4] = s.ra;
      arr[i * 4 + 1] = s.dec;
      arr[i * 4 + 2] = s.mag;
      arr[i * 4 + 3] = s.tint;
    });
    gl.uniform4fv(this.loc.uStars, arr);
    gl.uniform1i(this.loc.uStarCount, Math.min(this.stars.length, MAX_STARS));
  }

  private bindCommon(state: AppState, towns: Town[]): void {
    const gl = this.gl;
    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);
    gl.uniform2f(this.loc.uRes, this.canvas.width, this.canvas.height);
    gl.uniform3f(this.loc.uObserver, state.observer.x, state.observer.y, state.observer.h);
    this.uploadTowns(towns);
    this.uploadConstants(state.atmo, state.calibration, state.gpuSteps);
    gl.uniform1f(this.loc.uMoonFrac, state.moonFraction);
    gl.uniform1f(this.loc.uMoonEl, (state.moonElDeg * Math.PI) / 180);
    gl.uniform1f(this.loc.uMoonAz, (state.moonAzDeg * Math.PI) / 180);
    gl.uniform1f(this.loc.uCloud, state.cloud);
    gl.uniform1f(this.loc.uExposure, state.exposure);
    // 本地恒星时：恒星时角滑块（度）转弧度，纬度取县域固定值 31°N
    gl.uniform1f(this.loc.uLST, (state.siderealDeg * Math.PI) / 180 + 2.0);
    gl.uniform1f(this.loc.uLat, (31 * Math.PI) / 180);
    this.uploadStars();
    gl.uniform1f(this.loc.uMagZero, MAG_ZERO);
    gl.uniform1f(this.loc.uNaturalZenithMag, NATURAL_ZENITH_MAG);
    gl.uniform1f(this.loc.uNaturalHorizonMag, NATURAL_HORIZON_MAG);
    gl.uniform1f(this.loc.uFullMoonZenithMag, FULL_MOON_ZENITH_MAG);
    gl.uniform1f(this.loc.uTime, (performance.now() - this.startTime) / 1000);
  }

  /** 渲染到屏幕（LDR 色调映射） */
  render(state: AppState, towns: Town[]): void {
    const gl = this.gl;
    this.bindCommon(state, towns);
    gl.uniform1i(this.loc.uRawMode, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /**
   * 读取指定 az/el 处的 HDR 线性亮度（μcd/m²，RGB），供 CPU/GPU 比对。
   * 渲染到方形浮点 FBO，再按鱼眼投影公式回读对应像素。
   */
  readRawRadiance(state: AppState, towns: Town[], az: number, el: number): { rgb: [number, number, number]; mag: number } {
    const gl = this.gl;
    const size = 128;
    this.ensureFbo(size, size);
    this.bindCommon(state, towns);
    // 比对只针对天空辉光场：关闭星表（CPU 参考实现不含星点）
    gl.uniform1i(this.loc.uStarCount, 0);
    const rawMode = this.hdrSupported ? 1 : 2;
    gl.uniform1i(this.loc.uRawMode, rawMode);
    // LDR 打包尺度：覆盖当前状态的典型最大亮度（μcd/m²）
    const rawScale = this.hdrSupported ? 1 : 20000;
    gl.uniform1f(this.loc.uRawScale, rawScale);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.hdrFbo);
    gl.viewport(0, 0, size, size);
    gl.uniform2f(this.loc.uRes, size, size);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const rr = 1 - el / (Math.PI * 0.5);
    const ndcX = rr * Math.sin(az);
    const ndcY = -rr * Math.cos(az);
    const sx = Math.round(((ndcX + 1) * 0.5) * (size - 1));
    const sy = Math.round(((ndcY + 1) * 0.5) * (size - 1));
    const i = (sy * size + sx) * 4;

    if (this.hdrSupported) {
      const px = new Float32Array(size * size * 4);
      gl.readPixels(0, 0, size, size, gl.RGBA, gl.FLOAT, px);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      const rgb: [number, number, number] = [px[i], px[i + 1], px[i + 2]];
      return { rgb, mag: MAG_ZERO - 2.5 * Math.log10(Math.max(rgb[1], 1e-9)) };
    }
    const px = new Uint8Array(size * size * 4);
    gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const gMicro = (px[i] / 255 + px[i + 1] / 65025) * rawScale;
    const rgb: [number, number, number] = [gMicro, gMicro, gMicro];
    return { rgb, mag: MAG_ZERO - 2.5 * Math.log10(Math.max(gMicro, 1e-9)) };
  }
}
