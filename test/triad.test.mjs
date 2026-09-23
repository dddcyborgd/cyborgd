/*! cyborgd — test triad · (c) 2026 BANKON / PYTHAI · MIT · upstream patterns © oncyberio (MIT) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { triadStep, emptyTriad, elect, ANCHOR, Triad } from '../core/triad.mjs';

const run = (evs, s = emptyTriad()) => { const all = []; for (const ev of evs) { const r = triadStep(s, ev); s = r.state; all.push(...r.effects); } return { state: s, effects: all }; };
const to = (effects, sid, type) => effects.filter((e) => e.to === sid && e.msg.type === type).map((e) => e.msg);

test('election: owner → highest rank → earliest join → sid; nobody eligible → the anchor hosts', () => {
  const { state } = run([{ type: 'join', space: 's', sid: 'p0', rung: 0, t: 1 }]);
  assert.equal(state.spaces.s.host, ANCHOR, 'a participant (rung 0) cannot host');
  const a = run([{ type: 'join', space: 's', sid: 'b', rung: 2, t: 1 }, { type: 'join', space: 's', sid: 'a', rung: 5, t: 2 }]);
  assert.equal(a.state.spaces.s.host, 'b', 'the first eligible peer keeps the host; a later higher rank does not steal it');
  assert.equal(elect(a.state.spaces.s), 'a', 'but a fresh election prefers the highest rank');
  const o = run([{ type: 'join', space: 's', sid: 'x', rung: 7, t: 1 }, { type: 'join', space: 's', sid: 'own', rung: 2, owner: true, t: 2 }]);
  assert.equal(o.state.spaces.s.host, 'own', 'the owner takes the host on arrival');
  assert.deepEqual(to(o.effects, 'x', 'host').map((m) => m.sessionId), ['x', 'own']);
  const tie = run([{ type: 'join', space: 's', sid: 'q', rung: 0, t: 1 }, { type: 'join', space: 's', sid: 'p', rung: 0, t: 1 }]);
  tie.state.spaces.s.peers.q.rung = 3; tie.state.spaces.s.peers.p.rung = 3;
  assert.equal(elect(tie.state.spaces.s), 'p', 'same rank, same join time → the lower sid');
});

test('failover + repoint: the host leaves → re-election, host{} to all, repoint{} to every non-winner; lost{} answers repoint', () => {
  const r = run([{ type: 'join', space: 's', sid: 'h', rung: 3, t: 1 }, { type: 'join', space: 's', sid: 'c1', rung: 2, t: 2 }, { type: 'join', space: 's', sid: 'c2', rung: 0, t: 3 }]);
  assert.equal(r.state.spaces.s.host, 'h');
  assert.equal(to(r.effects, 'c1', 'host')[0].sessionId, 'h', 'a late joiner is told who hosts');
  const f = triadStep(r.state, { type: 'leave', space: 's', sid: 'h', t: 4 });
  assert.equal(f.state.spaces.s.host, 'c1'); assert.equal(f.state.spaces.s.elections, 2);
  assert.equal(to(f.effects, 'c2', 'host')[0].reason, 'host-left');
  assert.deepEqual(to(f.effects, 'c2', 'repoint').map((m) => m.host), ['c1']); assert.equal(to(f.effects, 'c1', 'repoint').length, 0, 'the winner is not repointed');
  const l = triadStep(f.state, { type: 'lost', space: 's', sid: 'c2', host: 'h', t: 5 });
  assert.deepEqual(to(l.effects, 'c2', 'repoint')[0], { type: 'repoint', host: 'c1', tick: 0 });
  const g = triadStep(l.state, { type: 'leave', space: 's', sid: 'c1', t: 6 });
  assert.equal(g.state.spaces.s.host, ANCHOR, 'no eligible peer left → the anchor hosts'); assert.equal(to(g.effects, 'c2', 'repoint')[0].host, ANCHOR);
  assert.equal(triadStep(g.state, { type: 'leave', space: 's', sid: 'c2', t: 7 }).state.spaces.s.host, ANCHOR);
});

test('mirror: only the host may; last-writer-wins BY TICK per entity; a late joiner is served the merged snapshot', () => {
  const j = run([{ type: 'join', space: 's', sid: 'h', rung: 2, t: 1 }, { type: 'join', space: 's', sid: 'c', rung: 0, t: 2 }]);
  const bad = triadStep(j.state, { type: 'mirror', space: 's', sid: 'c', tick: 5, snap: { players: {} }, t: 3 });
  assert.equal(to(bad.effects, 'c', 'error')[0].code, 'not-host'); assert.equal(bad.state.spaces.s.mirrors, 0);
  const m1 = triadStep(j.state, { type: 'mirror', space: 's', sid: 'h', tick: 10, snap: { players: { h: { p: [1, 0, 0], tick: 10 }, c: { p: [0, 0, 1], tick: 10 } }, agents: { bot: { p: [5, 0, 5] } } }, t: 4 });
  const m2 = triadStep(m1.state, { type: 'mirror', space: 's', sid: 'h', tick: 8, snap: { players: { h: { p: [9, 9, 9], tick: 8 }, c: { p: [2, 0, 2], tick: 12 } } }, t: 5 });
  const sp = m2.state.spaces.s;
  assert.deepEqual(sp.snap.players.h.p, [1, 0, 0], 'older tick loses'); assert.deepEqual(sp.snap.players.c.p, [2, 0, 2], 'newer tick wins even in an older frame');
  assert.deepEqual(sp.snap.agents.bot.p, [5, 0, 5], 'untouched lane kept'); assert.equal(sp.tick, 10); assert.equal(sp.mirrors, 2);
  const late = triadStep(m2.state, { type: 'join', space: 's', sid: 'late', rung: 0, t: 6 });
  const snap = to(late.effects, 'late', 'snap')[0];
  assert.equal(snap.anchor, true); assert.equal(snap.full, true); assert.equal(snap.tick, 10); assert.deepEqual(snap.players.c.p, [2, 0, 2]); assert.deepEqual(Object.keys(snap.agents), ['bot']);
  assert.deepEqual(to(late.effects, 'h', 'peers')[0].list.map((p) => p.sessionId + ':' + p.role), ['h:host', 'c:client', 'late:client']);
  const gone = triadStep(late.state, { type: 'leave', space: 's', sid: 'c', t: 7 });
  assert.equal(gone.state.spaces.s.snap.players.c, undefined, 'a leaver is dropped from the canonical snapshot');
  const tri = new Triad({ now: () => 9 }); tri.step({ type: 'join', space: 'z', sid: 'a', rung: 2 });
  assert.equal(tri.summary().hosted, 1); assert.equal(tri.roleOf('z', 'a'), 'host'); assert.equal(tri.roleOf('z', ANCHOR), 'anchor');
});
