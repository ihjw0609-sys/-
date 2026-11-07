/* SHADOW EXTRACTION — 추가 게임플레이 레이어
 * 고통/출혈 연출, 레이드 중 삽탄, 반동 수치, 발소리 교체.
 * 게임 본체 뒤에 로드되며, 본체의 전역 함수를 감싸는 방식으로 동작합니다.
 */
(() => {
'use strict';
if (typeof P === 'undefined' || typeof hurt !== 'function') { console.warn('gameplay.js: 게임 본체를 찾지 못해 건너뜁니다'); return; }
const D = 180 / Math.PI;

/* ============================== 고통 (Pain) ==============================
 * 피격 → 고통 시작 → 진통제를 안 먹으면 시야 가장자리가 서서히 검게 차오름(중앙은 항상 보임)
 * 고통 중에는 조준이 불안정(손떨림↑, 탄퍼짐↑, 반동 +12%)  / 진통제: 5분간 억제
 */
const PAIN_MAX_T = 240, PAIN_RISE = 60, PAIN_FALL = 25;
const resetPain = () => { P.pt = 0; P.pn = 0; P.pk = 0; };
resetPain();
{ const _i = initP; initP = function () { _i.apply(this, arguments); resetPain(); }; }
window.painKill = function () { P.pk = 300; P.pt = 0; setTimeout(() => msg('진통제 — 고통이 5분간 억제됩니다'), 200); };
{
  const _h = hurt;
  hurt = function (dm, pen) {
    const sum = () => Object.values(P.hp).reduce((a, b) => a + b, 0), s0 = sum();
    const r = _h.apply(this, arguments);
    const lost = s0 - sum();
    if (mode === 'raid' && lost >= 4 && !(P.pk > 0)) {
      const first = !(P.pt > 0);
      P.pt = Math.min(PAIN_MAX_T, Math.max(P.pt, 0) + 70 + lost * 0.9);
      if (first) setTimeout(() => mode === 'raid' && msg('고통! 진통제를 사용하세요'), 900);
    }
    return r;
  };
}
const fx = document.createElement('div');
fx.id = 'painfx';
fx.style.cssText = 'position:fixed;inset:0;z-index:20;pointer-events:none;display:none';
document.body.appendChild(fx);
let lastPn = -1;
function painTick(dt) {
  if (mode !== 'raid') { if (fx.style.display !== 'none') fx.style.display = 'none'; return; }
  if (P.pk > 0) { P.pk -= dt; P.pt = 0; }
  if (P.pt > 0) { P.pt -= dt; P.pn = Math.min(1, P.pn + dt / PAIN_RISE); }
  else P.pn = Math.max(0, P.pn - dt / (P.pk > 0 ? 8 : PAIN_FALL));
  if (P.pn < 0.01) { if (fx.style.display !== 'none') fx.style.display = 'none'; lastPn = -1; return; }
  const pulse = 1 + Math.sin(now * 2.2) * 0.04 * P.pn;       // 맥박처럼 아주 미세하게
  const k = Math.round(P.pn * pulse * 100) / 100;
  if (k === lastPn) return;
  lastPn = k;
  // 가장자리부터 어두워짐: 중앙 25%는 끝까지 투명 → 항상 앞이 보임
  const inner = 76 - 40 * k, edge = Math.min(0.74, 0.22 + 0.52 * k);
  fx.style.background = `radial-gradient(ellipse at center, rgba(0,0,0,0) ${inner}%, rgba(8,0,0,${(edge * 0.55).toFixed(2)}) ${(inner + 100) / 2}%, rgba(0,0,0,${edge.toFixed(2)}) 100%)`;
  fx.style.display = 'block';
}

/* ============================== 레이드 중 삽탄 ==============================
 * 홈(메뉴)에서는 기존처럼 즉시. 레이드 중에는 탄창에 탄약을 끌어다 놓으면
 * 한 발씩 쿨타임을 두고 채워짐.
 */
const LOAD_INTERVAL = 0.4;
let LD = null;
const containers = () => CH.map(k => C[k]).concat(typeof lootGrids === 'function' ? lootGrids() : [C.loot]);
const holder = it => containers().find(c => c.items.includes(it));
window.raidLoad = function (tc, mg, am) {
  if (LD) return msg('이미 삽탄 중입니다');
  const cap = I[mg.k][5].cap;
  if (mg.mag >= cap) return;
  LD = { tc, mg, am, t: LOAD_INTERVAL * 0.6 };
  msg(`삽탄 시작 ${mg.mag}/${cap}`);
};
function loadTick(dt) {
  if (!LD) return;
  if (mode !== 'raid') { LD = null; return; }
  const { tc, mg, am } = LD, cap = I[mg.k][5].cap;
  const bad = !tc.items.includes(mg) || am.n <= 0 || !holder(am) || mg.mag >= cap || (mg.mag > 0 && mg.am !== am.k);
  if (bad) { const full = mg.mag >= cap; LD = null; save(); if ($('inv').style.display === 'flex') render(); msg(full ? `삽탄 완료 ${mg.mag}/${cap}` : '삽탄 중단'); return; }
  LD.t += dt;
  if (LD.t < LOAD_INTERVAL) return;
  LD.t -= LOAD_INTERVAL;
  mg.am = am.k; mg.mag++; am.n--;
  if (am.n <= 0) { const h = holder(am); if (h) h.items.splice(h.items.indexOf(am), 1); }
  snd(0.05, 0.025, 2800);
  msg(`삽탄 중 ${mg.mag}/${cap}`);
  if ($('inv').style.display === 'flex') render();
}

/* ============================== 반동 수치 ==============================
 * 게임의 shoot() 공식과 동일:  수직 = rec × (0.009 ~ 0.016) rad / 발 (조준 시 ×0.7)
 *                               수평 = ±rec × 0.007 rad / 발
 */
window.recoilLines = function (p) {
  if (!p || typeof p.rec !== 'number') return [];
  const lo = p.rec * 0.009 * D, hi = p.rec * 0.016 * D, mean = (lo + hi) / 2, hz = p.rec * 0.007 * D, f = n => n.toFixed(2);
  const out = [
    `수직 반동: 평균 ${f(mean)}° /발 (${f(lo)}°~${f(hi)}°) · 조준 시 ${f(mean * 0.7)}°`,
    `수평 반동: 좌우 ±${f(hz)}° /발`
  ];
  if (p.auto && p.rpm) out.push(`연사 시 총구 상승: 약 ${f(mean * p.rpm / 60)}°/초 (${(p.rpm / 60).toFixed(1)}발/초)`);
  out.push(`반동 지수: ${p.rec.toFixed(2)}`);
  return out;
};

/* ============================== 발소리 (또각또각) ==============================
 * 구두 굽(heel) → 앞꿈치(toe) 두 번 닿는 소리를 모달 합성으로 직접 생성.
 * 바닥별: dirt=단단한 지면, wood=울리는 나무, metal=금속 바닥. 기존보다 볼륨 낮춤.
 */
const STEP_GAIN = 0.6;
const CFG = {
  dirt:  { dur: .17, gap: .078, toe: .55, modes: [[1800, 300, .5], [2900, 420, .35], [4300, 600, .15]], body: 140, bd: 55, bg: .6, nd: 260, ng: .3 },
  wood:  { dur: .20, gap: .088, toe: .5,  modes: [[900, 160, .6], [1700, 240, .4], [2600, 380, .15]],   body: 110, bd: 40, bg: .75, nd: 200, ng: .18 },
  metal: { dur: .24, gap: .072, toe: .5,  modes: [[1400, 70, .5], [2300, 90, .45], [3600, 130, .3], [5200, 200, .15]], body: 190, bd: 45, bg: .45, nd: 300, ng: .22 }
};
const SB = {};
function genStep(c, kind) {
  const cfg = CFG[kind] || CFG.dirt, sr = c.sampleRate, n = (sr * cfg.dur) | 0, b = c.createBuffer(1, n, sr), a = b.getChannelData(0);
  const det = 1 + (Math.random() - .5) * .12, gap = cfg.gap * (.9 + Math.random() * .2);
  const voice = (t, dt, amp) => {
    let v = 0;
    for (const [f, d, g] of cfg.modes) v += Math.sin(2 * Math.PI * f * dt * t) * Math.exp(-t * d) * g;
    v += Math.sin(2 * Math.PI * cfg.body * t) * Math.exp(-t * cfg.bd) * cfg.bg;
    v += (Math.random() * 2 - 1) * Math.exp(-t * cfg.nd) * cfg.ng;
    return v * amp;
  };
  let pk = 0;
  for (let i = 0; i < n; i++) { const t = i / sr; let v = voice(t, det, 1); if (t > gap) v += voice(t - gap, det * 1.12, cfg.toe); a[i] = v; if (Math.abs(v) > pk) pk = Math.abs(v); }
  const g = 0.9 / (pk || 1); for (let i = 0; i < n; i++) a[i] *= g;
  return b;
}
function stepBuf(kind) {
  const c = ac(); if (!c) return null;
  const key = CFG[kind] ? kind : 'dirt';
  if (!SB[key]) SB[key] = [0, 1, 2, 3].map(() => genStep(c, key));
  return SB[key][(Math.random() * 4) | 0];
}
stepSelf = function (vol, kind) {
  const c = ac(); if (!c) return;
  const b = stepBuf(kind); if (!b) return;
  const s = c.createBufferSource(), g = c.createGain(), pn = c.createStereoPanner ? c.createStereoPanner() : null;
  s.buffer = b; s.playbackRate.value = .94 + Math.random() * .12; g.gain.value = vol * STEP_GAIN * (.85 + Math.random() * .3);
  s.connect(g);
  if (pn) { pn.pan.value = stepAlt ? .12 : -.12; g.connect(pn); pn.connect(c.destination); } else g.connect(c.destination);
  s.start();
};
stepAt = function (x, z, v) { sndAt(x, .2, z, stepBuf(surf()), v * STEP_GAIN, { f: 6000, ref: 2.5, roll: 1.7, delay: 0 }); };

window.__gp = { painTick, loadTick, stepBuf };   // 테스트용 훅

/* ============================== 매 프레임 ============================== */
{ const _u = updEn; updEn = function (dt) { _u(dt); painTick(dt); loadTick(dt); }; }
setInterval(() => { if (mode !== 'raid' && fx.style.display !== 'none') fx.style.display = 'none'; }, 400);   // 레이드 밖에서는 연출 끔
})();
