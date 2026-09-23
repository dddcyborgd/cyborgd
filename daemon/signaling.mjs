/*! cyborgd — signaling · (c) 2026 BANKON / PYTHAI · MIT · upstream patterns © oncyberio (MIT) */
// The anchor's socket layer: every WebSocket becomes a Transport (core/transport.mjs interface) and
// is placed in a space by its `hello`. From there the room core (core/rooms.mjs) sees ordinary
// messages, and the three triad messages are handed to the pure state machine (core/triad.mjs):
//   rtc{to,kind,payload}   relayed ONLY between sessions in the same space — payload never inspected
//   mirror{tick,snap}      accepted from the elected host only; merged last-writer-wins by tick
//   lost{host}             a client whose host vanished → repoint{host}
// On every join/leave the anchor sends peers{list:[{sessionId,role,rung}]}, on election host{sessionId}.
// The anchor is also the FAILOVER host: when no peer can host, its own Room runs the space.
import { BaseTransport } from '../core/transport.mjs';
import { Triad, ANCHOR } from '../core/triad.mjs';
import { Room } from '../core/rooms.mjs';
import { parseClient, enc, VERSION } from '../core/protocol.mjs';
import { identify } from './claim.mjs';
import { roomDefOf, validateSpaceDoc } from './spaces.mjs';

/** WsSocket → Transport */
export class WsTransport extends BaseTransport {
  constructor(ws) {
    super(ws.id, { remoteAddress: ws.remoteAddress });
    this.ws = ws;
    ws.on('message', (data, isBinary) => { if (isBinary) { this._deliver({ type: '__binary__' }); return; } let m; try { m = JSON.parse(data); } catch (e) { m = String(data); } this._deliver(m); });
    ws.on('close', (code, reason) => this._closed(code, reason));
    ws.on('error', () => {});
  }
  send(obj) { return this.open ? this.ws.send(obj) : false; }
  close(code = 1000, reason = '') { if (!this.open) return; this._closed(code, reason); this.ws.close(code, reason); }
}

export class Anchor {
  constructor({ rooms = new Map(), registry = [], spaces = null, state = null, issuer = null, faucet = null, riddles = [], llm = null, authoritative = false, now = Date.now, log = null } = {}) {
    this.rooms = rooms; this.registry = registry; this.spaces = spaces; this.state = state; this.issuer = issuer; this.faucet = faucet; this.riddles = riddles; this.llm = llm; this.authoritative = authoritative; this.now = now; this.log = log;
    this.triad = new Triad({ now }); this.transports = new Map(); this.pending = new Set(); this.connections = 0;
  }
  get insecure() { return !this.issuer; }
  roomHooks() {
    return {
      onRelay: (sid, m, room) => this.onRelay(sid, m, room),
      onJoin: (p, room) => { this.state?.rooms.append({ kind: 'join', space: room.id, sid: p.sessionId, sub: p.sub, rung: p.rung, name: p.name }); },
      onLeave: (p, reason, room) => { this.state?.rooms.append({ kind: 'leave', space: room.id, sid: p.sessionId, reason }); this.deliver(this.triad.step({ type: 'leave', space: room.id, sid: p.sessionId })); if (room.size === 0 && room.def.dynamic) { this.rooms.delete(room.id); this.deliver(this.triad.step({ type: 'reset', space: room.id })); } },
      onVoucher: (e, player, room) => this.onVoucher(e, player, room),
    };
  }
  makeRoom(def, extra = {}) {
    const room = new Room(def, { now: this.now, authoritative: this.authoritative, riddles: this.riddles, llm: this.llm, hooks: this.roomHooks(), log: this.log, insecure: this.insecure, ...extra });
    this.rooms.set(room.id, room);
    return room;
  }
  /** registry rooms first; then stored / on-chain space docs; then a dynamic rendezvous room */
  async roomFor(spaceId) {
    if (this.rooms.has(spaceId)) return this.rooms.get(spaceId);
    const reg = this.registry.find((r) => r.id === spaceId);
    if (reg) return this.makeRoom(reg);
    const found = this.spaces ? await this.spaces.get(spaceId) : null;
    if (found && validateSpaceDoc(found.doc).length === 0) return this.makeRoom({ ...roomDefOf(found.doc), source: found.source, dynamic: true });
    return this.makeRoom({ id: spaceId, name: spaceId, minRole: 'participant', preset: 'RENDEZVOUS', tone: 'open', zones: [], agents: [], dynamic: true });
  }
  onConnection(ws) {
    const t = new WsTransport(ws);
    this.connections++;
    this.pending.add(t);
    const timer = setTimeout(() => { if (this.pending.has(t)) { t.send(enc.error('hello-timeout', 'send hello within 10 s')); t.close(1008, 'hello timeout'); } }, 10_000); timer.unref?.();
    const un = t.onMessage((m) => { un(); clearTimeout(timer); this.onHello(t, m).catch((e) => { this.log?.('hello failed', e?.stack || e); t.send(enc.error('internal', 'join failed')); t.close(1011, 'join failed'); }); });
    t.onClose(() => { this.pending.delete(t); this.transports.delete(t.id); clearTimeout(timer); });
    return t;
  }
  async onHello(t, m) {
    this.pending.delete(t);
    const r = parseClient(m);
    if (!r.ok || r.msg.type !== 'hello') { t.send(enc.error(r.ok ? 'expected-hello' : r.code, r.ok ? 'first message must be hello' : r.message, { v: VERSION })); t.close(1008, 'hello'); return; }
    const hello = r.msg;
    let id;
    try { id = identify(hello.claim, this.issuer); } catch (e) { t.send(enc.denied('claim: ' + (e.message || e))); t.close(1008, 'claim'); return; }
    const room = await this.roomFor(hello.space);
    const res = room.join(t, id, hello);
    if (!res.ok) { t.close(1008, res.reason); return; }
    this.transports.set(t.id, { t, space: room.id, sid: res.sessionId, id });
    const owner = !!(hello.owner && id.sub && room.def.owner && String(room.def.owner).toLowerCase() === String(id.sub).toLowerCase());
    this.deliver(this.triad.step({ type: 'join', space: room.id, sid: res.sessionId, rung: id.rung, owner, sub: id.sub }));
  }
  onRelay(sid, m, room) {
    const ev = { space: room.id, sid };
    if (m.type === 'rtc') Object.assign(ev, { type: 'rtc', to: m.to, kind: m.kind, payload: m.payload });
    else if (m.type === 'mirror') Object.assign(ev, { type: 'mirror', tick: m.tick, snap: m.snap });
    else if (m.type === 'lost') Object.assign(ev, { type: 'lost', host: m.host });
    else return;
    this.deliver(this.triad.step(ev));
  }
  deliver(effects) {
    for (const e of effects || []) {
      if (e.to === ANCHOR) continue;
      const room = this.rooms.get(e.space);
      if (room && room.sessions.has(e.to)) room.send(e.msg, e.to);
      else { const tr = this.transports.get(e.to); tr?.t.send(e.msg); }
    }
    return effects;
  }
  async onVoucher(e, player, room) {
    if (!this.faucet) { room.send(enc.error('no-faucet', 'the faucet is not configured on this anchor'), e.to.sessionId); return; }
    try {
      const out = await this.faucet.dripForEffect({ token: e.token, address: player.sub, sub: player.sub, rung: player.rung, agent: e.agent, riddle: e.riddle, sessionId: player.sessionId });
      room.send(enc.voucher({ ...out.voucher, agent: e.agent, riddle: e.riddle }), player.sessionId);
      this.state?.rooms.append({ kind: 'voucher', space: room.id, sid: player.sessionId, sub: player.sub, token: e.token, agent: e.agent, riddle: e.riddle, nonce: out.voucher.nonce });
    } catch (err) { room.send(enc.error(err.code || 'faucet', err.message || String(err), err.extra), player.sessionId); }
  }
  /** GET /triad */
  summary() {
    const s = this.triad.summary();
    return { ...s, list: s.list.map((sp) => ({ ...sp, room: this.rooms.get(sp.id)?.stats() || null })) };
  }
  stats() { const s = this.triad.summary(); let players = 0; for (const r of this.rooms.values()) players += r.size; return { rooms: this.rooms.size, players, connections: this.transports.size, triad: { spaces: s.spaces, hosted: s.hosted, anchored: s.anchored } }; }
}
