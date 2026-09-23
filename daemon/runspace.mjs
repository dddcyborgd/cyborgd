/*! cyborgd — runspace · (c) 2026 BANKON / PYTHAI · MIT · upstream patterns © oncyberio (MIT) */
// Headless: run a space document's SERVER-ONLY components — no DOM, no physics, no renderer.
// Partial port of game-server-v2/src/cyber/ServerSpace (oncyberio, MIT) minus rapier and the scene
// graph: of a cyborg-space/1 `components` map only four types mean anything to the daemon:
//   group   { type:"group", parent? }                       hierarchy (parents for the others)
//   spawn   { type:"spawn", position:[x,y,z], yaw? }        spawn points → the room's spawn ring
//   zones   { type:"zones", zones:[{id,minRole,bounds,portalTo?}] }  gates → room.zones
//   script  { type:"script", source:"…" }                   a server script in a node:vm sandbox with a
//           tiny API: on(event, fn) for join|leave|message|tick, log(...), room.{broadcast,send,players,agents}
// Everything else (gltf, light, audio, …) is left to dvengine in the browser. Scripts run with a
// 50 ms wall-clock limit per callback and see nothing but the API object.
import vm from 'node:vm';

export const SERVER_TYPES = ['group', 'spawn', 'zones', 'script'];
export const SCRIPT_TIMEOUT_MS = 50;

export function serverComponents(doc) {
  const out = { groups: [], spawns: [], zones: [], scripts: [], skipped: [] };
  for (const [id, c] of Object.entries(doc?.components || {})) {
    if (!c || typeof c !== 'object') continue;
    switch (c.type) {
      case 'group': out.groups.push({ id, parent: c.parent || null, name: c.name || id }); break;
      case 'spawn': if (Array.isArray(c.position) && c.position.length === 3) out.spawns.push({ id, parent: c.parent || null, position: c.position.map(Number), yaw: Number(c.yaw) || 0 }); break;
      case 'zones': if (Array.isArray(c.zones)) out.zones.push(...c.zones); break;
      case 'script': if (typeof c.source === 'string') out.scripts.push({ id, parent: c.parent || null, source: c.source, name: c.name || id }); break;
      default: out.skipped.push({ id, type: c.type });
    }
  }
  return out;
}

/** resolve a component's world position through its group parents (groups may carry position) */
export function worldPosition(doc, id) {
  let p = [0, 0, 0], cur = doc.components?.[id], depth = 0;
  while (cur && depth++ < 32) {
    if (Array.isArray(cur.position)) p = [p[0] + Number(cur.position[0]) || 0, p[1] + Number(cur.position[1]) || 0, p[2] + Number(cur.position[2]) || 0];
    cur = cur.parent ? doc.components[cur.parent] : null;
  }
  return p;
}

export class ScriptHost {
  constructor(def, { room = null, log = null } = {}) {
    this.def = def; this.room = room; this.log = log; this.handlers = new Map(); this.error = null; this.calls = 0;
    const api = {
      on: (ev, fn) => { if (typeof fn === 'function') { if (!this.handlers.has(ev)) this.handlers.set(ev, []); this.handlers.get(ev).push(fn); } },
      log: (...a) => this.log?.('[script ' + def.id + ']', ...a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x)))),
      room: room ? { id: room.id, broadcast: (o) => room.broadcast(o), send: (o, sid) => room.send(o, sid), players: () => [...room.players.values()].map((p) => ({ sessionId: p.sessionId, name: p.name, rank: p.rank, p: p.p, zone: p.zone })), agents: () => [...room.agents.keys()] } : null,
      JSON, Math,
    };
    this.ctx = vm.createContext(Object.freeze ? { ...api } : api, { codeGeneration: { strings: false, wasm: false } });
    try { new vm.Script(def.source, { filename: 'script:' + def.id }).runInContext(this.ctx, { timeout: SCRIPT_TIMEOUT_MS }); }
    catch (e) { this.error = String(e.message || e); }
  }
  emit(ev, payload) {
    const hs = this.handlers.get(ev); if (!hs) return 0;
    let n = 0;
    for (const fn of hs) { try { vm.runInContext('(fn, p) => fn(p)', this.ctx, { timeout: SCRIPT_TIMEOUT_MS })(fn, payload); n++; this.calls++; } catch (e) { this.error = String(e.message || e); this.log?.('script ' + this.def.id + ' ' + ev + ':', this.error); } }
    return n;
  }
  get ok() { return !this.error; }
}

/**
 * runSpace(doc, { room, log }) → { zones, spawns, groups, scripts:[{id, ok, error}], skipped, stop() }
 * Applies zones + the first spawn to the room (when given) and wires script handlers to room hooks.
 */
export function runSpace(doc, { room = null, log = null } = {}) {
  const parts = serverComponents(doc);
  const spawns = parts.spawns.map((s) => ({ ...s, position: s.parent ? worldPosition(doc, s.id) : s.position }));
  if (room) {
    if (parts.zones.length) { room.zones = parts.zones; room.def.zones = parts.zones; }
    if (spawns.length) room.def.spawn = spawns[0].position;
  }
  const hosts = parts.scripts.map((s) => new ScriptHost(s, { room, log }));
  const emit = (ev, payload) => { for (const h of hosts) h.emit(ev, payload); };
  let prevHooks = null;
  if (room && hosts.length) {
    prevHooks = room.hooks;
    room.hooks = { ...prevHooks,
      onJoin: (p, r) => { prevHooks.onJoin?.(p, r); emit('join', { sessionId: p.sessionId, name: p.name, rank: p.rank }); },
      onLeave: (p, reason, r) => { prevHooks.onLeave?.(p, reason, r); emit('leave', { sessionId: p.sessionId, reason }); },
      onMessage: (p, m, r) => { prevHooks.onMessage?.(p, m, r); if (m.type === 'msg') emit('message', { from: p.sessionId, data: m.data }); },
      onUpdate: (dt, r) => { prevHooks.onUpdate?.(dt, r); emit('tick', { dt, tick: r.tick }); },
    };
  }
  return { zones: parts.zones, spawns, groups: parts.groups, skipped: parts.skipped, scripts: hosts.map((h) => ({ id: h.def.id, ok: h.ok, error: h.error, handlers: [...h.handlers.keys()] })), emit,
    stop() { if (room && prevHooks) room.hooks = prevHooks; } };
}
