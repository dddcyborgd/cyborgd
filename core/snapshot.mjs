/*! cyborgd — snapshot · (c) 2026 BANKON / PYTHAI · MIT · upstream patterns © oncyberio (MIT) */
// Snapshots: the room's world at a tick — { tick, ts, players:{sid:{p,r,a,s,txt?,updatedAt}}, agents:{id:{p,r,a,arm?,say?}} }.
// PURE JS. Three tools:
//   delta(prev, next)         → only the entities that changed since prev (+ `gone` lists) — the wire form
//   apply(base, deltaSnap)    → the reconstructed full snapshot (a late joiner or a mirror consumer)
//   mergeLWW(base, incoming)  → last-writer-wins BY TICK per entity: the anchor's rule for mirrors
// and a SnapshotBuffer, the server-side port of awe examples/multiplayer/shared/snapshot-interpolation.ts
// (push ignores out-of-order times, same time replaces, sample() brackets renderTime, holds the last
// state when renderTime runs past the buffer).
const ENTITY_FIELDS = ['p', 'r', 'a', 's', 'txt', 'arm', 'say', 'v', 'grounded', 'tick', 'updatedAt', 'zone', 'name', 'rank', 'rung', 'role', 'kind', 'type', 'seq', 'field', 'arm'];

function sameVal(a, b) {
  if (a && b && typeof a === 'object' && !Array.isArray(a) && typeof b === 'object' && !Array.isArray(b)) return JSON.stringify(a) === JSON.stringify(b); // nested objects (field, arm)
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => sameVal(x, b[i]));
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => sameVal(a[k], b[k]));
  }
  return false;
}
export function sameEntity(a, b) {
  if (!a || !b) return a === b;
  for (const k of ENTITY_FIELDS) if (!sameVal(a[k], b[k])) return false;
  return true;
}
const copy = (o) => JSON.parse(JSON.stringify(o));

export function emptySnapshot(tick = 0, ts = 0) { return { tick, ts, players: {}, agents: {} }; }

/** wire delta: entities that changed (or are new) + gone lists; `full:true` when prev is null */
export function delta(prev, next) {
  if (!prev) return { ...copy(next), full: true };
  const out = { tick: next.tick, ts: next.ts, players: {}, agents: {} };
  for (const lane of ['players', 'agents']) {
    const a = prev[lane] || {}, b = next[lane] || {};
    for (const id of Object.keys(b)) if (!sameEntity(a[id], b[id])) out[lane][id] = copy(b[id]);
    const gone = Object.keys(a).filter((id) => !(id in b));
    if (gone.length) out[lane + 'Gone'] = gone;
  }
  return out;
}

/** reconstruct: apply a delta (or a full snapshot) on top of base */
export function apply(base, d) {
  if (!d) return base ? copy(base) : emptySnapshot();
  if (d.full || !base) { const { full, playersGone, agentsGone, ...rest } = d; return { players: {}, agents: {}, ...copy(rest) }; }
  const out = { ...copy(base), tick: d.tick ?? base.tick, ts: d.ts ?? base.ts };
  for (const lane of ['players', 'agents']) {
    out[lane] = out[lane] || {};
    for (const [id, e] of Object.entries(d[lane] || {})) out[lane][id] = copy(e);
    for (const id of d[lane + 'Gone'] || []) delete out[lane][id];
  }
  return out;
}

/**
 * Last-writer-wins by tick. Per entity the higher `tick` wins (an entity without a tick inherits its
 * snapshot's tick); equal ticks → incoming wins (it is the later arrival). The result's tick is the
 * max of both. `gone` lists in the incoming are honoured only when its tick ≥ the base entity's tick.
 */
export function mergeLWW(base, incoming) {
  if (!base) return apply(null, incoming);
  if (!incoming) return copy(base);
  const out = { ...copy(base), tick: Math.max(base.tick || 0, incoming.tick || 0), ts: Math.max(base.ts || 0, incoming.ts || 0) };
  const tickOf = (e, snapTick) => (e && typeof e.tick === 'number' ? e.tick : snapTick || 0);
  for (const lane of ['players', 'agents']) {
    out[lane] = out[lane] || {};
    for (const [id, e] of Object.entries(incoming[lane] || {})) {
      const cur = out[lane][id];
      if (!cur || tickOf(e, incoming.tick) >= tickOf(cur, base.tick)) out[lane][id] = copy(e);
    }
    for (const id of incoming[lane + 'Gone'] || []) {
      const cur = out[lane][id];
      if (cur && (incoming.tick || 0) >= tickOf(cur, base.tick)) delete out[lane][id];
    }
  }
  return out;
}

/** the interpolation buffer (port of SnapshotBuffer<T>) */
export class SnapshotBuffer {
  constructor(maxSize = 60) { this.buffer = []; this.maxSize = maxSize; }
  push(state, serverTime) {
    const last = this.buffer[this.buffer.length - 1];
    if (last) {
      if (serverTime < last.time) return false;
      if (serverTime === last.time) { last.state = state; return true; }
    }
    this.buffer.push({ time: serverTime, state });
    if (this.buffer.length > this.maxSize) this.buffer.shift();
    return true;
  }
  sample(renderTime) {
    const buf = this.buffer;
    if (buf.length === 0) return null;
    for (let i = buf.length - 2; i >= 0; i--) {
      if (buf[i].time <= renderTime && renderTime < buf[i + 1].time) {
        const prev = buf[i], next = buf[i + 1], span = next.time - prev.time;
        const t = span > 0 ? (renderTime - prev.time) / span : 1;
        if (i > 0) this.buffer.splice(0, i);
        return { prev, next, t };
      }
    }
    if (renderTime >= buf[buf.length - 1].time) { const last = buf[buf.length - 1]; return { prev: last, next: last, t: 1 }; }
    return null;
  }
  latestPair() { return this.buffer.length < 2 ? null : { prev: this.buffer[this.buffer.length - 2], next: this.buffer[this.buffer.length - 1] }; }
  latest() { return this.buffer.length ? this.buffer[this.buffer.length - 1] : null; }
  clear() { this.buffer = []; }
  get length() { return this.buffer.length; }
}

/** lerp two entity states (p linear, r linear per axis, the rest from next) — the client's per-frame blend */
export function lerpEntity(a, b, t) {
  if (!a) return b; if (!b) return a;
  const L = (x, y) => x + (y - x) * t;
  return { ...b, p: a.p && b.p ? a.p.map((x, i) => L(x, b.p[i])) : b.p, r: a.r && b.r ? a.r.map((x, i) => L(x, b.r[i])) : b.r };
}
