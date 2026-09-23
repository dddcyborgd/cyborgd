/*! cyborgd — triad · (c) 2026 BANKON / PYTHAI · MIT · upstream patterns © oncyberio (MIT) */
// THE TRIAD: participant ⟷ DeltaVerse ⟷ participant. Every participant is BOTH a client and a
// server. Per space there are three roles:
//   client  a participant in someone's space
//   host    a participant serving their own space — the room core runs IN THEIR BROWSER, peers
//           connect over RTCDataChannel
//   anchor  this daemon: rendezvous + identity + faucet + the canonical snapshot + FAILOVER host
// Rules (pure, all here): the space token owner, else the first participant with rung ≥ member, is
// elected host; the anchor keeps the canonical snapshot and re-elects on disconnect (deterministic:
// owner, then highest rank, then earliest join, then session id); hosts stream `snap` to peers AND
// `mirror{tick,snap}` to the anchor; the anchor applies last-writer-wins by tick and serves late
// joiners from it; a client that loses its host sends `lost` and gets `repoint{host}`.
//
//   triadStep(state, event) → { state, effects[] }      effects = [{ to:sessionId|'*', space, msg }]
// events: join{space,sid,rung,owner?,t} · leave{space,sid,t} · mirror{space,sid,tick,snap} ·
//         lost{space,sid,host?} · rtc{space,sid,to,kind,payload} · snapshot{space,sid} · reset{space}
import { rankOf, HOST_MIN_RUNG } from './ladder.mjs';
import { mergeLWW, emptySnapshot } from './snapshot.mjs';
import { enc } from './protocol.mjs';

export const ANCHOR = 'anchor';

export function emptyTriad() { return { spaces: {} }; }
export function emptySpace(id, t = 0) { return { id, host: ANCHOR, hostSince: t, peers: {}, tick: 0, snap: emptySnapshot(0, t), mirrors: 0, elections: 0 }; }

export function canHost(peer) { return !!peer && rankOf(peer.rung) >= rankOf(HOST_MIN_RUNG); }

/** deterministic election: owner → highest rank → earliest join → sid; null when nobody can host (the anchor does) */
export function elect(space) {
  const c = Object.values(space.peers).filter(canHost);
  if (!c.length) return null;
  c.sort((a, b) => (b.owner ? 1 : 0) - (a.owner ? 1 : 0) || rankOf(b.rung) - rankOf(a.rung) || a.joinedAt - b.joinedAt || (a.sid < b.sid ? -1 : a.sid > b.sid ? 1 : 0));
  return c[0].sid;
}

export function roster(space) {
  return Object.values(space.peers).sort((a, b) => a.joinedAt - b.joinedAt || (a.sid < b.sid ? -1 : 1))
    .map((p) => ({ sessionId: p.sid, role: p.sid === space.host ? 'host' : 'client', rung: p.rung, rank: rankOf(p.rung), ...(p.owner ? { owner: true } : {}) }));
}
export function roleOf(space, sid) { return sid === ANCHOR ? 'anchor' : space.host === sid ? 'host' : 'client'; }

const cloneSpace = (s) => ({ ...s, peers: { ...s.peers } });

/** the pure step */
export function triadStep(state, ev) {
  const effects = [];
  const next = { spaces: { ...state.spaces } };
  const t = ev.t ?? 0;
  const spaceId = ev.space;
  if (!spaceId) return { state, effects: [{ to: ev.sid, space: null, msg: enc.error('invalid', 'triad event without space') }] };
  let space = cloneSpace(next.spaces[spaceId] || emptySpace(spaceId, t));
  next.spaces[spaceId] = space;
  const all = (msg) => { for (const sid of Object.keys(space.peers)) effects.push({ to: sid, space: spaceId, msg }); };
  const reelect = (reason) => {
    const winner = elect(space) || ANCHOR;
    const changed = winner !== space.host;
    space.host = winner; space.hostSince = t; space.elections++;
    if (changed) { all(enc.host(winner, reason)); for (const sid of Object.keys(space.peers)) if (sid !== winner) effects.push({ to: sid, space: spaceId, msg: enc.repoint(winner, space.tick) }); }
    return changed;
  };

  switch (ev.type) {
    case 'join': {
      if (!ev.sid) break;
      space.peers[ev.sid] = { sid: ev.sid, rung: rankOf(ev.rung ?? 0), owner: !!ev.owner, joinedAt: t, sub: ev.sub || null };
      const hostAlive = space.host !== ANCHOR && !!space.peers[space.host];
      // the owner takes the host on arrival; otherwise the anchor yields to the first eligible peer; an existing peer host keeps it
      // the joiner is ALWAYS told who hosts (a re-election that changed nothing still answers the newcomer)
      if (!((ev.owner || !hostAlive) && reelect(ev.owner ? 'owner' : 'first-eligible'))) effects.push({ to: ev.sid, space: spaceId, msg: enc.host(space.host) });
      // the late joiner is served from the anchor's canonical snapshot
      effects.push({ to: ev.sid, space: spaceId, msg: { ...enc.snap(space.snap.tick, space.snap.ts, space.snap.players || {}, space.snap.agents || {}, true), anchor: true } });
      all(enc.peers(roster(space)));
      break;
    }
    case 'leave': {
      if (!space.peers[ev.sid]) break;
      delete space.peers[ev.sid];
      if (space.snap.players && space.snap.players[ev.sid]) { space.snap = { ...space.snap, players: { ...space.snap.players } }; delete space.snap.players[ev.sid]; }
      if (space.host === ev.sid) reelect('host-left');
      if (Object.keys(space.peers).length === 0) { space.host = ANCHOR; space.hostSince = t; }
      else all(enc.peers(roster(space)));
      break;
    }
    case 'mirror': {
      if (ev.sid !== space.host) { effects.push({ to: ev.sid, space: spaceId, msg: enc.error('not-host', 'only the elected host mirrors', { host: space.host }) }); break; }
      const incoming = { tick: ev.tick, ts: t, players: ev.snap.players || {}, agents: ev.snap.agents || {}, ...(ev.snap.playersGone ? { playersGone: ev.snap.playersGone } : {}), ...(ev.snap.agentsGone ? { agentsGone: ev.snap.agentsGone } : {}) };
      const merged = mergeLWW(space.snap, incoming);
      space.snap = merged; space.tick = Math.max(space.tick, merged.tick); space.mirrors++;
      break;
    }
    case 'lost': {
      if (!space.peers[ev.sid]) { effects.push({ to: ev.sid, space: spaceId, msg: enc.error('not-in-space', 'join first') }); break; }
      const hostAlive = space.host !== ANCHOR && !!space.peers[space.host];
      if (!hostAlive || (ev.host && ev.host === space.host && space.host !== ev.sid && ev.force)) reelect('host-lost');
      effects.push({ to: ev.sid, space: spaceId, msg: enc.repoint(space.host, space.tick) });
      break;
    }
    case 'rtc': {
      if (!space.peers[ev.sid]) { effects.push({ to: ev.sid, space: spaceId, msg: enc.error('not-in-space', 'join first') }); break; }
      if (ev.to === ev.sid || !space.peers[ev.to]) { effects.push({ to: ev.sid, space: spaceId, msg: enc.error('no-peer', 'rtc target is not in this space', { to: ev.to }) }); break; }
      effects.push({ to: ev.to, space: spaceId, msg: enc.rtc(ev.sid, ev.kind, ev.payload) });
      break;
    }
    case 'snapshot': {
      effects.push({ to: ev.sid, space: spaceId, msg: { ...enc.snap(space.snap.tick, space.snap.ts, space.snap.players || {}, space.snap.agents || {}, true), anchor: true } });
      break;
    }
    case 'reset': { next.spaces[spaceId] = emptySpace(spaceId, t); break; }
    default: effects.push({ to: ev.sid, space: spaceId, msg: enc.error('unknown-type', 'triad: ' + ev.type) });
  }
  return { state: next, effects };
}

/** a stateful convenience around the pure step (the daemon uses it; tests use both) */
export class Triad {
  constructor({ now = () => 0 } = {}) { this.state = emptyTriad(); this.now = now; }
  step(ev) { const r = triadStep(this.state, { t: this.now(), ...ev }); this.state = r.state; return r.effects; }
  space(id) { return this.state.spaces[id] || null; }
  hostOf(id) { return this.space(id)?.host || ANCHOR; }
  roleOf(id, sid) { const s = this.space(id); return s ? roleOf(s, sid) : 'client'; }
  summary() {
    const spaces = Object.values(this.state.spaces).map((s) => ({ id: s.id, host: s.host, hostRole: s.host === ANCHOR ? 'anchor' : 'peer', peers: roster(s), tick: s.tick, mirrors: s.mirrors, elections: s.elections, hostSince: s.hostSince }));
    return { spaces: spaces.length, hosted: spaces.filter((s) => s.hostRole === 'peer').length, anchored: spaces.filter((s) => s.hostRole === 'anchor').length, list: spaces };
  }
}
