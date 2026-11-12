/* SHADOW EXTRACTION — 군인 캐릭터 레이어
 * soldier_data.js(Tactical_Soldier_02.obj 변환본)를 이용해
 *  - 아군/적(PMC·스캐브)을 이 군인 모델로 교체 (적은 얼굴·머리·수염·장비가 조금씩 다름)
 *  - 1인칭 시점의 팔/손을 이 군인의 팔로 교체
 * 문제가 생기면 try/catch 로 원래(박스) 모델로 돌아갑니다.
 */
(() => {
'use strict';
const D = window.SOLDIER_DATA;
if (!D) { console.warn('soldier.js: soldier_data.js 없음 — 건너뜀'); return; }

/* ================================================================
 *  1) 순수 계산부 (THREE 없이 동작 — 테스트 가능)
 * ================================================================ */
const SC = D.scale, NV = D.nv, NT = D.nt;
const b64 = s => { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; };
const buf = b64(D.b64);
let _o = 0;
const POS16 = new Int16Array(buf, _o, NV * 3); _o += NV * 6;
const NOR8 = new Int8Array(buf, _o, NV * 3); _o += NV * 3;
const REG = new Uint8Array(buf, _o, NV); _o += NV;
const SKI = new Uint8Array(buf, _o, NV * 3); _o += NV * 3;
const SKW = new Uint8Array(buf, _o, NV * 3); _o += NV * 3;
const IDX = new Uint16Array(buf, _o, NT * 3);
const BASEP = new Float32Array(NV * 3), BASEN = new Float32Array(NV * 3);
for (let i = 0; i < NV * 3; i++) { BASEP[i] = POS16[i] / 100; BASEN[i] = NOR8[i] / 127; }
const BJ = D.bones.map(b => b[2]), BPAR = D.bones.map(b => b[1]), BNAME = D.bones.map(b => b[0]);
const BI = {}; BNAME.forEach((n, i) => { BI[n] = i; });
const R_SK = 0, R_JK = 1, R_PN = 2, R_BT = 3, R_GL = 4, R_SC = 5, R_IR = 6, R_BL = 7, R_PU = 8;

// ---- 작은 수학 도우미 (배열 기반) ----
const v3 = { sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], len: a => Math.hypot(a[0], a[1], a[2]),
  norm: a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]] };
const qn = q => { const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]; };
const qMul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const qConj = q => [-q[0], -q[1], -q[2], q[3]];
const qAxis = (ax, ang) => { const s = Math.sin(ang / 2), a = v3.norm(ax); return [a[0] * s, a[1] * s, a[2] * s, Math.cos(ang / 2)]; };
const qFromTo = (a, b) => {          // a→b 로 돌리는 최소 회전 (a,b 단위벡터)
  const d = v3.dot(a, b);
  if (d < -0.999999) { let ax = v3.cross([1, 0, 0], a); if (v3.len(ax) < 1e-4) ax = v3.cross([0, 1, 0], a); return qAxis(ax, Math.PI); }
  const c = v3.cross(a, b); return qn([c[0], c[1], c[2], 1 + d]);
};
const qRot = (q, v) => { const u = [q[0], q[1], q[2]], t = v3.mul(v3.cross(u, v), 2); return v3.add(v3.add(v, v3.mul(t, q[3])), v3.cross(u, t)); };
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// ---- 시드 난수 (게임의 R() 과 분리: 파티 레이드 동기화를 깨지 않음) ----
function rngOf(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const hash2 = (x, z, k) => (Math.imul(Math.round(x * 7.3) | 0, 73856093) ^ Math.imul(Math.round(z * 7.3) | 0, 19349663) ^ Math.imul(k | 0, 83492791)) >>> 0;
const strHash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

// ---- 색상 ----
const HX = x => [(x >> 16 & 255) / 255, (x >> 8 & 255) / 255, (x & 255) / 255];
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const SKIN = [0xf0c8a6, 0xe3b08a, 0xcb9068, 0xa8714a, 0x7f5035, 0x5e3a28];
const HAIRC = [0x17110d, 0x2a1c13, 0x4a3222, 0x6b4a2c, 0x9a7a46, 0xc2a063, 0x8a8a88, 0x9a4a1e];
const EYEC = [0x3b2a1a, 0x4f7396, 0x5f8a58, 0x7d6244, 0x555a62];
const SCAV_JK = [0x5b5a45, 0x6d5b46, 0x4a4f58, 0x3f4a3a, 0x76706a, 0x5e3f35, 0x39424a];
const SCAV_PN = [0x3a3f45, 0x4a4333, 0x2f3a2d, 0x5b5f64, 0x3a3228];
const SCAV_HAT = [0x6b2f2a, 0x2f3a4a, 0x4a4a3a, 0x1f1f22, 0x7a7466, 0x3a5a3a];
const pick = (r, arr) => arr[Math.min(arr.length - 1, Math.floor(r() * arr.length))];

// ---- 외형 결정 (kind: friend | pmc | scav) ----
function look(kind, seed) {
  const r = rngOf(seed ^ 0xA5F1523D);
  const L = { kind, seed };
  if (kind === 'friend') {
    Object.assign(L, { skin: 0xe3b08a, hair: 0x2a1c13, eye: 0x3b2a1a, hairStyle: 'short', beard: 'none', hat: 'helmet', hatC: 0x2b3a2b, glasses: 'none', mask: 0, maskC: 0,
      jk: 0x4b5540, pn: 0x3b4432, bt: 0x1c1814, gl: 0x1d1d1d, vest: 0x2f6f9f, pack: 1, packC: 0x34402b, morph: false });
    return L;
  }
  const pmc = kind === 'pmc';
  L.morph = true;
  L.skin = pick(r, SKIN); L.hair = pick(r, HAIRC); L.eye = pick(r, EYEC);
  const hs = r(); L.hairStyle = hs < .12 ? 'bald' : hs < .38 ? 'buzz' : hs < .78 ? 'short' : 'long';
  const bd = r(); L.beard = bd < (pmc ? .55 : .45) ? 'none' : bd < .75 ? 'stubble' : bd < .9 ? 'full' : 'goatee';
  if (pmc) {
    const h = r(); L.hat = h < .8 ? 'helmet' : h < .92 ? 'cap' : 'none'; L.hatC = pick(r, [0x1a1c1e, 0x23251f, 0x2d2a22]);
    const g = r(); L.glasses = g < .3 ? 'goggles' : g < .5 ? 'shades' : 'none';
    L.mask = r() < .28 ? 1 : 0; L.maskC = pick(r, [0x1d1d1d, 0x2a2e2a, 0x3a3a34]);
    L.jk = pick(r, [0x2c302b, 0x262a2d, 0x30332a]); L.pn = pick(r, [0x2f3329, 0x2a2d30, 0x34362b]); L.bt = 0x15110e; L.gl = 0x161616;
    L.vest = pick(r, [0x15171a, 0x1f2320, 0x2b2b27]); L.pack = r() < .75 ? 1 : 0; L.packC = pick(r, [0x1d2018, 0x2a2a26, 0x25272b]);
  } else {
    const h = r(); L.hat = h < .35 ? 'none' : h < .6 ? 'beanie' : h < .82 ? 'cap' : 'hood'; L.hatC = pick(r, SCAV_HAT);
    const g = r(); L.glasses = g < .16 ? 'shades' : 'none';
    L.mask = r() < .22 ? 1 : 0; L.maskC = pick(r, [0x6d6a5a, 0x4a4a4a, 0x7a3a30]);
    L.jk = pick(r, SCAV_JK); L.pn = pick(r, SCAV_PN); L.bt = pick(r, [0x2a221b, 0x15110e, 0x3a2e22]); L.gl = r() < .5 ? pick(r, [0x2a2a2a, 0x3a3226]) : 0;
    L.vest = r() < .35 ? pick(r, [0x5a5a48, 0x4a4030]) : 0; L.pack = r() < .55 ? 1 : 0; L.packC = pick(r, [0x4a4a38, 0x5a3a2a, 0x3a4048, 0x6a604a]);
  }
  // 얼굴 변형 파라미터
  const u = () => r();
  L.P = { sx: .93 + .14 * u(), sy: .95 + .1 * u(), sz: .95 + .1 * u(), jw: .86 + .28 * u(), chin: (u() - .5) * 1.6, np: .85 + .6 * u(), nw: .85 + .45 * u(),
    es: (u() - .5) * 1.2, ey: (u() - .5) * .8, br: u() * .9, ck: (u() - .5) * 1.4, ear: .9 + .55 * u(), nl: (u() - .5) * 1.4 };
  return L;
}

// ---- 머리 정점 목록 (얼굴 변형/머리카락/수염 대상) ----
const HEAD = [], HW = new Float32Array(NV);
for (let i = 0; i < NV; i++) {
  let hw = 0; for (let k = 0; k < 3; k++) if (SKI[i * 3 + k] === BI.head) hw += SKW[i * 3 + k] / 255;
  HW[i] = hw;
  if (hw > 0.001 || REG[i] === R_SC || REG[i] === R_IR || REG[i] === R_PU) HEAD.push(i);
}
const HCEN = [0, 168.5, -1.5];

function morphPoint(p, hw, P) {
  const x = p[0], y = p[1], z = p[2], ax = Math.abs(x), sg = x < 0 ? -1 : 1;
  let nx = x * lerp(1, P.sx, hw), ny = 168 + (y - 168) * lerp(1, P.sy, hw), nz = z * lerp(1, P.sz, hw);
  const jawT = sstep(167, 157, y) * hw;                       // 턱 (아래쪽일수록)
  nx *= 1 + (P.jw - 1) * jawT;
  nz += P.chin * sstep(165, 158, y) * sstep(2, 6, z) * hw;
  const nt = Math.exp(-((ax / 2.8) ** 2) - (((y - 165.5) / 3.6) ** 2)) * sstep(5, 7.5, z) * hw;   // 코
  nz += (P.np - 1) * 3 * nt; nx *= 1 + (P.nw - 1) * nt; ny += P.nl * nt;
  const eb = Math.exp(-(((ax - 3.2) / 3.2) ** 2) - (((y - 170) / 2.8) ** 2)) * sstep(0, 3, z) * hw;  // 눈 간격/높이
  nx += sg * P.es * eb; ny += P.ey * eb;
  const bb = Math.exp(-(((ax - 3.5) / 4) ** 2) - (((y - 172.3) / 1.3) ** 2)) * sstep(4, 7, z) * hw;  // 눈썹뼈
  nz += P.br * bb;
  const cb = Math.exp(-(((ax - 6.5) / 2.6) ** 2) - (((y - 164) / 3) ** 2)) * sstep(0, 4, z) * hw;    // 광대
  nx += sg * P.ck * cb;
  const rb = Math.exp(-(((ax - 8.6) / 2.2) ** 2) - (((y - 166.3) / 3.6) ** 2) - (((z + 0.5) / 3.2) ** 2)) * hw;  // 귀
  nx += sg * (P.ear - 1) * 2.6 * rb;
  return [nx, ny, nz];
}

// 머리카락 영역 판정 (머리 중심에서 본 방향 기준)
function hairAmount(p, style) {
  if (style === 'bald') return 0;
  const dx = p[0] - HCEN[0], dy = p[1] - HCEN[1], dz = p[2] - HCEN[2], l = Math.hypot(dx, dy, dz) || 1, up = dy / l;
  const front = sstep(-3, 6, dz);
  const thrBack = style === 'long' ? -0.45 : style === 'short' ? -0.05 : 0.22, thrFront = style === 'long' ? 0.55 : style === 'short' ? 0.6 : 0.68;
  const thr = lerp(thrBack, thrFront, front);
  let a = sstep(thr - 0.04, thr + 0.04, up);
  if (Math.abs(p[0]) > 7.3 && Math.abs(dy) < 5 && style !== 'long') a *= 0.0;      // 귀 주변은 비움
  if (style === 'long' && p[1] > 156) a = Math.max(a, sstep(-1, -4, p[2]));      // 뒷머리는 목덜미까지
  return a;
}

const variantCache = {};
function buildVariant(L) {
  const key = L.kind + ':' + L.seed;
  if (variantCache[key]) return variantCache[key];
  const pos = new Float32Array(BASEP), col = new Float32Array(NV * 3);
  const skinC = HX(L.skin), hairC = HX(L.hair), lipC = mix(skinC, HX(0xa0504a), .38), darkSkin = mix(skinC, [0.05, 0.04, 0.04], .5);
  const jk = HX(L.jk), pn = HX(L.pn), bt = HX(L.bt), gl = HX(L.gl || L.skin), belt = HX(0x15110e), sc = HX(0xe8e4dc), pu = HX(0x0b0b0b), ir = HX(L.eye), maskC = HX(L.maskC || 0x222222);
  const regCol = [skinC, jk, pn, bt, gl, sc, ir, belt, pu];
  // 1) 얼굴 변형
  if (L.morph) for (const i of HEAD) {
    const hw = HW[i]; if (hw <= 0) continue;
    const m = morphPoint([BASEP[i * 3], BASEP[i * 3 + 1], BASEP[i * 3 + 2]], hw, L.P);
    pos[i * 3] = m[0]; pos[i * 3 + 1] = m[1]; pos[i * 3 + 2] = m[2];
  }
  // 2) 기본 색
  for (let i = 0; i < NV; i++) { const c = regCol[REG[i]] || skinC; col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2]; }
  // 3) 머리카락 / 수염 / 마스크 / 입술 (머리 정점만)
  for (const i of HEAD) {
    if (REG[i] !== R_SK) continue;
    const p = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]], ax = Math.abs(p[0]);
    let c = skinC, vol = 0;
    // 입술
    if (ax < 3.2 && p[1] > 160.6 && p[1] < 163.2 && p[2] > 6.5) c = lipC;
    // 수염
    const low = p[1] < 163.4 && p[1] > 152 && p[2] > -2 && ax < 8.8;
    if (L.beard !== 'none' && low) {
      const mouthSafe = !(ax < 3.0 && p[1] > 160.6 && p[1] < 163.0 && p[2] > 6.5);
      let a = 0;
      if (L.beard === 'stubble') a = .42 * sstep(163.6, 161.5, p[1]) * (p[1] > 155 ? 1 : .7);
      else if (L.beard === 'full') a = .92 * sstep(164.6, 162.6, p[1]);
      else if (L.beard === 'goatee') a = (ax < 4.2 && p[1] < 160.9 ? .92 : 0) + (ax < 3.8 && p[1] > 163 ? .8 : 0);
      if (mouthSafe && a > 0) { c = mix(c, mix(hairC, [0, 0, 0], .15), clamp(a, 0, .95)); if (a > .8) vol = .45; }
    }
    // 머리카락
    const h = hairAmount(p, L.hairStyle);
    if (h > 0.001) { c = mix(c, L.hairStyle === 'buzz' ? mix(skinC, hairC, .72) : hairC, h); vol = Math.max(vol, (L.hairStyle === 'long' ? 1.0 : L.hairStyle === 'short' ? .65 : .15) * h); }
    // 목 가리개(마스크)
    if (L.mask && p[1] < 166.0 && ax < 10 && p[2] > -9 && !(ax < 3.0 && p[1] > 164)) { c = maskC; vol = Math.max(vol, .5); }
    col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
    if (vol > 0) { pos[i * 3] += BASEN[i * 3] * vol; pos[i * 3 + 1] += BASEN[i * 3 + 1] * vol; pos[i * 3 + 2] += BASEN[i * 3 + 2] * vol; }
  }
  return (variantCache[key] = { pos, col });
}

/* ---- 팔 IK: 어깨 S(바인드 고정) → 손목이 목표 T(모델 좌표, cm) 에 오도록 뼈 회전 계산 ----
 * side: +1 = +x쪽 팔(캐릭터의 왼팔), -1 = 오른팔.  반환: 쿼터니언 [x,y,z,w] 들과 팔 확대 배율 k */
function solveArm(side, T, o) {
  o = o || {};
  const sfx = side > 0 ? 'L' : 'R', S = BJ[BI['uarm' + sfx]], E = BJ[BI['farm' + sfx]], W = BJ[BI['hand' + sfx]];
  const L1 = v3.len(v3.sub(E, S)), L2 = v3.len(v3.sub(W, E)), restUp = v3.norm(v3.sub(E, S)), restFore = v3.norm(v3.sub(W, E));
  const half = o.half == null ? 6 : o.half, kmax = o.kmax || 1.0;
  let f = v3.norm(v3.sub(T, S)), tw = T, k = 1, Eik = E;
  const pole = v3.norm(o.pole || [side * .55, -1, -.25]);
  for (let it = 0; it < 3; it++) {
    tw = v3.sub(T, v3.mul(f, half));
    const dist = v3.len(v3.sub(tw, S));
    k = Math.max(1, Math.min(kmax, dist / ((L1 + L2) * 0.985)));
    const l1 = L1 * k, l2 = L2 * k, d = clamp(dist, Math.abs(l1 - l2) + .01, l1 + l2 - .01), u = v3.norm(v3.sub(tw, S));
    const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    let p = v3.sub(pole, v3.mul(u, v3.dot(pole, u))); p = v3.norm(p);
    Eik = v3.add(v3.add(S, v3.mul(u, a)), v3.mul(p, h));
    tw = v3.add(S, v3.mul(u, d));
    f = v3.norm(v3.sub(tw, Eik));
  }
  const tUp = v3.norm(v3.sub(Eik, S)), tFore = v3.norm(v3.sub(tw, Eik));
  const qU = qFromTo(restUp, tUp), qFw = qFromTo(restFore, tFore), qF = qMul(qConj(qU), qFw);
  const qH = qAxis(restFore, o.roll || 0), qFing = qAxis([0, 0, 1], -side * (o.curl == null ? 1.35 : o.curl));
  return { qU, qF, qH, qFing, k, elbow: Eik, wrist: tw };
}
// 다리 걸음 자세: a = 허벅지가 뒤로 젖혀진 각도(라디안, +면 발이 뒤로)
const legPose = a => ({ thigh: qAxis([1, 0, 0], a), shin: qAxis([1, 0, 0], Math.max(0, a) * 0.95 + 0.04) });

// 총별 손 위치(총 좌표, m) — 게임의 gunMesh 와 같은 좌표계 (총구는 -z)
const GRIP_R = [0, -.095, -.05];
const gripL = mdl => (mdl === 'pi' ? [-.03, -.1, -.045] : [0, -.06, mdl === 'smg' ? -.3 : -.34]);

/* 1인칭 팔 배치(순수 계산): 손 위치 H(부모 좌표, m) → 팔 뼈대 루트 위치와 모델좌표 목표.
 * 모델은 +z 를 보고 카메라 좌표계는 -z 를 보므로 루트는 y축으로 180° 돌려 놓는다. 어깨는 손에서 뒤·아래·바깥으로 0.5m. */
function fpsArm(side, H) {
  const sf = side > 0 ? 'L' : 'R', Sm = BJ[BI['uarm' + sf]];
  const back = v3.norm([-side * .3, -.55, .78]), Sd = v3.add(H, v3.mul(back, .5));
  const pos = [Sd[0] + SC * Sm[0], Sd[1] - SC * Sm[1], Sd[2] + SC * Sm[2]];
  const T = [-(H[0] - pos[0]) / SC, (H[1] - pos[1]) / SC, -(H[2] - pos[2]) / SC];
  return { pos, T };
}

window.SOLDIER_PURE = { fpsArm, look, buildVariant, solveArm, legPose, morphPoint, rngOf, hash2, strHash, BJ, BPAR, BNAME, BI, BASEP, BASEN, REG, SKI, SKW, IDX, NV, NT, HEAD, HW, qMul, qRot, qConj, qFromTo, qAxis, v3, GRIP_R, gripL, SC };

/* ================================================================
 *  2) THREE 연결부
 * ================================================================ */
if (typeof THREE === 'undefined' || typeof scene === 'undefined' || typeof camera === 'undefined') { console.warn('soldier.js: 게임 본체를 찾지 못해 3D 교체는 건너뜁니다'); return; }
const REV = parseInt(THREE.REVISION, 10) || 0;
const matCache = {};
const lam = hex => matCache[hex] || (matCache[hex] = new THREE.MeshLambertMaterial({ color: hex }));
const skinMatOpts = { vertexColors: true }; if (REV <= 128) skinMatOpts.skinning = true;
const skinMat = new THREE.MeshLambertMaterial(skinMatOpts);
const geoCache = {};
const sharedAttr = {
  idx: new THREE.BufferAttribute(IDX, 1), nor: new THREE.BufferAttribute(BASEN, 3),
  si: null, sw: null
};
{ const si = new Uint16Array(NV * 4), sw = new Float32Array(NV * 4);
  for (let i = 0; i < NV; i++) for (let k = 0; k < 3; k++) { si[i * 4 + k] = SKI[i * 3 + k]; sw[i * 4 + k] = SKW[i * 3 + k] / 255; }
  sharedAttr.si = new THREE.BufferAttribute(si, 4); sharedAttr.sw = new THREE.BufferAttribute(sw, 4); }
const bodyGeo = L => {
  const key = L.kind + ':' + L.seed;
  if (geoCache[key]) return geoCache[key];
  const v = buildVariant(L), g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(v.pos, 3)); g.setAttribute('normal', sharedAttr.nor); g.setAttribute('color', new THREE.BufferAttribute(v.col, 3));
  g.setAttribute('skinIndex', sharedAttr.si); g.setAttribute('skinWeight', sharedAttr.sw); g.setIndex(sharedAttr.idx);
  g.computeBoundingSphere();
  return (geoCache[key] = g);
};

function makeRig(names) {                       // names 가 없으면 전체 뼈대
  const root = new THREE.Group(); root.scale.setScalar(SC);
  const list = names || BNAME.map((n, i) => i);
  const map = {}, bones = [];
  list.forEach(i => { const b = new THREE.Bone(); b.name = BNAME[i]; map[i] = b; bones.push(b); });
  list.forEach(i => {
    const b = map[i], p = BPAR[i], j = BJ[i];
    if (p >= 0 && map[p]) { const pj = BJ[p]; b.position.set(j[0] - pj[0], j[1] - pj[1], j[2] - pj[2]); map[p].add(b); }
    else { b.position.set(j[0], j[1], j[2]); root.add(b); }
  });
  root.updateMatrixWorld(true);
  const by = {}; bones.forEach(b => { by[b.name] = b; });
  return { root, bones, by };
}
const setQ = (bone, q) => bone.quaternion.set(q[0], q[1], q[2], q[3]);

/* ---------- 장비(박스) ---------- */
const boxCache = {};
const boxGeo = (w, h, d) => { const k = w + ',' + h + ',' + d; return boxCache[k] || (boxCache[k] = new THREE.BoxGeometry(w, h, d)); };
function gearBox(rig, boneName, w, h, d, x, y, z, hex, rx) {   // x,y,z 는 모델(바인드) 좌표(cm)
  const bone = rig.by[boneName], j = BJ[BI[boneName]], m = new THREE.Mesh(boxGeo(w, h, d), lam(hex));
  m.position.set(x - j[0], y - j[1], z - j[2]); if (rx) m.rotation.x = rx; bone.add(m); return m;
}
const domeGeo = (() => { const g = new THREE.SphereGeometry(1, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2); return g; })();
function gearDome(rig, boneName, rx, ry, rz, x, y, z, hex) {
  const bone = rig.by[boneName], j = BJ[BI[boneName]], m = new THREE.Mesh(domeGeo, lam(hex));
  m.scale.set(rx, ry, rz); m.position.set(x - j[0], y - j[1], z - j[2]); bone.add(m); return m;
}
function addGear(rig, L) {
  // 조끼(플레이트 캐리어)
  if (L.vest) {
    gearBox(rig, 'chest', 29, 32, 6.5, 0, 133, 12.8, L.vest);       // 앞판
    gearBox(rig, 'chest', 29, 32, 5, 0, 133, -19.2, L.vest);         // 뒷판
    gearBox(rig, 'chest', 6, 1.8, 31, 10.5, 152.6, -3.2, L.vest);    // 어깨끈
    gearBox(rig, 'chest', 6, 1.8, 31, -10.5, 152.6, -3.2, L.vest);
    gearBox(rig, 'spine', 38, 15, 30.5, 0, 114.5, -2.8, L.vest);     // 허리 둘레
    for (const px of [-9.5, 0, 9.5]) gearBox(rig, 'chest', 8, 10, 4.2, px, 120.5, 16.6, L.kind === 'friend' ? 0x275a82 : 0x23262a);
  }
  if (L.pack) gearBox(rig, 'chest', 27, 38, 14, 0, 132, -27.5, L.packC);
  // 모자류
  const hc = L.hatC;
  if (L.hat === 'helmet') { gearDome(rig, 'head', 10.7, 12.6, 12.8, 0, 172.3, -1.8, hc); gearBox(rig, 'head', 4.5, 3, 3, 0, 181.5, 10.3, 0x222222); }
  else if (L.hat === 'cap') { gearDome(rig, 'head', 10, 9.6, 11.4, 0, 172.6, -1.4, hc); gearBox(rig, 'head', 15, .8, 8.6, 0, 173.6, 11.2, hc, .12); }
  else if (L.hat === 'beanie') gearDome(rig, 'head', 9.9, 11.4, 11.9, 0, 172.2, -1.6, hc);
  else if (L.hat === 'hood') { gearDome(rig, 'head', 10.6, 13.2, 13.2, 0, 171.8, -2.2, hc); gearBox(rig, 'neck', 21, 5, 21, 0, 154, -4, hc); }
  // 안경류
  if (L.glasses === 'goggles') { gearBox(rig, 'head', 15.6, 4.8, 3.6, 0, 170.3, 8.9, 0x1b2630); gearBox(rig, 'head', 19.8, 2.2, 23.5, 0, 170.6, -1.8, 0x2a2a2a); }
  else if (L.glasses === 'shades') gearBox(rig, 'head', 13.6, 3.2, 1.6, 0, 170.4, 9.3, 0x0a0a0a);
}

/* ---------- 캐릭터 생성 ---------- */
function makeChar(kind, seed) {
  const L = look(kind, seed), rig = makeRig();
  const mesh = new THREE.SkinnedMesh(bodyGeo(L), skinMat);
  rig.root.add(mesh); rig.root.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(rig.bones));
  addGear(rig, L);
  return { root: rig.root, rig, mesh, L, mdl: null };
}
function poseArms(ch, T_L, T_R, optL, optR) {            // 모델(cm) 좌표의 손 목표로 양팔 자세 설정
  for (const [side, T, o] of [[1, T_L, optL], [-1, T_R, optR]]) {
    const s = solveArm(side, T, o), sf = side > 0 ? 'L' : 'R', b = ch.rig.by;
    setQ(b['uarm' + sf], s.qU); setQ(b['farm' + sf], s.qF); setQ(b['hand' + sf], s.qH); setQ(b['fing' + sf], s.qFing);
    b['uarm' + sf].scale.setScalar(s.k);
  }
}
function relaxArms(ch) {                                   // 팔 내림(총 없음)
  for (const side of [1, -1]) {
    const sf = side > 0 ? 'L' : 'R', b = ch.rig.by, S = BJ[BI['uarm' + sf]];
    const T = [side * 14, 70, -2], s = solveArm(side, T, { half: 0, roll: 0, curl: .45, pole: [side * .3, -.2, -1] });
    setQ(b['uarm' + sf], s.qU); setQ(b['farm' + sf], s.qF); setQ(b['hand' + sf], s.qH); setQ(b['fing' + sf], s.qFing); b['uarm' + sf].scale.setScalar(s.k);
  }
}
/* 3인칭 총 파지: 총을 몸 앞(오른쪽 어깨)에 붙이고 양손을 그립/핸드가드로 */
const holdPos = mdl => (mdl === 'pi' ? [-1.5, 139, 52] : [-12, 137, 24]);   // 모델 좌표(cm)
function holdGun(ch, gun, mdl) {
  const p = holdPos(mdl);
  gun.rotation.set(0, Math.PI, 0); gun.position.set(p[0] * SC, p[1] * SC, p[2] * SC); gun.updateMatrix();
  const toModel = g => { const v = new THREE.Vector3(g[0], g[1], g[2]).applyMatrix4(gun.matrix); return [v.x / SC, v.y / SC, v.z / SC]; };
  const TL = toModel(gripL(mdl)), TR = toModel(GRIP_R);
  poseArms(ch, TL, TR, { roll: -1.5, kmax: 1.28, half: 5, pole: [.5, -1, -.15] }, { roll: 1.4, kmax: 1.28, half: 5, pole: [-.5, -1, -.15] });
  ch.mdl = mdl;
}
function swingLegs(ch, a1, a2) {                           // a1: 왼다리(+x), a2: 오른다리  (게임의 l1/l2 rotation.x 와 같은 의미)
  const p1 = legPose(a1), p2 = legPose(a2), b = ch.rig.by;
  setQ(b.thighL, p1.thigh); setQ(b.shinL, p1.shin); setQ(b.thighR, p2.thigh); setQ(b.shinR, p2.shin);
}

/* ---------- 게임 본체 연결: 총 모델에서 박스 손/소매 숨기기 ---------- */
const HAND_BOX = new Set([0x3a3226, 0x8c979c, 0x6c7a82]);
function hideHandBoxes(g) {
  g.children.forEach(c => { if (c.isMesh && c.material && c.material.color && c.geometry && c.geometry.type === 'BoxGeometry' && HAND_BOX.has(c.material.color.getHex())) c.visible = false; });
}
if (typeof gunMesh === 'function') {
  const _gm = gunMesh;
  gunMesh = function (x) { const g = _gm.apply(this, arguments); try { hideHandBoxes(g); g.userData.mdl = x && x.mdl; } catch (e) { /* 무시 */ } return g; };
}

/* ---------- 1인칭 팔 ---------- */
const FP = look('friend', 1);
const armGeoCache = {};
function armGeo(side) {
  if (armGeoCache[side]) return armGeoCache[side];
  const sf = side > 0 ? 'L' : 'R', chain = ['uarm', 'farm', 'hand', 'fing'].map(n => BI[n + sf]), v = buildVariant(FP);
  const isArm = i => { let s = 0; for (let k = 0; k < 3; k++) if (chain.includes(SKI[i * 3 + k])) s += SKW[i * 3 + k] / 255; return s; };
  const keep = new Map(), pos = [], nor = [], col = [], si = [], sw = [], idx = [];
  const take = i => {
    if (keep.has(i)) return keep.get(i);
    const n = pos.length / 3; keep.set(i, n);
    pos.push(v.pos[i * 3], v.pos[i * 3 + 1], v.pos[i * 3 + 2]); nor.push(BASEN[i * 3], BASEN[i * 3 + 1], BASEN[i * 3 + 2]); col.push(v.col[i * 3], v.col[i * 3 + 1], v.col[i * 3 + 2]);
    let tot = 0; const w = [0, 0, 0, 0], ix = [0, 0, 0, 0];
    for (let k = 0; k < 3; k++) { const c = chain.indexOf(SKI[i * 3 + k]); if (c >= 0) { w[c] += SKW[i * 3 + k] / 255; tot += SKW[i * 3 + k] / 255; } }
    if (tot < 1e-4) { w[0] = 1; tot = 1; }
    for (let k = 0; k < 4; k++) { ix[k] = k; w[k] /= tot; }
    si.push(...ix); sw.push(...w); return n;
  };
  for (let t = 0; t < NT; t++) {
    const a = IDX[t * 3], b = IDX[t * 3 + 1], c = IDX[t * 3 + 2];
    if (REG[a] >= R_SC) continue;
    if (isArm(a) > .6 && isArm(b) > .6 && isArm(c) > .6 && Math.abs(BASEP[a * 3]) > 20) idx.push(take(a), take(b), take(c));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4)); g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4)); g.setIndex(idx);
  g.computeBoundingSphere();
  return (armGeoCache[side] = g);
}
/* parent(총 그룹 또는 주먹 그룹) 안에 양팔 부착. handsL/handsR = parent 좌표(m)의 손 위치.
 * 어깨는 손에서 뒤·아래·바깥쪽으로 0.5m 떨어진 곳에 둔다 (화면 밖이라 보이지 않음) */
function attachArms(parent, handL, handR, optL, optR) {
  const grp = new THREE.Group(); parent.add(grp);
  for (const [side, H, o] of [[1, handL, optL], [-1, handR, optR]]) {
    const sf = side > 0 ? 'L' : 'R', chain = ['uarm', 'farm', 'hand', 'fing'].map(n => BI[n + sf]);
    const rig = makeRig(chain), mesh = new THREE.SkinnedMesh(armGeo(side), skinMat);
    rig.root.add(mesh); rig.root.rotation.y = Math.PI;           // 모델은 +z 를 보고, 카메라 좌표계는 -z 를 봄
    // 바깥쪽: 카메라 기준 왼팔(side=+1)은 -x
    const fa = fpsArm(side, H);
    rig.root.position.set(fa.pos[0], fa.pos[1], fa.pos[2]);
    rig.root.updateMatrixWorld(true);
    mesh.frustumCulled = false; mesh.bind(new THREE.Skeleton(rig.bones));
    grp.add(rig.root);
    const s = solveArm(side, fa.T, Object.assign({ half: 5, kmax: 1.0, pole: [side * .5, -1, -.1] }, o));
    setQ(rig.by['uarm' + sf], s.qU); setQ(rig.by['farm' + sf], s.qF); setQ(rig.by['hand' + sf], s.qH); setQ(rig.by['fing' + sf], s.qFing);
  }
  return grp;
}
const FP_ROLL = { L: -1.45, R: 1.45 };
if (typeof vm === 'function') {
  const _vm = vm;
  vm = function (k) {
    const had = typeof vmG !== 'undefined' && !!vmG[k], g = _vm.apply(this, arguments);
    if (!had && g && !g.userData.arms) {
      try {
        const mdl = (g.userData.mdl) || (I[k] && I[k][5] && I[k][5].mdl);
        g.userData.arms = attachArms(g, gripL(mdl), GRIP_R, { roll: mdl === 'pi' ? -1.5 : -1.1 }, { roll: FP_ROLL.R });
      } catch (e) { console.warn('1인칭 팔 실패', e); g.children.forEach(c => { if (c.isMesh) c.visible = true; }); }
    }
    return g;
  };
}
if (typeof mkFists === 'function') {
  const _mf = mkFists;
  mkFists = function () {
    const g = _mf.apply(this, arguments);
    try { g.children.forEach(c => { c.visible = false; }); attachArms(g, [.17, -.21, -.4], [-.17, -.21, -.4], { roll: -1.5, curl: 1.5 }, { roll: 1.5, curl: 1.5 }); } catch (e) { console.warn('주먹 팔 실패', e); g.children.forEach(c => { c.visible = true; }); }
    return g;
  };
}
if (typeof buildGV === 'function') {            // 수류탄 시야: 박스 소매/장갑 색을 군복에 맞춤
  const _bg = buildGV;
  buildGV = function () {
    _bg.apply(this, arguments);
    try { GV.traverse(o => { if (o.isMesh && o.material && o.material.color && o.geometry && o.geometry.type === 'BoxGeometry') { const h = o.material.color.getHex(); if (h === 0x6c7a82) o.material = lam(FP.jk); else if (h === 0x3a3226) o.material = lam(FP.gl); } }); } catch (e) { /* 무시 */ }
  };
}

/* ---------- 적(PMC/스캐브/레이더): 모델 교체 ---------- */
const gunFor = (pmc, lab) => (lab ? { mdl: 'ar' } : pmc ? { mdl: 'ak' } : { mdl: 'sks', wood: 1 });
const VARIANTS = { pmc: 24, scav: 40 };
if (typeof mkEn === 'function' && typeof gunMesh === 'function') {
  const _mk = mkEn;
  mkEn = function (x, z, pmc) {
    const e = _mk.apply(this, arguments);
    let ch = null, gun = null;
    try {
      const kind = pmc ? 'pmc' : 'scav', h = hash2(x, z, pmc ? 1 : 0), seed = h % VARIANTS[kind];
      ch = makeChar(kind, seed);
      const spec = gunFor(pmc, false);
      gun = gunMesh(spec);
      holdGun(ch, gun, spec.mdl);
      e.g.traverse(o => { if (o.isMesh) o.visible = false; });
      e.g.add(ch.root); e.g.add(gun);
      e.sol = ch; e.solGun = gun;
    } catch (err) {
      console.warn('적 캐릭터 교체 실패 — 기본 모델 사용', err);
      if (ch && ch.root.parent) ch.root.parent.remove(ch.root);
      if (gun && gun.parent) gun.parent.remove(gun);
      e.g.traverse(o => { if (o.isMesh) o.visible = true; }); e.sol = null;
    }
    return e;
  };
}
function solLoop() {
  requestAnimationFrame(solLoop);
  try {
    if (typeof EN === 'undefined') return;
    for (let i = 0; i < EN.length; i++) {
      const e = EN[i]; if (!e || !e.sol || !e.alive) continue;
      swingLegs(e.sol, e.l1.rotation.x, e.l2.rotation.x);
    }
  } catch (err) { /* 씬 교체 중 등 */ }
}
requestAnimationFrame(solLoop);

window.SOLDIER = { makeChar, holdGun, swingLegs, relaxArms, look, strHash, hash2, hideHandBoxes, ready: true };
})();
