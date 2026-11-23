/**
 * WebGL2 GLSL 着色器。
 * 人工辉光积分与 src/physics/scatter.ts 的 CPU 实现逐段同构（同常数、同高度断点、同公式），
 * 验证面板通过 readPixels 回读与 CPU 结果比对。
 */

export const VERT_SRC = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }
`;

export const MAX_TOWNS = 16;
export const MAX_STARS = 320;
export const N_HEIGHT_BANDS = 9;

export const FRAG_SRC = `#version 300 es
precision highp float;

out vec4 frag;

uniform vec2  uRes;
uniform vec3  uObserver;      // x, y, h(km)
uniform int   uTownCount;
uniform vec4  uTowns[${MAX_TOWNS}];   // x, y, fUp(lm), shape(0 garstang /1 lambert)
uniform vec4  uTownRGB[${MAX_TOWNS}]; // r, g, b, 0
uniform float uBR0, uBA0, uHR, uHA, uG, uAtmTop, uEarthR;
uniform vec3  uRatioR, uRatioA;
uniform float uHBreaks[10];
uniform int   uSub[${N_HEIGHT_BANDS}];
uniform float uCalib;
uniform float uMoonFrac, uMoonEl, uMoonAz;
uniform float uCloud, uExposure;
uniform float uLST;          // 本地恒星时（弧度）
uniform float uLat;          // 纬度（弧度）
uniform int   uStarCount;
uniform vec4  uStars[${MAX_STARS}]; // ra, dec, mag, tint(0白 1暖 2蓝 3橙)
uniform float uMagZero;
uniform float uNaturalZenithMag, uNaturalHorizonMag;
uniform float uFullMoonZenithMag;
uniform float uTime;         // 云动画秒
uniform int   uRawMode;      // 1=直接输出线性 HDR μcd/m²（HDR FBO）；2=LDR 两通道 16 位打包
uniform float uRawScale;     // LDR 打包归一化尺度

const float PI  = 3.141592653589793;
const float TAU = 6.283185307179586;
const float KM  = 1000.0;

float magToMicro(float m){ return pow(10.0, (uMagZero - m) * 0.4); }
float microToMag(float L){ return uMagZero - 2.5 * (log(max(L, 1e-9))/2.30258509299); }

/* ---------- 上射光角分布（上半球 ∫P dΩ=1） ---------- */
float emissionShape(float type, float cosPsi){
  float c = max(cosPsi, 0.0);
  if (type > 0.5) return c / PI;                         // lambert μ/π
  float raw = 2.0*c*c*c + 0.4*c*c + 0.32*c + 0.16;
  return raw / (2.0 * PI * 0.9533333333);                // garstang 归一化
}

/* ---------- 相函数（全球 ∫ΦdΩ=1） ---------- */
float rayleighPhase(float ct){
  return 3.0/(16.0*PI) * (1.0 + ct*ct);
}
float hgPhase(float ct){
  float g2 = uG*uG;
  float d = 1.0 + g2 - 2.0*uG*ct;
  return (1.0-g2)/(4.0*PI*d*sqrt(d));
}

/* ---------- T→P 光学厚度（平坦指数大气解析解） ---------- */
float slantTau(float b0, float H, float hP, float sinTheta){
  float s = max(sinTheta, 0.02);
  return b0 * H / s * (1.0 - exp(-hP / H));
}

/* ---------- 曲面地球遮挡（2D 切面线段最小离地高度） ---------- */
bool losVisible(float d, float r, float elTP){
  float R = uEarthR;
  vec2 T = vec2(d, R);
  vec2 P = vec2(r*cos(elTP), R + r*sin(elTP));
  vec2 E = P - T;
  float len2 = dot(E,E);
  if (len2 < 1e-9) return true;
  float u = clamp(-dot(T,E)/len2, 0.0, 1.0);
  vec2 Q = T + u*E;
  return length(Q) >= R - 0.02;
}

/* ---------- 人工辉光：返回 RGB（μcd/m²） ---------- */
vec3 artificialSky(float az, float el){
  float sinEl = max(sin(el), 0.002);
  vec3 ray = vec3(sin(az)*cos(el), cos(az)*cos(el), sin(el));
  float hObs = uObserver.z;
  vec3 total = vec3(0.0);
  vec3 tauRCum = vec3(0.0);   // P→O 瑞利累积光学厚度
  vec3 tauACum = vec3(0.0);   // P→O 气溶胶累积光学厚度

  for (int band = 0; band < ${N_HEIGHT_BANDS}; band++){
    float hLo = max(uHBreaks[band], hObs);
    float hHi = uHBreaks[band+1];
    if (hHi <= hObs) continue;
    float sEnd = min((hHi - hObs)/sinEl, (uAtmTop - hObs)/sinEl);
    float sBeg = (hLo - hObs)/sinEl;
    if (sEnd <= sBeg) continue;
    int n = uSub[band];
    for (int k = 0; k < 16; k++){
      if (k >= n) break;
      float f0 = float(k)/float(n);
      float f1 = float(k+1)/float(n);
      float s0 = sBeg + (sEnd-sBeg)*f0;
      float s1 = sBeg + (sEnd-sBeg)*f1;
      float ds = s1 - s0;
      float sMid = 0.5*(s0+s1);
      float hMid = hObs + ray.z*sMid;
      if (hMid < 0.0) break;
      float densR = exp(-hMid/uHR);
      float densA = exp(-hMid/uHA);

      // 观测点→P 累积光学厚度（段内梯形近似，三通道，与 CPU 同构）
      float h0 = max(hObs + ray.z*s0, 0.0);
      float h1 = max(hObs + ray.z*s1, 0.0);
      vec3 dTR = 0.5*(exp(-h0/uHR)+exp(-h1/uHR))*uBR0*uRatioR*ds;
      vec3 dTA = 0.5*(exp(-h0/uHA)+exp(-h1/uHA))*uBA0*uRatioA*ds;
      tauRCum += dTR;
      tauACum += dTA;

      for (int ti = 0; ti < ${MAX_TOWNS}; ti++){
        if (ti >= uTownCount) break;
        vec4 tw = uTowns[ti];
        float dx = tw.x - uObserver.x;
        float dy = tw.y - uObserver.y;
        float d = length(vec2(dx,dy));
        if (d < 0.05) continue;
        float px = uObserver.x + ray.x*sMid;
        float py = uObserver.y + ray.y*sMid;
        vec2 td = vec2(px-tw.x, py-tw.y);
        float horiz = length(td);
        float r2 = horiz*horiz + hMid*hMid;
        if (r2 < 0.01) continue;
        float r = sqrt(r2);
        float sinTheta = hMid/r;
        float elTP = atan(hMid, horiz);
        if (!losVisible(d, r, elTP)) continue;

        vec3 dirTP = vec3(td.x/r, td.y/r, -hMid/r);
        float cosScat = dot(ray, dirTP);
        float phiR = rayleighPhase(cosScat);
        float phiA = hgPhase(cosScat);
        float pShape = emissionShape(tw.w, hMid/r);
        float iV = tw.z * pShape;
        vec3 iRGB = iV * uTownRGB[ti].rgb;

        float geom = max(sinTheta, 0.02);
        vec3 tauTP_R = vec3(
          slantTau(uBR0*uRatioR.r, uHR, hMid, geom),
          slantTau(uBR0*uRatioR.g, uHR, hMid, geom),
          slantTau(uBR0*uRatioR.b, uHR, hMid, geom));
        vec3 tauTP_A = vec3(
          slantTau(uBA0*uRatioA.r, uHA, hMid, geom),
          slantTau(uBA0*uRatioA.g, uHA, hMid, geom),
          slantTau(uBA0*uRatioA.b, uHA, hMid, geom));
        vec3 extTP = exp(-(tauTP_R + tauTP_A));
        vec3 extPO = exp(-(tauRCum + tauACum));
        float invR2 = 1.0/(r2*KM*KM);
        vec3 dRay = uBR0*uRatioR*densR*phiR;
        vec3 dAer = uBA0*uRatioA*densA*phiA;
        vec3 commonTerm = iRGB*invR2*extTP*extPO*(ds*KM);
        total += commonTerm*(dRay+dAer);
      }
    }
  }
  return total * 1.0e6 * uCalib; // cd/m² → μcd/m²
}

/* ---------- 天然夜空、月光、云 ---------- */
float naturalSky(float el){
  float zen = magToMicro(uNaturalZenithMag);
  float s = max(sin(el), 0.02);
  float vanRhijn = 1.0/sqrt(s*s + 0.08);
  float horizon = magToMicro(uNaturalHorizonMag)*exp(-max(el,0.0)/0.12);
  return zen*vanRhijn + horizon;
}
float moonlight(float el){
  if (uMoonFrac <= 0.001 || uMoonEl <= 0.0) return 0.0;
  float s = max(sin(uMoonEl), 0.03);
  float am = 1.0/s;
  float zen = magToMicro(uFullMoonZenithMag);
  return zen * pow(uMoonFrac, 1.5) * exp(-0.15*(am-1.0)) / sqrt(s*s+0.1);
}

/* ---------- 天球坐标：az/el → RA/Dec ---------- */
vec3 azelToDir(float az, float el){
  return vec3(sin(az)*cos(el), cos(az)*cos(el), sin(el));
}
void dirToRaDec(vec3 d, out float ra, out float dec){
  float A = atan(d.x, d.y);
  float alt = asin(clamp(d.z,-1.0,1.0));
  float sinDec = sin(uLat)*sin(alt) + cos(uLat)*cos(alt)*cos(A);
  dec = asin(clamp(sinDec,-1.0,1.0));
  float sinH = -cos(alt)*sin(A)/max(cos(dec),1e-4);
  float cosH = (sin(alt)*cos(uLat) - cos(alt)*sin(uLat)*cos(A))/max(cos(dec),1e-4);
  float H = atan(sinH, cosH);
  ra = mod(uLST - H, TAU);
}
void raDecToDir(float ra, float dec, out float az, out float el){
  float H = uLST - ra;
  float sinAlt = sin(uLat)*sin(dec) + cos(uLat)*cos(dec)*cos(H);
  el = asin(clamp(sinAlt,-1.0,1.0));
  float sinA = -cos(dec)*sin(H)/max(cos(el),1e-4);
  float cosA = (sin(dec)*cos(uLat) - cos(dec)*sin(uLat)*cos(H))/max(cos(el),1e-4);
  az = mod(atan(sinA, cosA), TAU);
}

/* ---------- 银河带（银道坐标系简化） ---------- */
float milkyWay(float ra, float dec){
  float raP = 3.353, decP = 0.482;          // 北银极
  float raGC = 4.643, decGC = -0.506;       // 银心
  float sinB = sin(dec)*sin(decP) + cos(dec)*cos(decP)*cos(ra-raP);
  float b = asin(clamp(sinB,-1.0,1.0));
  float band = exp(-pow(b/0.10, 2.0));      // 半宽 ~5.7°
  float cosGC = sin(dec)*sin(decGC)+cos(dec)*cos(decGC)*cos(ra-raGC);
  float bulge = 0.35 + 1.6*pow(max(cosGC,0.0), 6.0);
  // 暗纹
  float streak = 0.75 + 0.25*sin(ra*7.0+1.3)*sin(dec*9.0-0.6);
  return band * bulge * streak;
}

/* ---------- 哈希噪声（云） ---------- */
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p){
  vec2 i=floor(p), f=fract(p);
  float a=hash(i), b=hash(i+vec2(1,0)), c=hash(i+vec2(0,1)), d=hash(i+vec2(1,1));
  vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}
float fbm(vec2 p){
  float v=0.0, a=0.5;
  for(int i=0;i<5;i++){ v+=a*noise(p); p=p*2.03+11.7; a*=0.5; }
  return v;
}

/* ---------- 主程序 ---------- */
void main(){
  vec2 ndc = (gl_FragCoord.xy / uRes) * 2.0 - 1.0;
  ndc.x *= uRes.x/uRes.y;
  float r = length(ndc);
  if (r > 1.0){
    frag = vec4(0.012, 0.014, 0.02, 1.0);   // 鱼眼圆外地表/留白
    return;
  }
  float el = (1.0 - r) * PI * 0.5;
  float az = mod(atan(ndc.x, -ndc.y) + TAU, TAU); // 屏幕上方=北

  vec3 art = artificialSky(az, el);
  float nat = naturalSky(el);
  float moon = moonlight(el);

  // 云：在 az/el 上做 fbm，coverage 控制覆盖率
  vec2 cn = vec2(az*3.0, el*6.0) + vec2(uTime*0.02, 0.0);
  float cl = smoothstep(1.0-uCloud-0.25, 1.0-uCloud+0.25, fbm(cn));
  float cloudMask = cl * smoothstep(0.0, 0.08, el);
  float artGain = 1.0 + 1.85*cloudMask*cloudMask;
  float celTrans = exp(-2.2*cloudMask);

  vec3 celestial = vec3(nat*0.92, nat, nat*1.12);
  // 月光圆盘
  if (uMoonFrac > 0.001 && uMoonEl > 0.0){
    float dAng = acos(clamp(dot(azelToDir(az,el), azelToDir(uMoonAz,uMoonEl)),-1.0,1.0));
    float disk = smoothstep(0.006, 0.0025, dAng);
    celestial += vec3(0.95,0.97,1.0)*disk*magToMicro(uFullMoonZenithMag)*180.0*pow(uMoonFrac,1.5);
  }
  celestial = celestial * celTrans;
  vec3 artMod = art * artGain;

  // 银河与恒星（受云衰减）
  float ra, dec;
  dirToRaDec(azelToDir(az,el), ra, dec);
  float bgMag = microToMag(artMod.g + celestial.g);
  float mw = milkyWay(ra, dec) * magToMicro(22.6) * 1.4;
  vec3 mwColor = vec3(0.85,0.9,1.0)*mw*celTrans;
  // 背景越亮，银河对比越弱
  float mwSuppress = clamp(1.3 - artMod.g/900.0, 0.08, 1.0);
  mwColor *= mwSuppress;

  vec3 starLight = vec3(0.0);
  float pxScale = PI*0.5 / (uRes.y*0.5); // 每像素弧度
  // PSF 高斯（无量纲，中心=1）；σ 取 1.3 像素
  float sigma = pxScale*1.3;
  for (int i=0;i<${MAX_STARS};i++){
    if (i >= uStarCount) break;
    vec4 st = uStars[i];
    float saz, sel;
    raDecToDir(st.x, st.y, saz, sel);
    if (sel < 0.0) continue;
    vec3 sd = azelToDir(saz, sel);
    float ang = acos(clamp(dot(sd, azelToDir(az,el)),-1.0,1.0));
    float g = exp(-0.5*pow(ang/sigma,2.0));
    // 0 等星点中心亮度约 9000 μcd/m²（亮于一般光穹），每暗 1 等降 2.512 倍
    float flux = 9000.0 * pow(10.0, -0.4*st.z);
    // 背景淹没：暗于当地极限星等的恒星淡出
    float nelm = clamp(0.52*bgMag - 4.9, 2.5, 7.5);
    float vis = clamp((nelm - st.z)*1.4, 0.0, 1.0);
    vec3 tint = st.w>2.5 ? vec3(1.0,0.62,0.35) : st.w>1.5 ? vec3(0.7,0.82,1.0) : st.w>0.5 ? vec3(1.0,0.82,0.6) : vec3(1.0);
    starLight += tint * flux * g * vis * celTrans;
  }

  vec3 hdr = artMod + celestial + mwColor + starLight;

  if (uRawMode == 1){
    frag = vec4(hdr, 1.0);    // 线性 HDR（μcd/m²），RGBA16F
    return;
  }
  if (uRawMode == 2){
    // LDR 回退：G 通道按 uRawScale 归一化后拆成 16 位存入 R/G
    float v = clamp(hdr.g / uRawScale, 0.0, 1.0);
    float hi = floor(v * 255.0) / 255.0;
    float lo = fract(v * 255.0);
    frag = vec4(hi, lo, 0.0, 1.0);
    return;
  }
  // 色调映射：指数压缩 + gamma。
  // 系数标定：天然暗夜(~180 μcd/m²)映射到约 0.18、光穹亮区(~8000)接近饱和但保留层次。
  vec3 mapped = 1.0 - exp(-hdr * uExposure * 3.2e-5);
  mapped = pow(max(mapped, 0.0), vec3(1.0/2.2));
  frag = vec4(mapped, 1.0);
}
`;
