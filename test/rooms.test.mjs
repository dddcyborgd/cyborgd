/*! cyborgd — test rooms · (c) 2026 BANKON / PYTHAI · MIT · upstream patterns © oncyberio (MIT) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRoom, LoopbackTransport, INVALID_LIMIT } from '../core/index.mjs';
import { INVALID_LIMIT as LIMIT } from '../core/protocol.mjs';

const DEF = { id: 'agora', name: 'The Agora', minRole: 'participant', tickRate: 20, simRate: 60, maxPlayers: 3, spawn: [0, 0, 6],
  zones: [{ id: 'square', minRole: 'participant', bounds: { c: [0, 0, 0], r: 14 } }, { id: 'vip', minRole: 'overseer', bounds: { c: [10, 0, 0], r: 2 } }, { id: 'gate', minRole: 'participant', bounds: { c: [0, 0, 12], r: 2 }, portalTo: 'journal:hall' }] };

function client(room, identity, hello = {}) {
  const [srv, cli] = LoopbackTransport.pair();
  const got = []; cli.onMessage((m) => got.push(m));
  const res = room.join(srv, identity, hello);
  return { cli, got, res, sid: res.sessionId, last: (t) => got.filter((m) => m.type === t).slice(-1)[0], send: (m) => cli.send(m) };
}

test('two loopback clients: welcome, joined, snap, zone-locked, leave', () => {
  let t = 0; const room = createRoom(DEF, { now: () => t });
  const a = client(room, { rung: 2, sub: '0xA' }, { name: 'Alice' });
  assert.equal(a.res.ok, true);
  assert.equal(a.got[0].type, 'welcome'); assert.equal(a.got[0].sessionId, a.sid); assert.equal(a.got[0].rung, 'member'); assert.equal(a.got[0].zones.length, 3);
  const b = client(room, { rung: 0 }, { name: 'Bob' });
  assert.equal(a.last('joined').sessionId, b.sid); assert.equal(a.last('joined').name, 'Bob');
  assert.equal(b.got[0].type, 'welcome'); assert.ok(b.got[0].snap.players[a.sid], 'late joiner sees Alice in the welcome snapshot');
  // snapshots are deltas after the first
  const s1 = room.tick(); assert.equal(s1.type, 'snap'); assert.equal(s1.full, true); assert.deepEqual(Object.keys(s1.players).sort(), [a.sid, b.sid].sort());
  a.send({ type: 'state', p: [1, 0, 1], r: [0, 0.5, 0], a: 'walk', s: 1, txt: 'hi' });
  const s2 = room.tick(); assert.deepEqual(Object.keys(s2.players), [a.sid]); assert.equal(s2.players[a.sid].txt, 'hi'); assert.equal(s2.full, undefined);
  assert.equal(b.last('snap').players[a.sid].a, 'walk');
  // zone gating: the VIP zone requires overseer
  a.send({ type: 'state', p: [10, 0, 0], r: [0, 0, 0], a: 'idle', s: 1 });
  const err = a.last('error'); assert.equal(err.code, 'zone-locked'); assert.equal(err.zone, 'vip'); assert.equal(err.minRole, 'overseer'); assert.deepEqual(err.p, [1, 0, 1]);
  assert.deepEqual(room.players.get(a.sid).p, [1, 0, 1], 'pushed back to the last accepted position');
  // an overseer may enter
  const c = client(room, { rung: 6 }, { name: 'Ova' });
  c.send({ type: 'state', p: [10, 0, 0], r: [0, 0, 0], a: 'idle', s: 1 });
  assert.equal(c.last('error'), undefined); assert.equal(room.players.get(c.sid).zone, 'vip');
  // portal reach
  a.send({ type: 'state', p: [0, 0, 12], r: [0, 0, 0], a: 'idle', s: 1 });
  assert.deepEqual(a.last('msg').data, { portal: 'gate', to: 'journal:hall' });
  // room full
  const d = client(room, { rung: 2 }); assert.equal(d.res.ok, false); assert.equal(d.res.reason, 'full'); assert.equal(d.got[0].type, 'denied');
  // leave
  b.cli.close();
  assert.equal(a.last('left').sessionId, b.sid); assert.equal(room.size, 2);
  const s3 = room.tick(); assert.deepEqual(s3.playersGone, [b.sid]);
});

test('minRole denies below the rung; ping/pong feeds latency; invalid messages strike and close', () => {
  let t = 1000; const room = createRoom({ ...DEF, minRole: 'member' }, { now: () => t });
  const p = client(room, { rung: 0 }); assert.equal(p.res.ok, false); assert.equal(p.got[0].type, 'denied'); assert.equal(p.got[0].minRole, 'member');
  const a = client(room, { rung: 2 });
  a.send({ type: 'ping', t: 900 }); assert.equal(a.last('pong').t, 900); assert.equal(room.players.get(a.sid).latency, 50);
  t = 1100; a.send({ type: 'ping', t: 1000 }); assert.equal(room.players.get(a.sid).latency, 50);
  for (let i = 0; i < LIMIT; i++) a.send({ type: 'state', p: [0, 0] });
  assert.equal(room.size, 0, 'closed after ' + INVALID_LIMIT + ' strikes'); assert.equal(a.cli.open, false);
});

test('direct and broadcast msg; unknown recipient strikes; cmd rejected on a trusted room', () => {
  const room = createRoom(DEF, { now: () => 0 });
  const a = client(room, { rung: 2 }), b = client(room, { rung: 2 });
  a.send({ type: 'msg', data: { text: 'all' } }); assert.equal(b.last('msg').from, a.sid); assert.equal(a.last('msg'), undefined);
  a.send({ type: 'msg', to: b.sid, data: 'direct' }); assert.equal(b.last('msg').data, 'direct'); assert.equal(b.last('msg').to, b.sid);
  a.send({ type: 'msg', to: 'ghost', data: 'x' }); assert.equal(a.last('error').message, 'unknown recipient');
  a.send({ type: 'cmd', tick: 1, seq: 1, mx: 0, my: 1, sprint: false, jp: false, jr: false, jh: false, yaw: 0 });
  assert.match(a.last('error').message, /authoritative/);
});

test('hooks fire: onJoin / onLeave / onMessage / onUpdate / onRelay', () => {
  const calls = [];
  const room = createRoom(DEF, { now: () => 0, hooks: { onJoin: (p) => calls.push('join:' + p.name), onLeave: (p, r) => calls.push('leave:' + r), onMessage: (p, m) => calls.push('msg:' + m.type), onUpdate: (dt) => calls.push('update'), onRelay: (sid, m) => calls.push('relay:' + m.type) } });
  const a = client(room, { rung: 2 }, { name: 'A' });
  a.send({ type: 'ping', t: 0 }); a.send({ type: 'rtc', to: 'x', kind: 'ice', payload: {} }); a.send({ type: 'lost' });
  room.update(1 / 60); room.leave(a.sid, 'bye');
  assert.deepEqual(calls, ['join:A', 'msg:ping', 'relay:rtc', 'relay:lost', 'update', 'leave:bye']);
});
