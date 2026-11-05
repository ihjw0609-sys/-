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
  setTimeout(() => form.elements.id.focus(), 30);
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
    if (m.t === 'start') return onStart(m);
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

/* ============================== 플레이 (파티 준비 → 동시 시작) ============================== */
const _pmc = playPMC, _scav = playScav;
const startDirect = m => (m === 'scav' ? _scav() : _pmc());
function play(m) {
  if (S && S.party && wsOpen) { send({ t: 'party:ready', mode: m }); return; }   // 파티: 서버가 전원 준비를 확인한 뒤 start 신호를 보냄
  startDirect(m);                                                                // 솔로: 즉시 출격
}
playPMC = () => play('pmc');
playScav = () => play('scav');
function onStart(m) {
  toast('전원 준비 완료 — 출격합니다!');
  try { closePlay(); } catch (e) { /* noop */ }
  startDirect(m.mode);
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
  renderPanel(); renderParty(); renderInvites(); layout();
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
  if (!P) { pwidget.replaceChildren(); return; }
  const mine = P.members.find(m => m.nick === me.nick);
  const waiting = mine && mine.ready;
  const readyN = P.members.filter(m => m.ready).length;
  pwidget.replaceChildren(
    el('div', { class: 'ph' }, el('span', { text: '파티' }), el('span', { text: `${P.members.length}/${P.max}` })),
    ...P.members.map(m => el('div', { class: 'pm' }, el('span', { class: 'dot ' + (m.online ? (m.status === 'raid' ? 'raid' : 'on') : 'off') }),
      el('span', { class: 'nm' }, m.leader ? el('span', { class: 'ol-crown', text: '♛' }) : '', m.nick),
      m.ready ? el('span', { class: 'ol-rd', text: '✓ 준비' }) : el('span', { class: 'ol-wt', text: m.status === 'raid' ? '출격 중' : '…' }))),
    waiting
      ? el('div', { class: 'pf wait' }, `다른 파티원을 기다리는 중… (${readyN}/${P.members.length})`, el('button', { class: 's', text: '준비 취소', onclick: () => send({ t: 'party:unready' }) }))
      : el('div', { class: 'pf' }, P.isLeader ? '방장도, 파티원도 [플레이]에서 모드를 선택해야 시작됩니다.' : '[플레이]에서 모드를 선택하면 준비됩니다. 방장도 준비해야 시작됩니다.')
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
