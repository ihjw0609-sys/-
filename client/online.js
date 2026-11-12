/* SHADOW EXTRACTION — 온라인 레이어
 * 계정/자동로그인/닉네임/클라우드 세이브/친구/파티/동시 시작
 * 게임 본체(전역 함수)를 건드리지 않고 래핑해서 붙입니다.
 */
(() => {
'use strict';
const TK = 'se_token';
const SERVER = String(window.SE_SERVER || '').replace(/\/+$/, '');   // config.js 에서 지정 (비우면 같은 주소)
const $q = (s, r = document) => r.querySelector(s);
const el = (tag, props = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
};

/* ============================== 상태 ============================== */
let token = null, me = null;           // me = { id, nick }
let ws = null, wsTry = 0, wsTimer = null, wsOpen = false, lastStatus = null;
let S = null;                          // 서버가 보낸 최신 상태 (friends / party ...)
let loggedIn = false, panelOpen = false;
const seenInvites = new Set();

const getToken = () => { try { return localStorage.getItem(TK) || sessionStorage.getItem(TK); } catch (e) { return null; } };
const setToken = (t, remember) => {
  try { localStorage.removeItem(TK); sessionStorage.removeItem(TK); (remember ? localStorage : sessionStorage).setItem(TK, t); } catch (e) { /* 저장 불가 환경 */ }
  token = t;
};
const clearToken = () => { try { localStorage.removeItem(TK); sessionStorage.removeItem(TK); } catch (e) { /* noop */ } token = null; };

async function api(path, method = 'GET', body) {
  try {
    const r = await fetch(SERVER + path, {
      method, headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
      body: body ? JSON.stringify(body) : undefined
    });
    let data = {}; try { data = await r.json(); } catch (e) { /* 본문 없음 */ }
    return { ok: r.ok, status: r.status, data };
  } catch (e) { return { ok: false, status: 0, data: { error: '서버에 연결할 수 없습니다.' } }; }
}

/* ============================== 토스트 ============================== */
const tbox = el('div', { id: 'olToasts', class: 'ol' }); document.body.append(tbox);
function toast(m, bad) {
  const t = el('div', { class: 'ol-t' + (bad ? ' bad' : ''), text: m }); tbox.append(t);
  setTimeout(() => t.remove(), 3200);
  while (tbox.children.length > 4) tbox.firstChild.remove();
}

/* ============================== 인증 화면 ============================== */
const auth = el('div', { id: 'olAuth', class: 'ol on' }); document.body.append(auth);
let authTab = 'login', busy = false;

function box(...kids) {
  auth.replaceChildren(el('div', { class: 'ol-box' },
    el('div', { class: 'ol-logo' }, el('small', { text: 'CUSTOMS' }), el('b', {}, 'SHADOW ', el('em', { text: 'EXTRACTION' }))), ...kids));
}
const field = (label, name, type = 'text', extra = {}) =>
  el('label', {}, label, el('input', Object.assign({ type, name, autocomplete: type === 'password' ? (extra.new ? 'new-password' : 'current-password') : 'username', spellcheck: 'false', autocapitalize: 'off', required: true }, extra.attrs || {})));

function showLoading(msg = '접속 중…') { auth.classList.add('on'); box(el('div', { class: 'ol-load', text: msg })); }

function showAuth(err) {
  auth.classList.add('on');
  const reg = authTab === 'reg';
  const errEl = el('div', { class: 'ol-err', text: err || '' });
  const btn = el('button', { class: 'go', type: 'submit', text: reg ? '계정 만들기' : '로그인' });
  const form = el('form', { class: 'ol-f', novalidate: true, onsubmit: async ev => {
    ev.preventDefault(); if (busy) return;
    const f = new FormData(form), id = String(f.get('id') || '').trim(), pw = String(f.get('pw') || '');
    const remember = !!form.elements.remember.checked;
    if (!/^[A-Za-z0-9_]{4,20}$/.test(id)) return (errEl.textContent = '아이디는 영문/숫자/_ 4~20자입니다.');
    if (reg) {
      if (pw.length < 6) return (errEl.textContent = '비밀번호는 6자 이상이어야 합니다.');
      if (pw !== f.get('pw2')) return (errEl.textContent = '비밀번호 확인이 일치하지 않습니다.');
    } else if (!pw) return (errEl.textContent = '비밀번호를 입력하세요.');
    busy = true; btn.disabled = true; errEl.textContent = '';
    const r = await api(reg ? '/api/register' : '/api/login', 'POST', { id, pw });
    busy = false; btn.disabled = false;
    if (!r.ok) return (errEl.textContent = r.data.error || '실패했습니다.');
    setToken(r.data.token, remember); me = { id: r.data.id, nick: r.data.nick };
    me.nick ? enterGame() : showNick();
  } },
  field('아이디', 'id', 'text', { attrs: { maxlength: 20 } }),
  field('비밀번호', 'pw', 'password', { new: reg, attrs: { maxlength: 64 } }),
  reg && field('비밀번호 확인', 'pw2', 'password', { new: true, attrs: { maxlength: 64 } }),
  el('label', { class: 'chk' }, el('input', { type: 'checkbox', name: 'remember', checked: true }), '자동 로그인 (이 기기에서 30일간 유지)'),
  errEl, btn,
  reg && el('div', { class: 'ol-hint', text: '가입 후 게임에서 사용할 닉네임을 따로 정합니다. 아이디는 다른 사람에게 보이지 않습니다.' }));
  box(el('div', { class: 'ol-tabs' },
    el('button', { type: 'button', class: reg ? '' : 'on', text: '로그인', onclick: () => { authTab = 'login'; showAuth(); } }),
    el('button', { type: 'button', class: reg ? 'on' : '', text: '회원가입', onclick: () => { authTab = 'reg'; showAuth(); } })), form);
  setTimeout(() => { const f = document.activeElement; if (!f || f === document.body || !form.contains(f)) form.elements.id.focus(); }, 30);   // 이미 다른 칸을 누른 뒤라면 포커스를 빼앗지 않음
}

function showNick(err) {
  auth.classList.add('on');
  const errEl = el('div', { class: 'ol-err', text: err || '' });
  const btn = el('button', { class: 'go', type: 'submit', text: '이 닉네임으로 시작' });
  const form = el('form', { class: 'ol-f', novalidate: true, onsubmit: async ev => {
    ev.preventDefault(); if (busy) return;
    const nick = String(new FormData(form).get('nick') || '').trim();
    if (!/^[가-힣A-Za-z0-9_]{2,12}$/.test(nick)) return (errEl.textContent = '닉네임은 한글/영문/숫자/_ 2~12자입니다.');
    busy = true; btn.disabled = true; errEl.textContent = '';
    const r = await api('/api/nick', 'POST', { nick });
    busy = false; btn.disabled = false;
    if (!r.ok) return (errEl.textContent = r.data.error || '실패했습니다.');
    me.nick = r.data.nick; enterGame();
  } },
  el('div', { style: 'font-size:15px;font-weight:700;margin-bottom:2px', text: '게임 닉네임 설정' }),
  el('div', { class: 'ol-hint', text: '친구가 이 닉네임으로 당신을 찾고, 파티에도 이 이름으로 표시됩니다. 한 번 정하면 바꿀 수 없어요.' }),
  field('닉네임', 'nick', 'text', { attrs: { maxlength: 12, autocomplete: 'off' } }), errEl, btn,
  el('button', { type: 'button', class: 'ol-link', text: '다른 계정으로 로그인', onclick: () => logout() }));
  box(form); setTimeout(() => form.elements.nick.focus(), 30);
}

/* ============================== 게임 진입 / 세이브 동기화 ============================== */
// 게임 본체의 save()를 감싸 서버에도 저장 (본체의 로컬 저장은 그대로 유지)
let pushT = 0, pushing = false, pushAgain = false;
const _save = save;
save = function () {
  const r = _save.apply(this, arguments);
  if (loggedIn && !scav) { clearTimeout(pushT); pushT = setTimeout(pushSave, 1500); }
  return r;
};
async function pushSave() {
  if (!loggedIn || scav) return;
  if (pushing) { pushAgain = true; return; }
  pushing = true;
  try {
    const r = await api('/api/save', 'PUT', { j: packSave() });
    if (r.status === 401) return sessionExpired();
  } finally { pushing = false; if (pushAgain) { pushAgain = false; pushSave(); } }
}
addEventListener('pagehide', () => { if (loggedIn && !scav && token) { try { fetch(SERVER + '/api/save', { method: 'PUT', keepalive: true, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ j: packSave() }) }); } catch (e) { /* 용량 초과 시 무시 */ } } });

async function enterGame() {
  showLoading('데이터 불러오는 중…');
  const r = await api('/api/save');
  if (r.status === 401) return sessionExpired();
  if (!r.ok) { showAuth(r.data.error || '저장 데이터를 불러오지 못했습니다.'); return; }
  try {
    if (r.data && r.data.j && loadSave(r.data.j)) {                // 서버에 저장본이 있음 → 그대로 사용
      localStorage.setItem(SK, r.data.j); localStorage.setItem('se_gren1', '1');
    } else {                                                        // 신규 계정
      let adopt = false;
      const claimed = localStorage.getItem('se_claimed');
      const local = localStorage.getItem(SK);
      if (local && !claimed) {
        let m = 0; try { m = JSON.parse(local).m || 0; } catch (e) { /* noop */ }
        adopt = confirm(`이 기기에 저장된 기존 진행 데이터(₽ ${m.toLocaleString()})가 있습니다.\n이 계정으로 가져올까요?\n\n[확인] 가져오기   [취소] 새로 시작`);
      }
      if (adopt) loadSave(local); else { localStorage.removeItem('se_gren1'); fresh(); }
      localStorage.setItem('se_claimed', '1');
      await api('/api/save', 'PUT', { j: packSave() });
    }
  } catch (e) { console.warn('세이브 적용 실패', e); }
  loggedIn = true;
  try { save(); } catch (e) { /* noop */ }
  menu(); try { hm(); } catch (e) { /* noop */ }
  const c = $('hcld'); if (c) c.textContent = '☁ ' + me.nick;
  auth.classList.remove('on');
  connectWS(); layout();
}

function sessionExpired() { toast('로그인이 만료되었습니다. 다시 로그인하세요.', true); logout(true); }
async function logout(silent) {
  if (!silent && token) await api('/api/logout', 'POST');
  clearToken(); try { localStorage.removeItem(SK); localStorage.removeItem('se_gren1'); } catch (e) { /* noop */ }
  loggedIn = false; if (ws) { ws.onclose = null; ws.close(); }
  location.reload();
}

/* ============================== WebSocket ============================== */
function connectWS() {
  clearTimeout(wsTimer);
  if (!loggedIn) return;
  ws = new WebSocket(SERVER ? SERVER.replace(/^http/, 'ws') + '/ws' : (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
  ws.onopen = () => ws.send(JSON.stringify({ t: 'auth', token }));
  ws.onmessage = ev => {
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (m.t === 'auth') { if (m.ok) { wsOpen = true; wsTry = 0; lastStatus = null; syncStatus(); } return; }
    if (m.t === 'state') { S = m; renderAll(); return; }
    if (m.t === 'toast') return toast(m.m);
    if (m.t === 'err') return toast(m.m, true);
    if (m.t === 'launch') return onLaunch(m);
    if (m.t === 'go') return onGo(m);
    if (m.t === 'abort') return onAbort(m);
    if (m.t === 'pos') return onPos(m);
    if (m.t === 'ehit') return onEnemyHit(m);
    if (m.t === 'pgone') return removeMate(m.n);
    if (m.t === 'shot') return onShot(m);
  };
  ws.onclose = ev => {
    wsOpen = false; S = null; renderAll();
    if (!loggedIn) return;
    if (ev.code === 4003) return sessionExpired();
    wsTimer = setTimeout(connectWS, Math.min(8000, 800 * ++wsTry));
  };
}
const send = o => { if (ws && wsOpen) { ws.send(JSON.stringify(o)); return true; } toast('서버와 연결이 끊어졌습니다. 재연결 중…', true); return false; };

// 출격/메뉴 상태 보고 (+ 20초마다 keep-alive)
function syncStatus(force) {
  const s = mode === 'raid' ? 'raid' : 'menu';
  if (wsOpen && (force || s !== lastStatus)) { lastStatus = s; ws.send(JSON.stringify({ t: 'status', s })); }
}
setInterval(() => { syncStatus(); layout(); }, 500);
setInterval(() => { if (wsOpen) { lastStatus = null; syncStatus(true); } }, 20000);

/* ============================== 파티 출격 ==============================
 * 방장이 맵/모드 선택 → 파티원은 [준비완료]만 → 방장이 [출발] → 전원 로딩바 → 동시에 시작(같은 시드/같은 스폰)
 */
const _openPlay = openPlay, _pmc = playPMC, _scav = playScav;
const startDirect = m => (m === 'scav' ? _scav() : _pmc());
openPlay = function () {
  if (S && S.party && wsOpen) { lobbyOpen = true; renderAll(); return; }     // 파티 중: 파티 출격 화면
  _openPlay();                                                              // 솔로: 기존 출격 모드 선택
};
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const MAPN = { customs: '세관 (CUSTOMS)', lab: '랩 (LABS)' }, MODEN = { pmc: 'PMC', scav: '스캐브' };
let lobbyOpen = false, launching = null, RD = null;   // RD: 현재 파티 레이드 정보

const paint = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 60)));
async function onLaunch(m) {
  const t0 = performance.now();
  launching = m; lobbyOpen = false; renderAll();
  await paint();                                               // 로딩 화면이 먼저 그려지도록
  try {
    setMap(m.map);
    SRN = mulberry32(m.seed >>> 0);                            // 모두 같은 시드 → 같은 맵 구조
    if (window.ensureBuilt) window.ensureBuilt(true);
  } catch (e) { console.warn('맵 준비 실패', e); } finally { SRN = null; }
  const rest = 1200 - (performance.now() - t0);                // 로딩바가 너무 순식간에 지나가지 않도록 최소 1.2초 표시
  if (rest > 0) await new Promise(r => setTimeout(r, rest));
  if (launching === m) send({ t: 'party:loaded' });                  // "나는 준비 끝" → 서버가 전원 완료를 기다렸다가 go
}
function onGo(m) {
  launching = null; lobbyOpen = false;
  const n = m.party.length, idx = Math.max(0, m.party.indexOf(me.nick));
  RD = { id: m.raidId, names: m.party, idx, n, t0: performance.now() };
  renderAll();
  SRN = mulberry32((m.seed ^ 0x9e3779b9) >>> 0);               // 전리품/적 초기 배치도 동일
  try { startDirect(m.mode); } finally { SRN = null; }
  // 같은 스폰 지점 (파티원끼리는 겹치지 않게 2.2m 간격)
  const r = mulberry32((m.seed ^ 0x51ed270b) >>> 0)(), off = (idx - (n - 1) / 2) * 2.2;
  if (m.map === 'lab') { pl.x = (r - 0.5) * 16 + off; pl.z = 76; } else { pl.x = (r - 0.5) * 300 + off; pl.z = 190; }
  pl.y = 0; pl.yaw = 0;
  toast('전원 준비 완료 — 출격!');
}
function onAbort(m) { launching = null; renderAll(); toast(m.why || '출발이 취소되었습니다.', true); }

/* ---- 레이드 중 팀원 표시 (위치 공유) ---- */
const mates = new Map();
// 아군 모델: 군인 3D 캐릭터(soldier.js). 불러오지 못하면 기존 박스 모델로 대체
function mateModel() {
  try {
    if (window.SOLDIER && SOLDIER.ready) {
      const g = new THREE.Group(), ch = SOLDIER.makeChar('friend', 1);
      g.add(ch.root); g.userData.sol = ch; SOLDIER.relaxArms(ch);
      return g;
    }
  } catch (x) { console.warn('아군 군인 모델 실패 — 박스 모델 사용', x); }
  return mateModelBox();
}
function mateModelBox() {
  const g = new THREE.Group(), M = c => new THREE.MeshLambertMaterial({ color: c });
  const bx = (w, h, d, x, y, z, m) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); g.add(o); return o; };
  const skin = M(0xc89b7b), vest = M(0x2f6f9f), pants = M(0x34404a), boot = M(0x15110e);
  bx(.36, .56, .2, 0, 1.2, 0, vest); bx(.13, .85, .15, -.1, .43, 0, pants); bx(.13, .85, .15, .1, .43, 0, pants);
  bx(.14, .1, .2, -.1, .05, .03, boot); bx(.14, .1, .2, .1, .05, .03, boot);
  // 팔: 어깨(y=1.47)를 축으로 회전할 수 있게 pivot 그룹으로 만듦 (총을 들면 앞으로 뻗음)
  const arm = sx => { const pv = new THREE.Group(); pv.position.set(sx, 1.47, 0); const o = new THREE.Mesh(new THREE.BoxGeometry(.09, .55, .09), vest); o.position.y = -.275; pv.add(o); g.add(pv); return pv; };
  g.userData.arms = [arm(-.25), arm(.25)];
  const h = new THREE.Mesh(new THREE.SphereGeometry(.12, 12, 10), skin); h.position.y = 1.65; g.add(h);
  bx(.3, .09, .3, 0, 1.74, 0, M(0x2b3a2b));
  return g;
}
// 팀원이 들고 있는 무기를 모델에 장착/교체 (key = 아이템 키, 빈 문자열이면 맨손)
function setMateGun(e, key) {
  key = key || '';
  if (e.gk === key) return;
  e.gk = key;
  if (e.gun) { e.g.remove(e.gun); e.gun = null; }
  const o = key && typeof I !== 'undefined' && I[key] && I[key][5];
  if (o && typeof o.mdl === 'string' && typeof gunMesh === 'function') {
    try {
      const gun = gunMesh(o);
      const sol = e.g.userData.sol;
      if (sol) SOLDIER.holdGun(sol, gun, o.mdl);   // 양손이 총의 손잡이/핸드가드를 잡도록 팔 자세 계산
      else { gun.rotation.y = Math.PI; gun.position.set(.07, 1.33, .12); }   // 총구가 캐릭터 앞(+z)을 향하도록
      if (gun.userData.f) gun.userData.f.visible = false;
      e.g.add(gun); e.gun = gun;
    } catch (x) { e.gun = null; }
  }
  const sol = e.g.userData.sol;
  if (sol && !e.gun) SOLDIER.relaxArms(sol);
  const [aL, aR] = e.g.userData.arms || [];
  if (aL && aR) {
    if (e.gun) { aL.rotation.set(-1.35, 0, .45); aR.rotation.set(-1.25, 0, -.3); }   // 총을 두 손으로 겨눈 자세
    else { aL.rotation.set(0, 0, 0); aR.rotation.set(0, 0, 0); }
  }
}
function mateTag(n) { const t = el('div', { class: 'ol-tag', text: n }); document.body.append(t); return t; }
function removeMate(n) { const m = mates.get(n); if (!m) return; if (m.g.parent) m.g.parent.remove(m.g); m.tag.remove(); mates.delete(n); }
function onPos(m) {
  if (!RD || mode !== 'raid' || m.n === me.nick) return;
  let e = mates.get(m.n);
  if (!e) { try { e = { g: mateModel(), tag: mateTag(m.n), first: true }; } catch (x) { return; } mates.set(m.n, e); }
  Object.assign(e, { tx: m.x, ty: m.y, tz: m.z, tyaw: m.yaw, c: m.c, s: m.s, q: m.q, last: performance.now() });
  setMateGun(e, m.g);
}
const _v = (typeof THREE !== 'undefined' && THREE.Vector3) ? new THREE.Vector3() : null;
function mateLoop() {
  requestAnimationFrame(mateLoop);
  const tNow = performance.now(), dtf = Math.max(.001, Math.min(.1, (tNow - (mateLoop.t || tNow)) / 1000)); mateLoop.t = tNow;
  const live = RD && mode === 'raid';
  for (const [n, e] of mates) {
    if (!live || performance.now() - e.last > 4000) { removeMate(n); continue; }
    try {
      if (e.g.parent !== scene) scene.add(e.g);                  // 맵이 다시 만들어졌으면 새 씬에 붙임
      const p = e.g.position;
      if (e.first) { p.set(e.tx, e.ty, e.tz); e.g.rotation.y = e.tyaw + Math.PI; e.first = false; }
      const ox = p.x, oz = p.z;
      p.x += (e.tx - p.x) * .3; p.y += (e.ty - p.y) * .3; p.z += (e.tz - p.z) * .3;
      // 팀원 발소리: 실제 이동 거리에 맞춰 (내 발소리와 같은 간격/크기, 앉으면 무음)
      const mv = Math.hypot(p.x - ox, p.z - oz);
      e.sp = (e.sp || 0) * .8 + (mv / dtf) * .2;
      if (mv > 0 && e.sp > .5 && e.sp < 14 && !e.c && Math.abs(e.ty - p.y) < .6) {
        e.sd = (e.sd || 0) + mv;
        const stride = e.s ? 2.2 : e.q ? 1.3 : 1.7;
        if (e.sd >= stride) {
          e.sd = 0;
          try { stepAt(p.x, p.z, e.s ? .45 : e.q ? .035 : .24); } catch (x) { /* 오디오 불가 */ }
        }
      } else if (e.sp <= .5) e.sd = .9;
      const sol = e.g.userData.sol;
      if (sol) {                                                 // 걷기 다리 애니메이션
        e.ph = (e.ph || 0) + mv * 1.85;
        const tgt = (e.sp > .5 && !e.c) ? Math.min(.85, .35 + e.sp * .07) : 0;
        e.amp = (e.amp || 0) + (tgt - (e.amp || 0)) * .2;
        const a = Math.sin(e.ph) * e.amp; SOLDIER.swingLegs(sol, a, -a);
      }
      if (e.gun && e.gun.userData.f) e.gun.userData.f.visible = !!(e.flashT && tNow < e.flashT);   // 총구 화염
      let d = (e.tyaw + Math.PI) - e.g.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d)); e.g.rotation.y += d * .3;
      e.g.scale.y = e.c ? .78 : 1;
      _v.set(p.x, p.y + (e.c ? 1.55 : 1.95), p.z).project(camera);
      const dist = Math.hypot(p.x - pl.x, p.z - pl.z);
      const vis = _v.z < 1 && Math.abs(_v.x) < 1.05 && Math.abs(_v.y) < 1.05 && dist < 150;
      e.tag.style.display = vis ? 'block' : 'none';
      if (vis) { e.tag.style.left = ((_v.x + 1) / 2 * innerWidth) + 'px'; e.tag.style.top = ((1 - _v.y) / 2 * innerHeight) + 'px'; e.tag.textContent = `${n} · ${Math.round(dist)}m`; }
    } catch (x) { /* 씬 교체 중 등 */ }
  }
}
if (_v) requestAnimationFrame(mateLoop);
/* ---- 팀원 총소리 (방향·거리가 반영되는 3D 소리) ---- */
function onShot(m) {
  if (!RD || mode !== 'raid' || m.n === me.nick) return;
  try { gunSnd(m.x, m.z, !!m.h); } catch (x) { /* 오디오 불가 */ }
  const e = mates.get(m.n); if (e) e.flashT = performance.now() + 60;
}
const _shoot = shoot;
shoot = function (w) {
  const mg = w && w.mg, before = mg ? mg.mag : 0;
  const r = _shoot.apply(this, arguments);
  if (RD && mode === 'raid' && wsOpen && mg && mg.mag < before) {      // 실제로 발사된 경우만 (불발/빈 탄창 제외)
    const o = I[w.k] && I[w.k][5];
    ws.send(JSON.stringify({ t: 'shot', x: +pl.x.toFixed(1), z: +pl.z.toFixed(1), h: o && o.mdl !== 'pi' ? 1 : 0 }));
  }
  return r;
};
// 지금 손에 든 무기 키 (수류탄을 들었거나 맨손이면 빈 문자열)
function heldKey() {
  try { if (typeof GR !== 'undefined' && GR.on) return ''; const w = wpn(); return w && w.k ? String(w.k) : ''; } catch (x) { return ''; }
}
/* ---- 적 피해/처치 공유 ---- */
function onEnemyHit(m) {
  if (!RD || mode !== 'raid') return;
  const e = EN[m.i];
  if (!e || !e.alive || !(m.hp < e.hp)) return;
  e.hp = m.hp; e._shp = e.hp;
  if (e.st !== 'atk') { e.st = 'atk'; e.seen = now; }
  if (e.hp <= 0) { try { kill(e); } catch (x) { /* 이미 처치됨 */ } }
}
function syncEnemies() {
  for (let i = 0; i < EN.length; i++) {
    const e = EN[i];
    if (e._shp === undefined) e._shp = e.hp;
    if (e.hp < e._shp) { e._shp = e.hp; ws.send(JSON.stringify({ t: 'ehit', i, hp: Math.round(e.hp * 10) / 10 })); }
  }
}
setInterval(() => {            // 내 위치를 10Hz로 공유
  if (RD && mode === 'raid' && wsOpen) ws.send(JSON.stringify({ t: 'pos', x: +pl.x.toFixed(2), y: +pl.y.toFixed(2), z: +pl.z.toFixed(2), yaw: +pl.yaw.toFixed(3), c: pl.crouch ? 1 : 0, s: pl.sprint ? 1 : 0, q: (typeof qwS !== 'undefined' && qwS) ? 1 : 0, g: heldKey() }));
  if (RD && mode === 'raid' && wsOpen) syncEnemies();
  if (RD && mode !== 'raid' && performance.now() - RD.t0 > 3000) { RD = null; for (const n of [...mates.keys()]) removeMate(n); }
}, 100);

/* ---- 파티 출격 화면 (맵 선택 / 준비 / 출발) 과 로딩바 ---- */
const lobby = el('div', { id: 'olLobby', class: 'ol' }); document.body.append(lobby);
const loadBox = el('div', { id: 'olLoad', class: 'ol' }); document.body.append(loadBox);

function renderLobby() {
  const P = S && S.party;
  if (!lobbyOpen || !P || P.phase === 'loading' || launching) { lobby.classList.remove('on'); return; }
  const L = P.isLeader, others = P.members.filter(m => !m.leader), readyN = others.filter(m => m.ready).length, allReady = readyN === others.length;
  const me_ = P.members.find(m => m.nick === me.nick);
  const opt = (label, on, disabled, fn) => el('button', { class: 'ol-opt' + (on ? ' on' : ''), text: label, disabled: disabled || !L, onclick: fn });
  lobby.replaceChildren(el('div', { class: 'ol-modal' },
    el('h3', { text: '파티 출격' }),
    el('div', { class: 'ol-sec', text: L ? '맵 선택 (방장)' : '맵 (방장이 선택)' }),
    el('div', { class: 'ol-opts' }, ...['customs', 'lab'].map(k => opt(MAPN[k] + (k === 'lab' ? ' · 실내 · PMC 전용' : ''), P.map === k, false, () => send({ t: 'party:setup', map: k, mode: P.mode })))),
    el('div', { class: 'ol-sec', text: '모드' }),
    el('div', { class: 'ol-opts' }, ...['pmc', 'scav'].map(k => opt(k === 'pmc' ? 'PMC (내 장비)' : '스캐브 (랜덤 장비)', P.mode === k, P.map === 'lab' && k === 'scav', () => send({ t: 'party:setup', map: P.map, mode: k })))),
    el('div', { class: 'ol-sec', text: `파티원 (${P.members.length}/${P.max})` }),
    ...P.members.map(m => el('div', { class: 'ol-row' },
      el('span', { class: 'dot ' + (m.online ? (m.status === 'raid' ? 'raid' : 'on') : 'off') }),
      el('span', { class: 'nm' }, m.leader ? el('span', { class: 'ol-crown', text: '♛' }) : '', m.nick, m.nick === me.nick ? el('span', { class: 'sub', text: '나' }) : ''),
      m.leader ? el('span', { class: 'ol-wt', text: '방장' }) : m.ready ? el('span', { class: 'ol-rd', text: '준비완료 ✓' }) : el('span', { class: 'ol-wt', text: m.status === 'raid' ? '출격 중' : '대기 중' }))),
    el('div', { class: 'ol-hint', text: L ? (allReady ? '모든 파티원이 준비되었습니다. 출발하면 전원이 로딩을 마친 뒤 같은 스폰에서 시작합니다.' : `파티원이 준비완료를 눌러야 출발할 수 있습니다. (${readyN}/${others.length})`) : (me_ && me_.ready ? '준비완료! 방장이 출발하길 기다리는 중…' : '맵은 방장이 정합니다. 준비되면 [준비완료]를 누르세요.') }),
    el('div', { class: 'ol-btns' },
      L ? el('button', { class: 'go', text: '출발', disabled: !allReady, onclick: () => send({ t: 'party:launch' }) })
        : el('button', { class: 'go', text: me_ && me_.ready ? '준비 취소' : '준비완료', onclick: () => send({ t: 'party:ready', on: !(me_ && me_.ready) }) }),
      el('button', { class: 'ol-opt', text: '닫기', onclick: () => { lobbyOpen = false; renderAll(); } }))));
  lobby.classList.add('on');
}

function renderLoad() {
  const P = S && S.party, on = !!(launching || (P && P.phase === 'loading'));
  if (!on) { loadBox.classList.remove('on'); return; }
  const mp = launching ? launching.map : P && P.map, md = launching ? launching.mode : P && P.mode;
  const members = P ? P.members : [], done = members.filter(m => m.loaded).length, total = members.length || 1;
  loadBox.replaceChildren(el('div', { class: 'ol-modal ol-loadm' },
    el('h3', { text: `${MAPN[mp] || ''} · ${MODEN[md] || ''}` }),
    el('div', { class: 'ol-hint', text: done < total ? '모든 파티원이 준비될 때까지 기다리는 중…' : '출발!' }),
    el('div', { class: 'ol-pbar' }, el('i', { style: `width:${Math.max(6, Math.round(done / total * 100))}%` })),
    el('div', { class: 'ol-pnum', text: `${done} / ${total} 준비 완료` }),
    ...members.map(m => el('div', { class: 'ol-row' }, el('span', { class: 'nm' }, m.leader ? el('span', { class: 'ol-crown', text: '♛' }) : '', m.nick),
      m.loaded ? el('span', { class: 'ol-rd', text: '✓ 완료' }) : el('span', { class: 'ol-wt ol-spin', text: '맵 불러오는 중…' }))),
    el('div', { class: 'ol-btns' }, el('button', { class: 'ol-opt', text: '취소', onclick: () => send({ t: 'party:abort' }) }))));
  loadBox.classList.add('on');
}

/* ============================== 홈 화면 소셜 UI ============================== */
const bar = el('div', { id: 'olBar', class: 'ol' });
const friendsBtn = el('button', { text: '👥 친구', onclick: () => { panelOpen = !panelOpen; renderAll(); } });
bar.append(friendsBtn); document.body.append(bar);
const panel = el('div', { id: 'olPanel', class: 'ol' }); document.body.append(panel);
const pwidget = el('div', { id: 'olParty', class: 'ol' }); document.body.append(pwidget);
const invBox = el('div', { id: 'olInv', class: 'ol' }); document.body.append(invBox);

const homeVisible = () => { const h = $('home'); return !!h && h.style.display === 'flex' && loggedIn; };
function layout() {
  const v = homeVisible();
  bar.classList.toggle('on', v);
  panel.classList.toggle('on', v && panelOpen);
  pwidget.classList.toggle('on', v && !panelOpen && !!(S && S.party));
  invBox.classList.toggle('on', v && !!(S && S.invites.length));
}

const statTxt = { menu: '로비', raid: '출격 중', offline: '오프라인' };
const dotCls = f => (!f.online ? 'off' : f.status === 'raid' ? 'raid' : 'on');
const modeTxt = m => (m === 'pmc' ? 'PMC' : m === 'scav' ? '스캐브' : '');

function renderAll() {
  const incoming = S ? S.incoming.length + S.invites.length : 0;
  friendsBtn.replaceChildren(wsOpen || !loggedIn ? '👥 친구' : '👥 친구 (연결 중…)', incoming ? el('span', { class: 'bdg', text: incoming }) : '');
  renderPanel(); renderParty(); renderInvites(); renderLobby(); renderLoad(); layout();
}

function renderPanel() {
  if (!S) { panel.replaceChildren(el('div', { class: 'ol-ph' }, el('span', { text: '👥 친구' }), el('button', { class: 'x', text: '×', onclick: () => { panelOpen = false; renderAll(); } })), el('div', { class: 'ol-pb' }, el('div', { class: 'ol-empty', text: '서버에 연결 중…' }))); return; }
  const P = S.party, iAmLeader = !!(P && P.isLeader);
  const canInvite = f => f.online && f.status !== 'raid' && !f.inParty && (!P || iAmLeader) && !(P && P.pending.includes(f.nick));
  const input = el('input', { type: 'text', placeholder: '닉네임으로 친구 추가', maxlength: 12, autocomplete: 'off', spellcheck: 'false' });
  const addForm = el('form', { class: 'ol-add', onsubmit: ev => { ev.preventDefault(); const n = input.value.trim(); if (n && send({ t: 'friend:add', nick: n })) input.value = ''; } }, input, el('button', { type: 'submit', text: '요청' }));

  const sec = (title, kids, empty) => [el('h4', { text: title }), kids.length ? kids : el('div', { class: 'ol-empty', text: empty || '' })];
  const frows = S.friends.map(f => el('div', { class: 'ol-row' },
    el('span', { class: 'dot ' + dotCls(f) }), el('span', { class: 'nm' }, f.nick, el('span', { class: 'sub', text: f.inParty && f.online ? '파티 중' : statTxt[f.status] })),
    P && P.pending.includes(f.nick) ? el('span', { class: 'ol-wt', text: '초대함' }) : el('button', { class: 'pri', text: '초대', disabled: !canInvite(f), title: !f.online ? '오프라인' : f.inParty ? '이미 파티 중' : P && !iAmLeader ? '방장만 초대 가능' : '', onclick: () => send({ t: 'party:invite', nick: f.nick }) }),
    el('button', { class: 'dng', text: '삭제', onclick: () => { if (confirm(`${f.nick}님을 친구에서 삭제할까요?`)) send({ t: 'friend:remove', nick: f.nick }); } })));

  const prow = P && P.members.map(m => el('div', { class: 'ol-row' },
    el('span', { class: 'dot ' + (m.online ? (m.status === 'raid' ? 'raid' : 'on') : 'off') }),
    el('span', { class: 'nm' }, m.leader ? el('span', { class: 'ol-crown', text: '♛' }) : '', m.nick, m.nick === me.nick ? el('span', { class: 'sub', text: '나' }) : ''),
    m.ready ? el('span', { class: 'ol-rd', text: '준비 · ' + modeTxt(m.mode) }) : el('span', { class: 'ol-wt', text: m.status === 'raid' ? '출격 중' : '대기' }),
    iAmLeader && !m.leader ? el('button', { class: 'dng', text: '추방', onclick: () => send({ t: 'party:kick', nick: m.nick }) }) : ''));

  panel.replaceChildren(
    el('div', { class: 'ol-ph' }, el('div', {}, el('span', { text: me.nick }), el('small', { text: '계정: ' + me.id })),
      el('span', {}, el('button', { class: 'sm', text: '로그아웃', onclick: () => { if (confirm('로그아웃할까요? (자동 로그인이 해제됩니다)')) logout(); } }), el('button', { class: 'x', text: '×', onclick: () => { panelOpen = false; renderAll(); } }))),
    el('div', { class: 'ol-pb' },
      ...(P ? [el('h4', { text: `파티 (${P.members.length}/${P.max})` }), prow, el('button', { class: 'sm', text: '파티 나가기', onclick: () => send({ t: 'party:leave' }) })] : []),
      ...(S.invites.length ? [el('h4', { text: '받은 파티 초대' }), S.invites.map(iv => el('div', { class: 'ol-row' }, el('span', { class: 'nm', text: iv.from }), el('button', { class: 'pri', text: '수락', onclick: () => send({ t: 'party:accept', nick: iv.from }) }), el('button', { text: '거절', onclick: () => send({ t: 'party:decline', nick: iv.from }) })))] : []),
      el('h4', { text: '친구 추가' }), addForm,
      ...(S.incoming.length ? [el('h4', { text: '받은 친구 요청' }), S.incoming.map(n => el('div', { class: 'ol-row' }, el('span', { class: 'nm', text: n }), el('button', { class: 'pri', text: '수락', onclick: () => send({ t: 'friend:accept', nick: n }) }), el('button', { text: '거절', onclick: () => send({ t: 'friend:decline', nick: n }) })))] : []),
      ...sec(`친구 (${S.friends.filter(f => f.online).length}/${S.friends.length} 접속)`, frows, '아직 친구가 없습니다. 위에서 닉네임으로 추가하세요.'),
      ...(S.outgoing.length ? [el('h4', { text: '보낸 요청' }), S.outgoing.map(n => el('div', { class: 'ol-row' }, el('span', { class: 'nm', text: n }), el('span', { class: 'ol-wt', text: '대기 중' }), el('button', { text: '취소', onclick: () => send({ t: 'friend:cancel', nick: n }) })))] : []))
  );
}

function renderParty() {
  const P = S && S.party;
  if (!P) { pwidget.replaceChildren(); lobbyOpen = false; return; }
  pwidget.replaceChildren(
    el('div', { class: 'ph' }, el('span', { text: '파티' }), el('span', { text: `${P.members.length}/${P.max}` })),
    ...P.members.map(m => el('div', { class: 'pm' }, el('span', { class: 'dot ' + (m.online ? (m.status === 'raid' ? 'raid' : 'on') : 'off') }),
      el('span', { class: 'nm' }, m.leader ? el('span', { class: 'ol-crown', text: '♛' }) : '', m.nick),
      m.leader ? el('span', { class: 'ol-wt', text: '방장' }) : m.ready ? el('span', { class: 'ol-rd', text: '✓ 준비' }) : el('span', { class: 'ol-wt', text: m.status === 'raid' ? '출격 중' : '…' }))),
    el('div', { class: 'pf' }, P.isLeader ? '[플레이]를 눌러 맵을 고르고, 파티원이 준비완료하면 출발하세요.' : '[플레이]를 눌러 준비완료하세요. 맵은 방장이 고릅니다.')
  );
}

function renderInvites() {
  const list = S ? S.invites : [];
  invBox.replaceChildren(...list.map(iv => {
    if (!seenInvites.has(iv.from + iv.exp)) { seenInvites.add(iv.from + iv.exp); }
    return el('div', { class: 'ol-iv' }, el('div', {}, el('b', { text: iv.from }), '님이 파티에 초대했습니다.'),
      el('button', { text: '수락', onclick: () => send({ t: 'party:accept', nick: iv.from }) }), el('button', { class: 's', text: '거절', onclick: () => send({ t: 'party:decline', nick: iv.from }) }));
  }));
  // 초대가 만료되면 팝업도 사라지도록 주기적으로 정리
}
setInterval(() => { if (S && S.invites.some(i => i.exp < Date.now())) { S.invites = S.invites.filter(i => i.exp >= Date.now()); renderAll(); } }, 2000);

/* ============================== 시작: 자동 로그인 ============================== */
(async function boot() {
  token = getToken();
  if (!token) return showAuth();
  showLoading('자동 로그인 중…');
  const r = await api('/api/me');
  if (r.ok) { me = r.data; return me.nick ? enterGame() : showNick(); }
  if (r.status === 401) { clearToken(); return showAuth('로그인이 만료되었습니다. 다시 로그인하세요.'); }
  // 서버 연결 실패: 토큰은 유지한 채 재시도 버튼 제공
  box(el('div', { class: 'ol-load', text: r.data.error || '서버에 연결할 수 없습니다.' }), el('div', { class: 'ol-f' }, el('button', { class: 'go', text: '다시 시도', onclick: boot }), el('button', { class: 'ol-link', text: '다른 계정으로 로그인', onclick: () => { clearToken(); showAuth(); } })));
})();
})();
