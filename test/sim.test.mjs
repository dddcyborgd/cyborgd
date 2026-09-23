/*! cyborgd — test sim · (c) 2026 BANKON / PYTHAI · MIT · upstream patterns © oncyberio (MIT) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepSim, replay, initialState, idleCmd, InputQueue, Authority, CFG, SIM_DT, ackOf, MAX_CMD_AGE_TICKS } from '../core/sim.mjs';

const cmd = (tick, o = {}) => ({ ...idleCmd(tick, tick, 0), ...o });
const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test('determinism: the same command sequence replays to the identical state', () => {
  const cmds = []; for (let i = 1; i <= 240; i++) cmds.push(cmd(i, { mx: Math.sin(i / 7), my: Math.cos(i / 11), sprint: i % 30 < 10, jp: i % 45 === 0, jr: i % 45 === 5, yaw: i / 50 }));
  const a = replay(initialState(), cmds), b = replay(initialState(), cmds);
  assert.deepEqual(a, b);
  assert.notDeepEqual(replay(initialState(), cmds.slice(0, 100)), a);
  assert.equal(a.tick, 240); assert.equal(a.seq, 240);
});

test('walk 3 m/s, sprint 6 m/s, yaw-relative (yaw 0 → −z, yaw π/2 → +x)', () => {
  let s = initialState(); for (let i = 1; i <= 60; i++) s = stepSim(s, cmd(i, { my: 1 }));
  assert.ok(close(s.p[2], -3, 1e-3), 'walked 3 m forward in 1 s'); assert.ok(close(s.p[0], 0));
  s = initialState(); for (let i = 1; i <= 60; i++) s = stepSim(s, cmd(i, { my: 1, sprint: true }));
  assert.ok(close(s.p[2], -6, 1e-3), 'sprinted 6 m');
  s = initialState(); for (let i = 1; i <= 60; i++) s = stepSim(s, cmd(i, { my: 1, yaw: Math.PI / 2 }));
  assert.ok(close(s.p[0], 3, 1e-3) && close(s.p[2], 0, 1e-3), 'yaw π/2 walks +x');
  s = initialState(); for (let i = 1; i <= 60; i++) s = stepSim(s, cmd(i, { mx: 1, my: 1 }));
  assert.ok(close(Math.hypot(s.p[0], s.p[2]), 3, 1e-3), 'diagonal input is normalised');
  assert.equal(s.moving, true); assert.equal(stepSim(s, cmd(61)).moving, false);
});

test('jump 5 m/s under 9.81 gravity: apex ≈ 1.27 m, lands on y = 0, grounded again; release halves', () => {
  let s = initialState(), apex = 0, landedAt = null;
  for (let i = 1; i <= 120; i++) { s = stepSim(s, cmd(i, { jp: i === 1 })); apex = Math.max(apex, s.p[1]); if (landedAt === null && i > 1 && s.grounded) landedAt = i; }
  assert.ok(close(apex, 5 * 5 / (2 * 9.81), 0.06), 'apex ' + apex);
  assert.ok(landedAt > 55 && landedAt < 70, 'airborne about 1.02 s, landed at tick ' + landedAt);
  assert.equal(s.p[1], 0); assert.equal(s.grounded, true); assert.equal(s.v[1], 0);
  // pressing jump mid-air does nothing; release while rising halves vy
  let j = stepSim(initialState(), cmd(1, { jp: true })); const vy = j.v[1];
  j = stepSim(j, cmd(2, { jp: true })); assert.ok(j.v[1] < vy, 'no double jump');
  j = stepSim(j, cmd(3, { jr: true })); assert.ok(close(j.v[1], (vy - 9.81 * SIM_DT) * 0.5 - 9.81 * SIM_DT, 1e-3), 'vy is read after the jump tick (gravity already applied once)');
});

test('coyote time: a jump within 0.1 s of leaving the ground still fires, later it does not', () => {
  const cfg = { ...CFG, groundY: 0 };
  let s = { ...initialState(), grounded: false, coyote: cfg.coyote, p: [0, 0.5, 0] };   // just walked off a ledge
  const early = stepSim(stepSim(s, cmd(1), SIM_DT, cfg), cmd(2, { jp: true }), SIM_DT, cfg);
  assert.ok(early.v[1] > 4, 'jumped during coyote window');
  let late = s; for (let i = 1; i <= 8; i++) late = stepSim(late, cmd(i), SIM_DT, cfg);
  assert.equal(late.coyote, 0);
  const noJump = stepSim(late, cmd(9, { jp: true }), SIM_DT, cfg); assert.ok(noJump.v[1] < 0, 'coyote expired');
});

test('InputQueue drops commands older than 32 ticks, dedupes by seq, drains in seq order', () => {
  const q = new InputQueue();
  assert.equal(q.push(cmd(10), 10), 'queued'); assert.equal(q.push(cmd(10), 10), 'dup');
  assert.equal(q.push(cmd(9, { seq: 9 }), 9 + MAX_CMD_AGE_TICKS + 1), 'stale'); assert.equal(q.dropped, 1);
  q.push({ ...cmd(12), seq: 12 }, 10); q.push({ ...cmd(11), seq: 11 }, 10);
  assert.deepEqual(q.drain(11).map((c) => c.seq), [10, 11]); assert.deepEqual(q.drain().map((c) => c.seq), [12]);
  assert.equal(q.push({ ...cmd(11), seq: 11 }, 12), 'dup', 'a seq seen before stays deduped');
});

test('Authority: cmd → update → ack{tick,seq,checkpoint:{p,v,grounded}}; missing cmds repeat the last one', () => {
  const a = new Authority({ p: [0, 0, 0] });
  a.feed(cmd(1, { my: 1 }));
  const ack = a.update();
  assert.equal(ack.tick, 1); assert.equal(ack.seq, 1); assert.deepEqual(Object.keys(ack.checkpoint), ['p', 'v', 'grounded']);
  assert.ok(close(ack.checkpoint.p[2], -3 * SIM_DT)); assert.equal(ack.checkpoint.grounded, true);
  const ack2 = a.update(); assert.equal(ack2.tick, 2); assert.ok(close(ack2.checkpoint.p[2], -6 * SIM_DT), 'kept walking');
  assert.deepEqual(ackOf(a.state).checkpoint, ack2.checkpoint);
  a.teleport([5, 0, 5]); assert.deepEqual(a.state.p, [5, 0, 5]); assert.equal(a.state.tick, 2);
});
