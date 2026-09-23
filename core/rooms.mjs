/*! cyborgd — rooms · (c) 2026 BANKON / PYTHAI · MIT · upstream patterns © oncyberio (MIT) */
// The room core. PURE JS: runs in the browser (a participant HOSTING their own space) and in the
// daemon (the anchor hosting as failover). Upstream shape: oo-game-server-starter GameRoom hooks
// (onJoin/onLeave/onMessage/onUpdate, broadcast/send) + game-server-v2 GameSession semantics
// (tick vs sim rates, snapshot broadcast) — with rungs, zones, aivatars and the authoritative lane.
//
//   const room = createRoom(def, { now, authoritative, riddles, llm, hooks })
//   room.join(transport, identity, hello) → { ok, player } | { ok:false, reason }
//   room.handle(sessionId, rawOrObject)   every inbound message (guarded by core/protocol.mjs)
//   room.update(dt)                       sim + agents (call at simRate)
//   room.tick()                           broadcast a delta snapshot (call at tickRate)
//   room.snapshot(changedOnly)            the world
//   room.broadcast(obj, except[]) · room.send(obj, sid) · room.leave(sid, reason)
// Player: { sessionId, sub, rung, rank, name, avatar, role, p, r, a, s, txt, updatedAt, latency, jitter, invalid, zone, joinedAt, index }
// Zone gating: a state moving a player into a zone whose minRole outranks the player's rung is
// rejected — the player is pushed back to their last accepted position and answered
// error{code:"zone-locked", zone, minRole, p}.
import { parseClient, enc, INVALID_LIMIT, STATE_HZ_MAX, GESTURES } from './protocol.mjs';
import { rankOf, rungName, atLeast } from './ladder.mjs';
import { zoneAt, portalReach, validateZones, v3 } from './zones.mjs';
import { delta, emptySnapshot } from './snapshot.mjs';
import { Authority, SIM_DT } from './sim.mjs';
import { createAgents } from './aivatar.mjs';
import { isTransport } from './transport.mjs';

export const DEFAULTS = Object.freeze({ tickRate: 20, simRate: 60, maxPlayers: 64, minRole: 'participant', spawn: [0, 0, 0], spawnRadius: 2 });

/** EWMA latency + jitter (pure; jitter = smoothed |delta| between consecutive half-RTT samples) */
export class Latency {
  constructor(alpha = 0.2) { this.alpha = alpha; this.latency = 0; this.jitter = 0; this.samples = 0; this._prev = null; }
  sample(rttMs) {
    const half = rttMs / 2;
    if (this.samples === 0) { this.latency = half; this.jitter = 0; }
    else { this.latency += this.alpha * (half - this.latency); this.jitter += this.alpha * (Math.abs(half - this._prev) - this.jitter); }
    this._prev = half; this.samples++;
    return { latency: this.latency, jitter: this.jitter };
  }
}

let _sess = 0;
export function sessionIdFor(transport, seed = '') { return transport?.id ? String(transport.id) : 'p' + (++_sess).toString(36) + seed; }

export class Room {
  constructor(def, { now = () => Date.now(), authoritative = false, riddles = [], categories, llm = null, hooks = {}, log = null, insecure = false, seed } = {}) {
    if (!def || typeof def.id !== 'string') throw new Error('room def needs an id');
    const zoneProblems = validateZones(def.zones || []);
    if (zoneProblems.length) throw new Error('room ' + def.id + ' zones: ' + zoneProblems.join('; '));
    this.def = { ...DEFAULTS, ...def, zones: def.zones || [], agents: def.agents || [] };
    this.id = this.def.id; this.name = this.def.name || this.def.id; this.minRole = this.def.minRole; this.preset = this.def.preset || null; this.tone = this.def.tone || null;
    this.tickRate = this.def.tickRate; this.simRate = this.def.simRate; this.maxPlayers = this.def.maxPlayers; this.zones = this.def.zones;
    this.now = now; this.authoritative = authoritative; this.hooks = hooks; this.log = log; this.insecure = insecure;
    this.players = new Map(); this.sessions = new Map(); this.tick_ = 0; this.simTick = 0; this.lastSnap = null; this.joined = 0; this.createdAt = now();
    const built = createAgents(this.def.agents, { now, riddles, categories, llm, zones: this.zones, seed: seed || this.id });
    this.agents = built.agents; this.riddler = built.riddler;
  }
  get tick() { return this.tick_; }
  get size() { return this.players.size; }

  // ── join / leave ──
  spawnFor(index) {
    const s = this.def.spawn, r = this.def.spawnRadius, a = (index * 2.399963) % (Math.PI * 2);   // golden-angle ring, no randomness
    return [s[0] + Math.cos(a) * r * Math.min(1, index / 8 + 0.25), s[1], s[2] + Math.sin(a) * r * Math.min(1, index / 8 + 0.25)];
  }
  join(transport, identity = {}, hello = {}) {
    if (!isTransport(transport)) throw new Error('join needs a Transport');
    const rung = rankOf(identity.rung ?? 0);
    if (!atLeast(rung, this.minRole)) { transport.send(enc.denied('rung too low', this.minRole, rungName(rung))); return { ok: false, reason: 'rung', minRole: this.minRole }; }
    if (this.players.size >= this.maxPlayers) { transport.send(enc.denied('room full', this.minRole, rungName(rung))); return { ok: false, reason: 'full' }; }
    const sessionId = sessionIdFor(transport);
    if (this.players.has(sessionId)) { transport.send(enc.denied('duplicate session', this.minRole, rungName(rung))); return { ok: false, reason: 'duplicate' }; }
    const index = this.joined++;
    const p = { sessionId, sub: identity.sub || null, rung, rank: rungName(rung), name: (hello.name || identity.name || 'participant').slice(0, 32), avatar: hello.avatar || { kind: 'primitive' }, vrm: hello.vrm || null,
      role: hello.role === 'host' ? 'host' : 'client', p: this.spawnFor(index), r: [0, 0, 0], a: 'idle', s: 1, txt: '', updatedAt: this.now(), latency: 0, jitter: 0, invalid: 0, zone: null, joinedAt: this.now(), index, tick: 0 };
    p.zone = zoneAt(this.zones, p.p)?.id || null;
    const sess = { transport, player: p, latency: new Latency(), lastState: 0, stateCount: 0, stateWindow: this.now(), authority: this.authoritative ? new Authority({ p: p.p, dt: 1 / this.simRate }) : null, unsub: [] };
    this.players.set(sessionId, p); this.sessions.set(sessionId, sess);
    sess.unsub.push(transport.onMessage((m) => this.handle(sessionId, m)));
    sess.unsub.push(transport.onClose((code, reason) => this.leave(sessionId, reason || ('close ' + code))));
    transport.send(enc.welcome({ sessionId, space: this.id, room: { id: this.id, name: this.name, preset: this.preset, tone: this.tone, minRole: this.minRole, skin: this.def.skin || null, theme: this.def.theme || null },
      rung: p.rank, rank: rung, role: p.role, tick: this.tick_, authoritative: this.authoritative, zones: this.zones, spawn: p.p, insecure: this.insecure || undefined,
      snap: this.snapshot(false) }));
    this.broadcast(enc.joined(p), [sessionId]);
    this.hooks.onJoin?.(p, this);
    return { ok: true, player: p, sessionId };
  }
  leave(sessionId, reason = 'left') {
    const sess = this.sessions.get(sessionId); if (!sess) return false;
    for (const u of sess.unsub) try { u(); } catch (e) { /* gone */ }
    this.sessions.delete(sessionId); this.players.delete(sessionId);
    for (const ag of this.agents.values()) if (ag.focus === sessionId) { ag.focus = null; ag.arm = null; }
    this.broadcast(enc.left(sessionId, reason));
    this.hooks.onLeave?.(sess.player, reason, this);
    return true;
  }
  close(reason = 'room closed') { for (const [sid, s] of [...this.sessions]) { this.leave(sid, reason); try { s.transport.close(1001, reason); } catch (e) { /* gone */ } } }

  // ── wire ──
  send(obj, sessionId) { const s = this.sessions.get(sessionId); return s ? s.transport.send(obj) : false; }
  broadcast(obj, except = []) { let n = 0; for (const [sid, s] of this.sessions) if (!except.includes(sid)) { if (s.transport.send(obj)) n++; } return n; }
  strike(sessionId, code, message, extra) {
    const s = this.sessions.get(sessionId); if (!s) return;
    s.player.invalid++;
    s.transport.send(enc.error(code, message, extra));
    if (s.player.invalid >= INVALID_LIMIT) { this.leave(sessionId, 'too many invalid messages'); try { s.transport.close(1008, 'invalid'); } catch (e) { /* gone */ } }
  }
  handle(sessionId, raw) {
    const s = this.sessions.get(sessionId); if (!s) return { ok: false, code: 'no-session' };
    const r = parseClient(raw);
    if (!r.ok) { this.strike(sessionId, r.code, r.message); return r; }
    const m = r.msg, p = s.player, t = this.now();
    switch (m.type) {
      case 'hello': this.strike(sessionId, 'invalid', 'already joined'); break;
      case 'ping': s.transport.send(enc.pong(m.t, t)); if (t - m.t >= 0 && t - m.t < 60_000) { const l = s.latency.sample(t - m.t); p.latency = Math.round(l.latency); p.jitter = Math.round(l.jitter); } break;
      case 'state': return this.onState(s, m, t);
      case 'cmd': return this.onCmd(s, m);
      case 'msg': return this.onMsg(s, m);
      case 'event': return this.onEvent(s, m);
      case 'rtc': case 'mirror': case 'lost': this.hooks.onRelay?.(sessionId, m, this); return { ok: true, relayed: true };   // the anchor's, not the room's
    }
    this.hooks.onMessage?.(p, m, this);
    return { ok: true };
  }
  onState(s, m, t) {
    const p = s.player;
    if (this.authoritative) { this.strike(p.sessionId, 'invalid', 'state is ignored on an authoritative room; send cmd'); return { ok: false, code: 'authoritative' }; }
    if (t - s.stateWindow >= 1000) { s.stateWindow = t; s.stateCount = 0; }
    if (++s.stateCount > STATE_HZ_MAX * 2) return { ok: false, code: 'rate' };            // silently dropped: the wire is the limit, not the player
    const z = zoneAt(this.zones, m.p);
    if (z && !atLeast(p.rung, z.minRole)) {
      this.strike(p.sessionId, 'zone-locked', 'zone ' + z.id + ' requires ' + z.minRole, { zone: z.id, minRole: z.minRole, p: p.p });
      return { ok: false, code: 'zone-locked', zone: z.id };
    }
    p.p = m.p; p.r = m.r; p.a = m.a; p.s = m.s; if (m.txt !== undefined) p.txt = m.txt; p.updatedAt = t; p.tick = this.tick_;
    const prevZone = p.zone; p.zone = z?.id || null;
    if (p.zone !== prevZone) this.hooks.onZone?.(p, p.zone, prevZone, this);
    const portal = portalReach(this.zones, p.p);
    if (portal && s.lastPortal !== portal.zone) { s.lastPortal = portal.zone; s.transport.send(enc.msg('room', { portal: portal.zone, to: portal.to })); this.hooks.onPortal?.(p, portal, this); }
    else if (!portal) s.lastPortal = null;
    this.hooks.onMessage?.(p, m, this);
    return { ok: true };
  }
  onCmd(s, m) {
    if (!s.authority) { this.strike(s.player.sessionId, 'invalid', 'cmd needs an authoritative room; send state'); return { ok: false, code: 'not-authoritative' }; }
    const res = s.authority.feed(m);
    if (res === 'stale') return { ok: false, code: 'stale' };
    this.hooks.onMessage?.(s.player, m, this);
    return { ok: true, queued: res === 'queued' };
  }
  onMsg(s, m) {
    const p = s.player;
    if (m.to && this.agents.has(m.to)) {
      const ag = this.agents.get(m.to), text = typeof m.data === 'string' ? m.data : m.data?.text;
      const day = new Date(this.now()).toISOString().slice(0, 10);
      const pr = ag.onMsg(p, text, { day }).then((effects) => this.applyEffects(effects, ag, p)).catch((e) => this.log?.('aivatar msg error', e?.message || e));
      this.hooks.onMessage?.(p, m, this);
      return { ok: true, pending: pr };
    }
    if (m.to) { if (!this.sessions.has(m.to)) { this.strike(p.sessionId, 'invalid', 'unknown recipient'); return { ok: false, code: 'unknown-to' }; } this.send(enc.msg(p.sessionId, m.data, m.to), m.to); }
    else this.broadcast(enc.msg(p.sessionId, m.data), [p.sessionId]);
    this.hooks.onMessage?.(p, m, this);
    return { ok: true };
  }
  onEvent(s, m) {
    const p = s.player, effects = [];
    if (m.name === 'portal') {
      const z = this.zones.find((x) => x.id === m.data.to) || this.zones.find((x) => x.portalTo === m.data.to);
      if (!z) { this.strike(p.sessionId, 'invalid', 'unknown portal'); return { ok: false, code: 'unknown-portal' }; }
      if (!atLeast(p.rung, z.minRole)) { this.strike(p.sessionId, 'zone-locked', 'portal to ' + z.id + ' requires ' + z.minRole, { zone: z.id, minRole: z.minRole, p: p.p }); return { ok: false, code: 'zone-locked' }; }
    }
    for (const ag of this.agents.values()) effects.push(...ag.onEvent(p, m));
    this.applyEffects(effects, null, p);
    this.hooks.onMessage?.(p, m, this);
    return { ok: true, effects };
  }
  applyEffects(effects, agent, player) {
    for (const e of effects || []) {
      if (e.type === 'say') { if (e.to) this.send(enc.say(e.agent, e.text, e.emotion, e.to), e.to); else this.broadcast(enc.say(e.agent, e.text, e.emotion)); }
      else if (e.type === 'voucher') this.hooks.onVoucher?.(e, player, this);
      this.hooks.onEffect?.(e, player, this);
    }
    return effects;
  }

  // ── time ──
  /** one sim step: agents move, authorities advance + ack */
  update(dt = SIM_DT) {
    this.simTick++;
    const effects = [];
    for (const ag of this.agents.values()) effects.push(...ag.update(dt, this.players));
    this.applyEffects(effects, null, null);
    if (this.authoritative) for (const [sid, s] of this.sessions) {
      const ack = s.authority.update();
      const p = s.player; p.p = ack.checkpoint.p; p.a = s.authority.state.moving ? (s.authority.state.sprint ? 'run' : 'walk') : (s.authority.state.grounded ? 'idle' : 'jump');
      p.r = [0, s.authority.state.yaw, 0]; p.updatedAt = this.now(); p.tick = ack.tick;
      const z = zoneAt(this.zones, p.p);
      if (z && !atLeast(p.rung, z.minRole)) { s.authority.teleport(s.lastGood || this.spawnFor(p.index)); p.p = s.authority.state.p; s.transport.send(enc.error('zone-locked', 'zone ' + z.id + ' requires ' + z.minRole, { zone: z.id, minRole: z.minRole, p: p.p })); }
      else s.lastGood = p.p;
      p.zone = zoneAt(this.zones, p.p)?.id || null;
      s.transport.send(enc.ack(ack.tick, ack.seq, ack.checkpoint));
    }
    this.hooks.onUpdate?.(dt, this);
    return effects;
  }
  /** one network tick: broadcast the delta snapshot */
  tick() {
    this.tick_++;
    const snap = this.snapshot(false), d = delta(this.lastSnap, snap);
    this.lastSnap = snap;
    const wire = enc.snap(d.tick, d.ts, d.players, d.agents, d.full);
    if (d.playersGone) wire.playersGone = d.playersGone; if (d.agentsGone) wire.agentsGone = d.agentsGone;
    this.broadcast(wire);
    return wire;
  }
  /** apply a snapshot from elsewhere (an anchor seeding a new host, a host restoring after repoint) */
  restore(snap) { if (!snap) return; for (const [id, a] of Object.entries(snap.agents || {})) { const ag = this.agents.get(id); if (ag) { ag.p = [...a.p]; ag.r = [...a.r]; ag.a = a.a; } } this.tick_ = Math.max(this.tick_, snap.tick || 0); }
  snapshot(changedOnly = false) {
    const players = {}, agents = {};
    for (const p of this.players.values()) players[p.sessionId] = { p: p.p, r: p.r, a: p.a, s: p.s, txt: p.txt, name: p.name, rank: p.rank, role: p.role, zone: p.zone, tick: p.tick, updatedAt: p.updatedAt, latency: p.latency, jitter: p.jitter, ...(p.avatar ? { avatar: p.avatar } : {}) };
    for (const ag of this.agents.values()) agents[ag.id] = ag.snapshot();
    const snap = { ...emptySnapshot(this.tick_, this.now()), players, agents };
    return changedOnly ? delta(this.lastSnap, snap) : snap;
  }
  stats() { return { id: this.id, name: this.name, minRole: this.minRole, preset: this.preset, tone: this.tone, players: this.players.size, agents: this.agents.size, tick: this.tick_, authoritative: this.authoritative, maxPlayers: this.maxPlayers, zones: this.zones.map((z) => ({ id: z.id, minRole: z.minRole, portalTo: z.portalTo || null })) }; }
}

export function createRoom(def, opts = {}) { return new Room(def, opts); }
export { GESTURES, v3 };
