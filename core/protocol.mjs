/*! cyborgd — protocol · (c) 2026 BANKON / PYTHAI · MIT · upstream patterns © oncyberio (MIT) */
// The cyborg/1 protocol: type guards + encoders. PURE JS (no node-only imports) — the same file runs in
// the browser host (dist/cyborgd-core.js) and in the daemon. Every inbound message passes a guard
// before a room sees it; an unknown or invalid message answers `error` and counts against the
// sender (INVALID_LIMIT strikes → close 1008). Upstream precedent: the oo-game-server `player-state`
// tuple [px,py,pz,rx,ry,rz,animation,scale,vrmUrl,text] becomes `state{p,r,a,s,txt}`; the awe
// net-platformer command frame {tick,sequence,moveX,moveY,sprint,jumpPressed,jumpReleased,jumpHeld,yaw}
// becomes `cmd{tick,seq,mx,my,sprint,jp,jr,jh,yaw}`.
//
// THE TRIAD adds five messages: `rtc` (relayed opaque signaling, same space only), `peers` (roster),
// `host` (election result), `mirror` (host → anchor canonical snapshot) and `repoint` (anchor → a
// client whose host vanished: "connect to this one now").
export const VERSION = 'cyborg/1';
export const INVALID_LIMIT = 20;
export const RATE = { sim: 60, net: 20 };
export const STATE_HZ_MAX = 20;
export const MAX_TXT = 140;
export const MAX_NAME = 32;
export const MAX_MSG_BYTES = 4096;
export const MAX_RTC_BYTES = 16384;
export const MAX_SNAP_BYTES = 262144;

export const CLIENT_TYPES = ['hello', 'state', 'cmd', 'msg', 'event', 'ping', 'rtc', 'mirror', 'lost'];
export const SERVER_TYPES = ['welcome', 'denied', 'joined', 'left', 'snap', 'ack', 'msg', 'voucher', 'say', 'pong', 'error',
                             'peers', 'host', 'repoint', 'rtc'];
export const EVENT_NAMES = ['portal', 'riddle', 'reach', 'gesture', 'focus', 'item'];
export const ITEM_ACTIONS = ['use', 'raise', 'lower', 'select'];
export const GESTURES = ['smile', 'jawOpen', 'browsUp', 'nod', 'greet', 'wave', 'point', 'raise', 'bow'];
export const AVATAR_KINDS = ['aivatar', 'vrm', 'primitive'];
export const ROLES = ['client', 'host', 'anchor'];
export const RTC_KINDS = ['offer', 'answer', 'ice'];

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isStr = (v, max = 256) => typeof v === 'string' && v.length <= max;
const isVec3 = (v) => Array.isArray(v) && v.length === 3 && v.every(isNum);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isBool = (v) => typeof v === 'boolean';
const isId = (v, max = 64) => isStr(v, max) && /^[A-Za-z0-9._:-]+$/.test(v);
const isTick = (v) => isNum(v) && v >= 0 && v === Math.floor(v);
export const is = { num: isNum, str: isStr, vec3: isVec3, obj: isObj, bool: isBool, id: isId, tick: isTick };

export const guards = {
  hello(m) {
    if (m.v !== VERSION) return 'v must be ' + VERSION;
    if (!isId(m.space)) return 'space id';
    if (m.claim !== undefined && !isStr(m.claim, 4096)) return 'claim';
    if (m.name !== undefined && !isStr(m.name, MAX_NAME)) return 'name';
    if (m.vrm !== undefined && !isStr(m.vrm, 512)) return 'vrm';
    if (m.role !== undefined && !['client', 'host'].includes(m.role)) return 'role';
    if (m.avatar !== undefined) {
      if (!isObj(m.avatar) || !AVATAR_KINDS.includes(m.avatar.kind)) return 'avatar.kind';
      if (m.avatar.seed !== undefined && !(isNum(m.avatar.seed) || isStr(m.avatar.seed, 64))) return 'avatar.seed';
      if (m.avatar.tint !== undefined && !(isStr(m.avatar.tint, 16) && /^#?[0-9a-fA-F]{3,8}$/.test(m.avatar.tint))) return 'avatar.tint';
    }
    return null;
  },
  state(m) {
    if (!isVec3(m.p)) return 'p';
    if (!isVec3(m.r)) return 'r';
    if (!isStr(m.a, 32)) return 'a';
    if (!isNum(m.s) || m.s <= 0 || m.s > 10) return 's';
    if (m.txt !== undefined && !isStr(m.txt, MAX_TXT)) return 'txt';
    if (m.p.some((x) => Math.abs(x) > 1e5)) return 'p out of world';
    return null;
  },
  cmd(m) {
    if (!isTick(m.tick)) return 'tick';
    if (!isTick(m.seq)) return 'seq';
    if (!isNum(m.mx) || m.mx < -1 || m.mx > 1) return 'mx';
    if (!isNum(m.my) || m.my < -1 || m.my > 1) return 'my';
    if (!isBool(m.sprint) || !isBool(m.jp) || !isBool(m.jr) || !isBool(m.jh)) return 'sprint/jp/jr/jh';
    if (!isNum(m.yaw)) return 'yaw';
    return null;
  },
  msg(m) {
    if (m.to !== undefined && !isId(m.to)) return 'to';
    if (m.data === undefined) return 'data';
    if (JSON.stringify(m.data).length > MAX_MSG_BYTES) return 'data too large';
    return null;
  },
  event(m) {
    if (!EVENT_NAMES.includes(m.name)) return 'name';
    if (!isObj(m.data)) return 'data';
    if (m.name === 'gesture' && !GESTURES.includes(m.data.name)) return 'gesture name';
    if (m.name === 'focus' && !(m.data.agent === null || isId(m.data.agent))) return 'focus agent';
    if (m.name === 'item' && !(isStr(m.data.name, 32) && ITEM_ACTIONS.includes(m.data.action))) return 'item name/action';
    if (m.name === 'portal' && !isId(m.data.to)) return 'portal to';
    if (m.name === 'reach' && !isId(m.data.zone)) return 'reach zone';
    if (m.name === 'riddle' && !isId(m.data.agent)) return 'riddle agent';
    if (JSON.stringify(m.data).length > MAX_MSG_BYTES) return 'data too large';
    return null;
  },
  ping(m) { return isNum(m.t) ? null : 't'; },
  /** rtc{to,kind,payload}: relayed to `to` if (and only if) it is in the sender's space; payload is never inspected */
  rtc(m) {
    if (!isId(m.to)) return 'to';
    if (!RTC_KINDS.includes(m.kind)) return 'kind';
    if (m.payload === undefined) return 'payload';
    if (JSON.stringify(m.payload).length > MAX_RTC_BYTES) return 'payload too large';
    return null;
  },
  /** mirror{tick,snap}: only the elected host may send it; the anchor applies last-writer-wins by tick */
  mirror(m) {
    if (!isTick(m.tick)) return 'tick';
    if (!isObj(m.snap)) return 'snap';
    if (m.snap.players !== undefined && !isObj(m.snap.players)) return 'snap.players';
    if (m.snap.agents !== undefined && !isObj(m.snap.agents)) return 'snap.agents';
    if (JSON.stringify(m.snap).length > MAX_SNAP_BYTES) return 'snap too large';
    return null;
  },
  /** lost{host}: a client reports its host is gone → the anchor answers repoint{host} */
  lost(m) { return m.host === undefined || m.host === null || isId(m.host) ? null : 'host'; },
};

/** Parse + validate an inbound client message. Returns { ok:true, msg } or { ok:false, code, message }. */
export function parseClient(raw) {
  let m;
  if (typeof raw === 'string') {
    if (raw.length > MAX_SNAP_BYTES + 1024) return { ok: false, code: 'too-large', message: 'message exceeds the frame limit' };
    try { m = JSON.parse(raw); } catch (e) { return { ok: false, code: 'bad-json', message: 'not JSON' }; }
  } else m = raw;
  if (!isObj(m) || !isStr(m.type, 16)) return { ok: false, code: 'bad-shape', message: 'object with type expected' };
  const g = guards[m.type];
  if (!g || !CLIENT_TYPES.includes(m.type)) return { ok: false, code: 'unknown-type', message: 'unknown type ' + m.type };
  const bad = g(m);
  if (bad) return { ok: false, code: 'invalid', message: m.type + ': ' + bad };
  return { ok: true, msg: m };
}

// ── encoders (server → client) ──
export const enc = {
  welcome: (o) => ({ type: 'welcome', v: VERSION, rate: RATE, ...o }),
  denied: (reason, minRole, rung) => ({ type: 'denied', reason, minRole, rung }),
  joined: (p) => ({ type: 'joined', sessionId: p.sessionId, name: p.name, avatar: p.avatar, rank: p.rank, rung: p.rung, role: p.role }),
  left: (sessionId, reason) => ({ type: 'left', sessionId, ...(reason ? { reason } : {}) }),
  snap: (tick, ts, players, agents, full) => ({ type: 'snap', tick, ts, players, agents, ...(full ? { full: true } : {}) }),
  ack: (tick, seq, checkpoint) => ({ type: 'ack', tick, seq, checkpoint }),
  msg: (from, data, to) => ({ type: 'msg', from, data, ...(to ? { to } : {}) }),
  voucher: (v) => ({ type: 'voucher', ...v }),
  say: (agent, text, emotion, to) => ({ type: 'say', agent, text, emotion, ...(to ? { to } : {}) }),
  pong: (t, serverT) => ({ type: 'pong', t, serverT }),
  error: (code, message, extra) => ({ type: 'error', code, message, ...(extra || {}) }),
  peers: (list) => ({ type: 'peers', list }),
  host: (sessionId, reason) => ({ type: 'host', sessionId, ...(reason ? { reason } : {}) }),
  repoint: (host, tick) => ({ type: 'repoint', host, ...(tick !== undefined ? { tick } : {}) }),
  rtc: (from, kind, payload) => ({ type: 'rtc', from, kind, payload }),
};

/** shape check for the outbound side (tests + selftest) */
export function isServerMessage(m) { return isObj(m) && SERVER_TYPES.includes(m.type); }
