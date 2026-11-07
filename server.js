'use strict';
/**
 * SHADOW EXTRACTION — 온라인 서버 (의존성 없음, Node 18+)
 *  - 계정(아이디/비밀번호) · 게임 닉네임 · 자동로그인 토큰 · 클라우드 세이브
 *  - 친구 요청/수락 · 파티 초대(초대한 사람 = 방장) · 전원 준비 시 동시 시작
 *  - 정적 파일(public/) + REST(/api/*) + WebSocket(/ws)
 *
 * 실행:  node server.js   (PORT=3000 기본)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);

const PORT = +process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PUBLIC = path.join(__dirname, 'docs');
const TRUST_PROXY = !!process.env.TRUST_PROXY;           // 리버스 프록시(nginx 등) 뒤에서 쓸 때 1
const SESSION_MS = 30 * 24 * 3600 * 1000;                // 자동로그인 유지 30일
// GitHub Pages 등 다른 주소의 게임 페이지에서 접속 허용 (쉼표로 구분, 예: https://id.github.io). 기본 '*'
const ALLOWED = (process.env.ALLOWED_ORIGINS || '*').split(',').map(x => x.trim().replace(/\/$/, '')).filter(Boolean);
const originOk = o => !o || ALLOWED.includes('*') || ALLOWED.includes(o);
const PARTY_MAX = 4;
const INVITE_MS = 60 * 1000;
const LOAD_TIMEOUT_MS = 45 * 1000;                       // 출발 후 전원 로딩 대기 한도
const OFFLINE_GRACE_MS = 20 * 1000;                      // 새로고침 등 짧은 끊김 허용

/* ============================== DB (JSON 파일) ============================== */
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'db.json');
let db = { users: {}, sessions: {}, requests: [] };      // users: uid → user
try { db = Object.assign(db, JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))); } catch (e) { /* 새 DB */ }
const nickIndex = new Map();                             // 소문자 닉네임 → uid
const idIndex = new Map();                               // 소문자 아이디 → uid
for (const [uid, u] of Object.entries(db.users)) {
  idIndex.set(u.idLower, uid);
  if (u.nick) nickIndex.set(u.nick.toLowerCase(), uid);
}
let dirty = false, writing = false;
function markDirty() { dirty = true; }
function flush() {
  if (!dirty || writing) return;
  dirty = false; writing = true;
  const tmp = DB_FILE + '.tmp';
  fs.writeFile(tmp, JSON.stringify(db), err => {
    if (err) { console.error('DB 저장 실패', err); dirty = true; writing = false; return; }
    fs.rename(tmp, DB_FILE, e2 => { if (e2) { console.error(e2); dirty = true; } writing = false; });
  });
}
setInterval(flush, 1000).unref();
function flushSync() { if (dirty) { try { fs.writeFileSync(DB_FILE, JSON.stringify(db)); dirty = false; } catch (e) { console.error(e); } } }
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { flushSync(); process.exit(0); });
process.on('exit', flushSync);

const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const now = () => Date.now();

/* ============================== 인증 유틸 ============================== */
const ID_RE = /^[A-Za-z0-9_]{4,20}$/;
const NICK_RE = /^[가-힣A-Za-z0-9_]{2,12}$/;
async function hashPw(pw, salt) { return (await scrypt(pw, salt, 64)).toString('hex'); }
function newSession(uid) {
  const token = crypto.randomBytes(32).toString('hex');
  db.sessions[sha(token)] = { uid, exp: now() + SESSION_MS };
  markDirty();
  return token;
}
function sessionUser(token) {
  if (typeof token !== 'string' || token.length !== 64) return null;
  const h = sha(token), s = db.sessions[h];
  if (!s) return null;
  if (s.exp < now()) { delete db.sessions[h]; markDirty(); return null; }
  if (s.exp - now() < SESSION_MS - 24 * 3600 * 1000) { s.exp = now() + SESSION_MS; markDirty(); }   // 하루 1회 연장
  return db.users[s.uid] || null;
}
for (const [h, s] of Object.entries(db.sessions)) if (s.exp < now()) delete db.sessions[h];

// 로그인 시도 제한 (IP당 10분에 20회 실패)
const fails = new Map();
function clientIp(req) {
  if (TRUST_PROXY && req.headers['x-forwarded-for']) return String(req.headers['x-forwarded-for']).split(',')[0].trim();
  return req.socket.remoteAddress || '?';
}
function limited(ip) { const f = fails.get(ip); return !!f && f.until > now() && f.n >= 20; }
function noteFail(ip) {
  let f = fails.get(ip);
  if (!f || f.until < now()) f = { n: 0, until: now() + 10 * 60 * 1000 };
  f.n++; fails.set(ip, f);
}
setInterval(() => { for (const [k, v] of fails) if (v.until < now()) fails.delete(k); }, 60000).unref();

/* ============================== HTTP ============================== */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json' };
const staticCache = new Map();   // 파일 경로 → {mtime, raw, gz, type}
function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.join(PUBLIC, path.normalize(rel));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Not found'); }
    let c = staticCache.get(file);
    const send = () => {
      const h = { 'Content-Type': c.type, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', Vary: 'Accept-Encoding' };
      const useGz = c.gz && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
      if (useGz) h['Content-Encoding'] = 'gzip';
      const body = useGz ? c.gz : c.raw;
      h['Content-Length'] = body.length;
      res.writeHead(200, h); res.end(req.method === 'HEAD' ? undefined : body);
    };
    if (c && c.mtime === st.mtimeMs) return send();
    fs.readFile(file, (e2, raw) => {
      if (e2) { res.writeHead(500); return res.end(); }
      const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
      const compressible = /^(text|application\/(json|javascript))|svg/.test(type);
      c = { mtime: st.mtimeMs, raw, type, gz: compressible ? zlib.gzipSync(raw, { level: 6 }) : null };
      staticCache.set(file, c); send();
    });
  });
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', d => { n += d.length; if (n > limit) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); } else chunks.push(d); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(Object.assign(new Error('bad json'), { status: 400 })); } });
    req.on('error', reject);
  });
}
function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}
const bearer = req => { const m = /^Bearer ([0-9a-f]{64})$/.exec(req.headers.authorization || ''); return m && m[1]; };

async function api(req, res, pathname) {
  const ip = clientIp(req);
  try {
    if (pathname === '/api/health') return json(res, 200, { ok: true, online: online.size });

    if (req.method === 'POST' && (pathname === '/api/register' || pathname === '/api/login')) {
      if (limited(ip)) return json(res, 429, { error: '시도가 너무 많습니다. 잠시 후 다시 시도하세요.' });
      const b = await readBody(req, 4096);
      const id = String(b.id || '').trim(), pw = String(b.pw || '');
      if (pathname === '/api/register') {
        if (!ID_RE.test(id)) return json(res, 400, { error: '아이디는 영문/숫자/_ 4~20자입니다.' });
        if (pw.length < 6 || pw.length > 64) return json(res, 400, { error: '비밀번호는 6~64자입니다.' });
        if (idIndex.has(id.toLowerCase())) return json(res, 409, { error: '이미 사용 중인 아이디입니다.' });
        const uid = crypto.randomUUID(), salt = crypto.randomBytes(16).toString('hex');
        db.users[uid] = { id, idLower: id.toLowerCase(), salt, hash: await hashPw(pw, salt), nick: null, friends: [], created: now(), save: null };
        idIndex.set(id.toLowerCase(), uid); markDirty();
        return json(res, 200, { token: newSession(uid), id, nick: null });
      }
      const uid = idIndex.get(id.toLowerCase()), u = uid && db.users[uid];
      // 존재하지 않는 아이디여도 동일한 연산을 수행해 타이밍 차이를 줄임
      const hash = await hashPw(pw, u ? u.salt : '0'.repeat(32));
      if (!u || !crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(u.hash, 'hex'))) {
        noteFail(ip); return json(res, 401, { error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
      }
      return json(res, 200, { token: newSession(uid), id: u.id, nick: u.nick });
    }

    const u = sessionUser(bearer(req));
    if (!u) return json(res, 401, { error: 'unauthorized' });
    const uid = idIndex.get(u.idLower);

    if (req.method === 'GET' && pathname === '/api/me') return json(res, 200, { id: u.id, nick: u.nick });

    if (req.method === 'POST' && pathname === '/api/logout') {
      delete db.sessions[sha(bearer(req))]; markDirty();
      return json(res, 200, { ok: true });
    }

    if (req.method === 'POST' && pathname === '/api/nick') {
      if (u.nick) return json(res, 400, { error: '게임 닉네임은 한 번 정하면 바꿀 수 없습니다.' });
      const nick = String((await readBody(req, 1024)).nick || '').trim();
      if (!NICK_RE.test(nick)) return json(res, 400, { error: '닉네임은 한글/영문/숫자/_ 2~12자입니다.' });
      if (nickIndex.has(nick.toLowerCase())) return json(res, 409, { error: '이미 사용 중인 닉네임입니다.' });
      u.nick = nick; nickIndex.set(nick.toLowerCase(), uid); markDirty();
      return json(res, 200, { nick });
    }

    if (req.method === 'GET' && pathname === '/api/save') return json(res, 200, u.save || {});
    if (req.method === 'PUT' && pathname === '/api/save') {
      const b = await readBody(req, 3 * 1024 * 1024);
      let t = 0;
      try { const s = JSON.parse(b.j); if (!s || typeof s.c !== 'object') throw 0; t = +s.t || 0; } catch (e) { return json(res, 400, { error: 'invalid save' }); }
      if (u.save && u.save.t > t) return json(res, 409, { error: 'stale', t: u.save.t });
      u.save = { j: b.j, t }; markDirty();
      return json(res, 200, { ok: true, t });
    }
    return json(res, 404, { error: 'not found' });
  } catch (e) {
    return json(res, e.status || 500, { error: e.status ? e.message : 'server error' });
  }
}

const server = http.createServer((req, res) => {
  const o = req.headers.origin;
  if (o && originOk(o)) {
    res.setHeader('Access-Control-Allow-Origin', o); res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '600');
  }
  if (req.method === 'OPTIONS') { res.writeHead(o && originOk(o) ? 204 : 403); return res.end(); }
  const pathname = new URL(req.url, 'http://x').pathname;
  if (pathname.startsWith('/api/')) return api(req, res, pathname);
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  serveStatic(req, res, pathname);
});

/* ============================== WebSocket (RFC 6455 최소 구현) ============================== */
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const WS_MAX = 64 * 1024;
class WS {
  constructor(socket) {
    this.socket = socket; this.buf = Buffer.alloc(0); this.frags = []; this.fragLen = 0; this.fragOp = 0;
    this.onmessage = null; this.onclose = null; this.closed = false; this.rate = 0;
    socket.setNoDelay(true);
    socket.on('data', d => this._data(d));
    socket.on('close', () => this._closed());
    socket.on('error', () => socket.destroy());
  }
  _closed() { if (this.closed) return; this.closed = true; if (this.onclose) this.onclose(); }
  _data(d) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    for (;;) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = !!(b[0] & 0x80), op = b[0] & 0x0f, masked = !!(b[1] & 0x80);
      let len = b[1] & 0x7f, off = 2;
      if (!masked) return this.close(1002);
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; const big = b.readBigUInt64BE(2); if (big > BigInt(WS_MAX)) return this.close(1009); len = Number(big); off = 10; }
      if (len > WS_MAX) return this.close(1009);
      if (b.length < off + 4 + len) return;
      const mask = b.subarray(off, off + 4), payload = Buffer.from(b.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < len; i++) payload[i] ^= mask[i & 3];
      this.buf = b.subarray(off + 4 + len);
      if (op >= 8) {                                       // 제어 프레임
        if (!fin || len > 125) return this.close(1002);
        if (op === 8) return this.close(1000);
        if (op === 9) this._frame(10, payload);
        continue;
      }
      if (op === 0) {                                      // 연속 프레임
        if (!this.fragOp) return this.close(1002);
        this.fragLen += len; if (this.fragLen > WS_MAX) return this.close(1009);
        this.frags.push(payload);
      } else { this.fragOp = op; this.frags = [payload]; this.fragLen = len; }
      if (fin) {
        const full = this.frags.length === 1 ? this.frags[0] : Buffer.concat(this.frags), fop = this.fragOp;
        this.frags = []; this.fragOp = 0; this.fragLen = 0;
        if (fop === 1 && this.onmessage) this.onmessage(full.toString('utf8'));
      }
    }
  }
  _frame(op, payload) {
    if (this.closed || this.socket.destroyed) return;
    const n = payload.length;
    const head = n < 126 ? Buffer.from([0x80 | op, n]) : n < 65536 ? Buffer.from([0x80 | op, 126, n >> 8, n & 255]) : (() => { const h = Buffer.alloc(10); h[0] = 0x80 | op; h[1] = 127; h.writeBigUInt64BE(BigInt(n), 2); return h; })();
    this.socket.write(Buffer.concat([head, payload]));
  }
  send(obj) { this._frame(1, Buffer.from(JSON.stringify(obj))); }
  close(code = 1000) {
    if (this.closed) return;
    try { const p = Buffer.alloc(2); p.writeUInt16BE(code); this._frame(8, p); } catch (e) { /* noop */ }
    this.socket.end(); setTimeout(() => this.socket.destroy(), 500).unref();
    this._closed();
  }
}

server.on('upgrade', (req, socket) => {
  const pathname = new URL(req.url, 'http://x').pathname;
  const key = req.headers['sec-websocket-key'];
  const origin = req.headers.origin;
  let badOrigin = false;
  if (origin) { try { badOrigin = new URL(origin).host !== req.headers.host && !originOk(origin); } catch (e) { badOrigin = true; } }
  if (pathname !== '/ws' || !key || String(req.headers.upgrade).toLowerCase() !== 'websocket' || badOrigin) {
    socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); return socket.destroy();
  }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  onConnect(new WS(socket));
});

/* ============================== 실시간 상태: 접속 / 친구 / 파티 ============================== */
const online = new Map();        // uid → Set<WS>
const status = new Map();        // uid → 'menu' | 'raid'
const offlineTimers = new Map(); // uid → Timeout (끊김 유예)
const parties = new Map();       // partyId → { id, leader, members:[uid], ready: Set<uid>(파티원 준비완료), invites: Map<uid, exp>, map, mode, phase:'lobby'|'loading', loaded:Set, timer, raid }
const userParty = new Map();     // uid → partyId
const invites = new Map();       // 초대받은 uid → Map<fromUid, { partyId, exp }>

const uidOf = nick => nickIndex.get(String(nick || '').toLowerCase());
const nickOf = uid => (db.users[uid] && db.users[uid].nick) || '?';
const isOnline = uid => online.has(uid) && online.get(uid).size > 0;
const sendTo = (uid, obj) => { const s = online.get(uid); if (s) for (const w of s) w.send(obj); };
const toast = (uid, m) => sendTo(uid, { t: 'toast', m });
const fail = (ws, m) => ws.send({ t: 'err', m });

function liveInvites(uid) {
  const m = invites.get(uid), out = [];
  if (!m) return out;
  for (const [from, iv] of m) {
    const p = parties.get(iv.partyId);
    if (iv.exp < now() || !p || p.leader !== from) m.delete(from); else out.push({ from: nickOf(from), exp: iv.exp });
  }
  if (!m.size) invites.delete(uid);
  return out;
}
function view(uid) {
  const u = db.users[uid];
  const friends = u.friends.map(f => ({ nick: nickOf(f), online: isOnline(f), status: isOnline(f) ? (status.get(f) || 'menu') : 'offline', inParty: userParty.has(f) }))
    .sort((a, b) => (b.online - a.online) || a.nick.localeCompare(b.nick, 'ko'));
  const incoming = db.requests.filter(r => r.to === uid).map(r => nickOf(r.from));
  const outgoing = db.requests.filter(r => r.from === uid).map(r => nickOf(r.to));
  const p = parties.get(userParty.get(uid));
  const party = p && {
    leader: nickOf(p.leader), isLeader: p.leader === uid, max: PARTY_MAX, map: p.map, mode: p.mode, phase: p.phase,
    members: p.members.map(m => ({ nick: nickOf(m), leader: m === p.leader, online: isOnline(m), status: status.get(m) || 'menu', ready: p.ready.has(m), loaded: p.loaded.has(m) })),
    pending: [...p.invites].filter(([, e]) => e > now()).map(([t]) => nickOf(t))
  };
  return { t: 'state', me: { id: u.id, nick: u.nick }, friends, incoming, outgoing, invites: liveInvites(uid), party };
}
const push = uid => { if (isOnline(uid)) sendTo(uid, view(uid)); };
const pushParty = p => p.members.forEach(push);

function setStatus(uid, s) {
  if (status.get(uid) === s) return;
  const was = status.get(uid);
  status.set(uid, s);
  if (was === 'raid' && s === 'menu') mateGone(uid);
  push(uid);
  for (const f of db.users[uid].friends) push(f);
  const p = parties.get(userParty.get(uid)); if (p) pushParty(p);
}

function disband(p) {
  parties.delete(p.id);
  for (const m of p.members) { userParty.delete(m); toast(m, '파티가 해산되었습니다.'); }
  for (const t of p.invites.keys()) { const iv = invites.get(t); if (iv) { iv.delete(p.leader); if (!iv.size) invites.delete(t); } push(t); }
  p.members.forEach(push);
}
function leaveParty(uid, kicked) {
  const p = parties.get(userParty.get(uid)); if (!p) return;
  if (p.phase === 'loading') abortLoad(p, '파티 구성이 바뀌어 출발이 취소되었습니다.');
  mateGone(uid);
  p.members = p.members.filter(m => m !== uid); userParty.delete(uid); p.ready.clear();
  toast(uid, kicked ? '파티에서 추방되었습니다.' : '파티에서 나왔습니다.');
  if (p.members.length <= 1) { disband(p); push(uid); return; }
  if (p.leader === uid) { p.leader = p.members[0]; for (const m of p.members) toast(m, `${nickOf(p.leader)}님이 새 방장입니다.`); }
  else for (const m of p.members) toast(m, `${nickOf(uid)}님이 파티를 ${kicked ? '떠났습니다(추방)' : '떠났습니다'}.`);
  push(uid); pushParty(p);
}
// 팀원이 레이드에서 빠짐 → 같은 파티원에게 알림 (팀원 모델 제거용)
function mateGone(uid) {
  const p = parties.get(userParty.get(uid)); if (!p) return;
  for (const m of p.members) if (m !== uid) sendTo(m, { t: 'pgone', n: nickOf(uid) });
}
function newParty(leader) {
  const p = { id: crypto.randomBytes(6).toString('hex'), leader, members: [leader], ready: new Set(), invites: new Map(), map: 'customs', mode: 'pmc', phase: 'lobby', loaded: new Set(), timer: null, raid: null };
  parties.set(p.id, p); userParty.set(leader, p.id);
  return p;
}
// 출발(방장) → 전원 로딩 → 전원 로딩 완료 시 동시에 시작
function launch(p) {
  p.phase = 'loading'; p.loaded.clear();
  const seed = crypto.randomInt(1, 2 ** 31 - 1), raidId = crypto.randomBytes(6).toString('hex');
  p.raid = { id: raidId, seed };
  clearTimeout(p.timer);
  p.timer = setTimeout(() => { if (p.phase === 'loading') abortLoad(p, '로딩 시간이 초과되어 출발이 취소되었습니다.'); }, LOAD_TIMEOUT_MS);
  for (const m of p.members) sendTo(m, { t: 'launch', map: p.map, mode: p.mode, seed, raidId, party: p.members.map(nickOf) });
  pushParty(p);
}
function abortLoad(p, why) {
  if (p.phase !== 'loading') return;
  clearTimeout(p.timer); p.phase = 'lobby'; p.loaded.clear(); p.ready.clear(); p.raid = null;
  for (const m of p.members) sendTo(m, { t: 'abort', why });
  pushParty(p);
}
function goRaid(p) {
  clearTimeout(p.timer); p.phase = 'lobby';
  const names = p.members.map(nickOf);
  for (const m of p.members) { status.set(m, 'raid'); sendTo(m, { t: 'go', map: p.map, mode: p.mode, seed: p.raid.seed, raidId: p.raid.id, party: names }); }
  p.loaded.clear(); p.ready.clear();
  for (const m of p.members) for (const f of db.users[m].friends) push(f);
  pushParty(p);
}

function handle(ws, uid, m) {
  const u = db.users[uid];
  switch (m.t) {
    case 'status':
      if (m.s === 'menu' || m.s === 'raid') setStatus(uid, m.s);
      break;

    /* ---- 친구 ---- */
    case 'friend:add': {
      const to = uidOf(m.nick);
      if (!to) return fail(ws, '해당 닉네임의 유저를 찾을 수 없습니다.');
      if (to === uid) return fail(ws, '자기 자신은 추가할 수 없습니다.');
      if (u.friends.includes(to)) return fail(ws, '이미 친구입니다.');
      if (db.requests.some(r => r.from === uid && r.to === to)) return fail(ws, '이미 친구 요청을 보냈습니다.');
      if (db.requests.some(r => r.from === to && r.to === uid)) return handle(ws, uid, { t: 'friend:accept', nick: m.nick });   // 서로 요청 → 즉시 친구
      if (db.requests.filter(r => r.from === uid).length >= 30) return fail(ws, '보낸 요청이 너무 많습니다.');
      db.requests.push({ from: uid, to }); markDirty();
      toast(to, `${u.nick}님이 친구 요청을 보냈습니다.`); toast(uid, `${nickOf(to)}님에게 친구 요청을 보냈습니다.`);
      push(uid); push(to); break;
    }
    case 'friend:accept': {
      const from = uidOf(m.nick), i = db.requests.findIndex(r => r.from === from && r.to === uid);
      if (!from || i < 0) return fail(ws, '받은 요청이 없습니다.');
      db.requests = db.requests.filter(r => !((r.from === from && r.to === uid) || (r.from === uid && r.to === from)));
      if (!u.friends.includes(from)) u.friends.push(from);
      if (!db.users[from].friends.includes(uid)) db.users[from].friends.push(uid);
      markDirty(); toast(uid, `${nickOf(from)}님과 친구가 되었습니다.`); toast(from, `${u.nick}님이 친구 요청을 수락했습니다.`);
      push(uid); push(from); break;
    }
    case 'friend:decline': case 'friend:cancel': {
      const other = uidOf(m.nick); if (!other) return;
      const before = db.requests.length;
      db.requests = db.requests.filter(r => !(m.t === 'friend:decline' ? (r.from === other && r.to === uid) : (r.from === uid && r.to === other)));
      if (db.requests.length !== before) markDirty();
      push(uid); push(other); break;
    }
    case 'friend:remove': {
      const other = uidOf(m.nick); if (!other || !u.friends.includes(other)) return;
      u.friends = u.friends.filter(f => f !== other);
      db.users[other].friends = db.users[other].friends.filter(f => f !== uid); markDirty();
      push(uid); push(other); break;
    }

    /* ---- 파티 ---- */
    case 'party:invite': {
      const to = uidOf(m.nick);
      if (!to || !u.friends.includes(to)) return fail(ws, '친구만 초대할 수 있습니다.');
      if (!isOnline(to)) return fail(ws, '오프라인인 친구입니다.');
      if (userParty.has(to)) return fail(ws, '이미 파티에 속해 있는 친구입니다.');
      if (status.get(to) === 'raid') return fail(ws, '출격 중인 친구입니다.');
      if (status.get(uid) === 'raid') return fail(ws, '출격 중에는 초대할 수 없습니다.');
      let p = parties.get(userParty.get(uid));
      if (p && p.leader !== uid) return fail(ws, '방장만 초대할 수 있습니다.');
      if (p && p.members.length + [...p.invites.values()].filter(e => e > now()).length >= PARTY_MAX) return fail(ws, `파티는 최대 ${PARTY_MAX}명입니다.`);
      if (!p) {          // 초대한 사람이 방장이 되는 새 파티
        p = newParty(uid);
      }
      p.invites.set(to, now() + INVITE_MS);
      if (!invites.has(to)) invites.set(to, new Map());
      invites.get(to).set(uid, { partyId: p.id, exp: now() + INVITE_MS });
      toast(to, `${u.nick}님이 파티에 초대했습니다.`); toast(uid, `${nickOf(to)}님을 초대했습니다.`);
      push(uid); push(to); break;
    }
    case 'party:accept': {
      const from = uidOf(m.nick), iv = from && invites.get(uid) && invites.get(uid).get(from);
      if (!iv || iv.exp < now()) return fail(ws, '만료되었거나 없는 초대입니다.');
      const p = parties.get(iv.partyId);
      if (!p || p.leader !== from) return fail(ws, '파티가 더 이상 존재하지 않습니다.');
      if (userParty.has(uid)) return fail(ws, '이미 파티에 속해 있습니다. 먼저 나가세요.');
      if (p.members.length >= PARTY_MAX) return fail(ws, '파티가 가득 찼습니다.');
      if (p.phase === 'loading') return fail(ws, '지금은 출발 중이라 참가할 수 없습니다.');
      invites.delete(uid); p.invites.delete(uid);
      p.members.push(uid); userParty.set(uid, p.id); p.ready.clear();
      for (const mm of p.members) toast(mm, `${u.nick}님이 파티에 참가했습니다.`);
      pushParty(p); break;
    }
    case 'party:decline': {
      const from = uidOf(m.nick), mp = invites.get(uid);
      if (!from || !mp || !mp.has(from)) return;
      const p = parties.get(mp.get(from).partyId);
      mp.delete(from); if (!mp.size) invites.delete(uid);
      if (p) { p.invites.delete(uid); toast(from, `${u.nick}님이 초대를 거절했습니다.`); push(from); }
      push(uid); break;
    }
    case 'party:leave': leaveParty(uid, false); break;
    case 'party:kick': {
      const p = parties.get(userParty.get(uid)), t = uidOf(m.nick);
      if (!p || p.leader !== uid) return fail(ws, '방장만 추방할 수 있습니다.');
      if (!t || t === uid || !p.members.includes(t)) return;
      leaveParty(t, true); break;
    }
    case 'party:setup': {                 // 방장만: 맵 / 모드 선택 (바뀌면 파티원 준비 해제)
      const p = parties.get(userParty.get(uid));
      if (!p || p.leader !== uid) return fail(ws, '방장만 맵을 고를 수 있습니다.');
      if (p.phase !== 'lobby') return;
      const map = m.map === 'lab' ? 'lab' : 'customs';
      let mode = m.mode === 'scav' ? 'scav' : 'pmc';
      if (map === 'lab') mode = 'pmc';                       // 랩은 PMC 전용
      if (p.map !== map || p.mode !== mode) { p.map = map; p.mode = mode; p.ready.clear(); }
      pushParty(p); break;
    }
    case 'party:ready': {                 // 파티원: 준비완료 / 취소 (방장은 '출발'을 누름)
      const p = parties.get(userParty.get(uid));
      if (!p) return fail(ws, '파티가 없습니다.');
      if (p.leader === uid) return;
      if (p.phase !== 'lobby') return;
      if (status.get(uid) === 'raid') return fail(ws, '이미 출격 중입니다.');
      if (m.on === false) p.ready.delete(uid); else p.ready.add(uid);
      pushParty(p); break;
    }
    case 'party:launch': {                // 방장: 전원 준비완료여야 출발 가능
      const p = parties.get(userParty.get(uid));
      if (!p || p.leader !== uid) return fail(ws, '방장만 출발할 수 있습니다.');
      if (p.phase !== 'lobby') return;
      const others = p.members.filter(x => x !== uid);
      if (!others.length) return fail(ws, '파티원이 없습니다.');
      if (!others.every(x => p.ready.has(x))) return fail(ws, '모든 파티원이 준비완료를 눌러야 출발할 수 있습니다.');
      if (!p.members.every(x => isOnline(x) && status.get(x) !== 'raid')) return fail(ws, '접속이 끊겼거나 출격 중인 파티원이 있습니다.');
      launch(p); break;
    }
    case 'party:loaded': {                // 각자 맵 로딩을 마치면 보고 → 전원 완료 시 동시 시작
      const p = parties.get(userParty.get(uid));
      if (!p || p.phase !== 'loading') return;
      p.loaded.add(uid);
      if (p.members.every(x => p.loaded.has(x))) goRaid(p); else pushParty(p);
      break;
    }
    case 'party:abort': {                 // 로딩 중 취소 (누구나)
      const p = parties.get(userParty.get(uid));
      if (p && p.phase === 'loading') abortLoad(p, `${u.nick}님이 출발을 취소했습니다.`);
      break;
    }

    /* ---- 레이드 중 팀원 위치 공유 (같은 레이드에 있는 파티원에게만 전달) ---- */
    case 'pos': {
      const p = parties.get(userParty.get(uid));
      if (!p || status.get(uid) !== 'raid') return;
      const f = k => (Number.isFinite(m[k]) ? Math.max(-1000, Math.min(1000, m[k])) : 0);
      const msg = { t: 'pos', n: u.nick, x: f('x'), y: f('y'), z: f('z'), yaw: f('yaw'), c: m.c ? 1 : 0, w: m.w ? 1 : 0 };
      for (const mm of p.members) if (mm !== uid && status.get(mm) === 'raid') sendTo(mm, msg);
      break;
    }
    /* ---- 레이드 중 적 피해/처치 공유: 같은 시드로 만든 같은 번호의 적에게 hp를 맞춰 줌 ---- */
    case 'ehit': {
      const p = parties.get(userParty.get(uid));
      if (!p || status.get(uid) !== 'raid') return;
      const i = Math.floor(m.i), hp = +m.hp;
      if (!(i >= 0 && i < 400) || !Number.isFinite(hp)) return;
      const msg = { t: 'ehit', i, hp: Math.max(-1000, Math.min(1000, hp)) };
      for (const mm of p.members) if (mm !== uid && status.get(mm) === 'raid') sendTo(mm, msg);
      break;
    }
  }
}

function onConnect(ws) {
  let uid = null;
  const authTimer = setTimeout(() => { if (!uid) ws.close(4001); }, 5000);
  const rateTimer = setInterval(() => { ws.rate = 0; }, 1000);
  ws.onmessage = raw => {
    if (++ws.rate > 60) return ws.close(4008);
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;
    if (!uid) {
      if (m.t !== 'auth') return;
      const u = sessionUser(m.token);
      if (!u) { ws.send({ t: 'auth', ok: false }); return ws.close(4003); }
      if (!u.nick) { ws.send({ t: 'auth', ok: false, needNick: true }); return ws.close(4004); }
      clearTimeout(authTimer);
      uid = idIndex.get(u.idLower);
      if (!online.has(uid)) online.set(uid, new Set());
      online.get(uid).add(ws);
      clearTimeout(offlineTimers.get(uid)); offlineTimers.delete(uid);
      if (!status.has(uid)) status.set(uid, 'menu');
      ws.send({ t: 'auth', ok: true });
      push(uid);
      for (const f of u.friends) push(f);
      const p = parties.get(userParty.get(uid)); if (p) pushParty(p);
      return;
    }
    try { handle(ws, uid, m); } catch (e) { console.error('handler error', e); }
  };
  ws.onclose = () => {
    clearTimeout(authTimer); clearInterval(rateTimer);
    if (!uid) return;
    const set = online.get(uid); if (set) { set.delete(ws); if (set.size) return; }
    online.delete(uid);
    for (const f of db.users[uid].friends) push(f);
    const p = parties.get(userParty.get(uid)); if (p) { abortLoad(p, '파티원의 접속이 끊겨 출발이 취소되었습니다.'); pushParty(p); }
    // 짧은 끊김(새로고침)은 파티를 유지하고, 오래 끊기면 파티에서 제거
    offlineTimers.set(uid, setTimeout(() => {
      offlineTimers.delete(uid);
      if (isOnline(uid)) return;
      status.delete(uid);
      leaveParty(uid, false);
      const iv = invites.get(uid); if (iv) invites.delete(uid);
    }, OFFLINE_GRACE_MS));
  };
}

server.listen(PORT, () => console.log(`SHADOW EXTRACTION online server → http://localhost:${PORT}`));
module.exports = { server };
