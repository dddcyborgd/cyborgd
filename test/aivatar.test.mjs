/*! cyborgd — test aivatar · (c) 2026 BANKON / PYTHAI · MIT · upstream patterns © oncyberio (MIT) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRoom, LoopbackTransport, Agent, Riddler } from '../core/index.mjs';
import { ATTEMPT_COOLDOWN_MS } from '../core/riddle.mjs';
import { REACH_RANGE, GREET_RANGE } from '../core/aivatar.mjs';

const RIDDLES = [
  { id: 'echo', q: 'I speak without a mouth and hear without ears. What am I?', a: ['echo', 'an echo'], hint: 'canyon', reward: { token: 'luv-welcome', amount: '5' } },
  { id: 'towel', q: 'What gets wetter the more it dries?', a: ['towel'], reward: { token: 'luv', amount: '1' } },
];
const DEF = { id: 'r', minRole: 'participant', spawn: [0, 0, 6], zones: [{ id: 'sq', minRole: 'participant', bounds: { c: [0, 0, 0], r: 20 } }],
  agents: [{ id: 'sage', kind: 'aivatar', type: 'iNFT', name: 'Sage', seed: 'sage-1', spawn: [0, 0, 0], zone: { c: [0, 0, 0], r: 4 }, say: ['one', 'two', 'three'], riddle: { ids: ['echo'], reward: { token: 'luv-welcome', amount: '5' } } }] };
const wait = () => new Promise((r) => setTimeout(r, 2));

function setup(t0 = 0) {
  let t = t0; const vouchers = [];
  const room = createRoom(DEF, { now: () => t, riddles: RIDDLES, hooks: { onVoucher: (e, p) => vouchers.push({ e, p }) } });
  const [srv, cli] = LoopbackTransport.pair(); const got = []; cli.onMessage((m) => got.push(m));
  const { sessionId } = room.join(srv, { rung: 2, sub: '0xabc' }, { name: 'Alice' });
  const at = (p) => cli.send({ type: 'state', p, r: [0, 0, 0], a: 'idle', s: 1 });
  const says = () => got.filter((m) => m.type === 'say').map((m) => m.text);
  return { room, cli, got, sid: sessionId, at, says, vouchers, setT: (v) => { t = v; }, agent: room.agents.get('sage') };
}

test('proximity greet: within 3 m the agent faces the player, animates "greet" and says a seeded line once', () => {
  const s = setup();
  s.at([0, 0, 10]); s.room.update(1 / 60); assert.deepEqual(s.says(), []);
  s.at([0, 0, 2.5]); s.room.update(1 / 60);
  assert.equal(s.says().length, 1); assert.ok(['one', 'two', 'three'].includes(s.says()[0]));
  const say = s.got.find((m) => m.type === 'say'); assert.equal(say.agent, 'sage'); assert.ok(['joy', 'curious', 'calm', 'wary'].includes(say.emotion)); assert.equal(say.to, s.sid);
  assert.equal(s.agent.a, 'greet'); const face = Math.atan2(0 - s.agent.p[0], -(2.5 - s.agent.p[2])); assert.ok(Math.abs(s.agent.yaw - face) < 1e-9, 'faces the player (yaw 0 faces −z, so +z is ≈ π)');
  s.room.update(1 / 60); assert.equal(s.says().length, 1, 'greets once while near');
  s.at([0, 0, 10]); s.room.update(1 / 60); s.at([0, 0, 2]); s.room.update(1 / 60); assert.equal(s.says().length, 2, 'greets again on re-entry');
  // deterministic: a fresh room with the same seed says the same line to player #0
  const s2 = setup(); s2.at([0, 0, 2.5]); s2.room.update(1 / 60); assert.equal(s2.says()[0], s.says()[0]);
});

test('gesture mirror: the agent mirrors the gesture with an animation and a line', () => {
  const s = setup(); s.at([1, 0, 2]);
  s.cli.send({ type: 'event', name: 'gesture', data: { name: 'nod' } });
  assert.equal(s.agent.a, 'nod'); assert.match(s.says().slice(-1)[0], /nod/i);
  s.cli.send({ type: 'event', name: 'gesture', data: { name: 'jawOpen' } });
  assert.equal(s.agent.a, 'jawOpen'); assert.equal(s.got.filter((m) => m.type === 'say').slice(-1)[0].emotion, 'curious');
  s.cli.send({ type: 'event', name: 'gesture', data: { name: 'wink' } }); assert.equal(s.got.slice(-1)[0].code, 'invalid');
});

test('reach: only a FOCUSED player within 1.5 m extends the arm; arm values come from the arcball', () => {
  const s = setup();
  s.at([0, 0, 1]); s.room.update(1 / 60); assert.equal(s.agent.arm, null, 'near but not focused');
  s.cli.send({ type: 'event', name: 'focus', data: { agent: 'sage' } }); assert.equal(s.agent.focus, s.sid);
  s.room.update(1 / 60);
  const arm = s.agent.arm; assert.ok(arm, 'arm set'); assert.ok(arm.extend > 0 && arm.extend <= 1, 'extend in (0,1]'); assert.equal(typeof arm.yaw, 'number'); assert.equal(typeof arm.pitch, 'number');
  const snap = s.room.snapshot(); assert.deepEqual(snap.agents.sage.arm, arm);
  // move to the right: yaw follows the player around the shoulder
  s.at([0.8, 0, 0.9]); s.room.update(1 / 60); assert.notEqual(s.agent.arm.yaw, arm.yaw);
  // out of reach → arm cleared
  s.at([0, 0, 3]); s.room.update(1 / 60); assert.equal(s.agent.arm, null);
  s.at([0, 0, REACH_RANGE - 0.1]); s.room.update(1 / 60); assert.ok(s.agent.arm);
  // unfocus
  s.cli.send({ type: 'event', name: 'focus', data: { agent: null } }); s.room.update(1 / 60); assert.equal(s.agent.arm, null);
  assert.ok(GREET_RANGE > REACH_RANGE);
});

test('riddle: focus → "riddle" → correct answer → voucher effect; wrong → none; cooldown; once per day', async () => {
  const s = setup(1000);
  s.at([0, 0, 2]);
  s.cli.send({ type: 'event', name: 'focus', data: { agent: 'sage' } });
  s.cli.send({ type: 'msg', to: 'sage', data: { text: 'riddle please' } }); await wait();
  assert.match(s.says().slice(-1)[0], /I speak without a mouth/);
  s.cli.send({ type: 'msg', to: 'sage', data: { text: 'a keyboard' } }); await wait();
  assert.match(s.says().slice(-1)[0], /not correct/); assert.equal(s.vouchers.length, 0);
  s.cli.send({ type: 'msg', to: 'sage', data: { text: 'echo' } }); await wait();
  assert.match(s.says().slice(-1)[0], /one attempt a minute/, 'cooldown after a wrong answer'); assert.equal(s.vouchers.length, 0);
  s.setT(1000 + ATTEMPT_COOLDOWN_MS);
  s.cli.send({ type: 'msg', to: 'sage', data: { text: '  An ECHO! ' } }); await wait();
  assert.match(s.says().slice(-1)[0], /Correct/);
  assert.equal(s.vouchers.length, 1);
  const v = s.vouchers[0].e; assert.equal(v.type, 'voucher'); assert.equal(v.kind, 'drip'); assert.equal(v.token, 'luv-welcome'); assert.equal(v.amount, '5'); assert.equal(v.agent, 'sage'); assert.equal(v.riddle, 'echo'); assert.equal(v.to.sub, '0xabc');
  // once per player per agent per day
  s.setT(1000 + 2 * ATTEMPT_COOLDOWN_MS);
  s.cli.send({ type: 'msg', to: 'sage', data: { text: 'riddle' } }); await wait();
  s.cli.send({ type: 'msg', to: 'sage', data: { text: 'echo' } }); await wait();
  assert.match(s.says().slice(-1)[0], /already earned/); assert.equal(s.vouchers.length, 1);
  // hint + small talk + srai
  s.cli.send({ type: 'msg', to: 'sage', data: { text: 'hey there' } }); await wait(); assert.match(s.says().slice(-1)[0], /Hello|Greetings/);
  s.cli.send({ type: 'msg', to: 'sage', data: { text: 'who are you?' } }); await wait(); assert.match(s.says().slice(-1)[0], /aivatar/);
});

test('wander: seeded idle path inside the zone at ≤ 1.2 m/s, paused while a player is near', () => {
  const s = setup();
  const start = [...s.agent.p]; let maxStep = 0, prev = start;
  for (let i = 0; i < 600; i++) { s.setT(i * 1000 / 60); s.room.update(1 / 60); const d = Math.hypot(s.agent.p[0] - prev[0], s.agent.p[2] - prev[2]); maxStep = Math.max(maxStep, d); prev = [...s.agent.p]; assert.ok(Math.hypot(s.agent.p[0], s.agent.p[2]) <= 4.01, 'stays in its zone'); }
  assert.ok(maxStep <= 1.2 / 60 + 1e-9, 'never faster than 1.2 m/s');
  assert.ok(Math.hypot(s.agent.p[0] - start[0], s.agent.p[2] - start[2]) > 0.05, 'it moved');
  const s2 = setup(); for (let i = 0; i < 600; i++) { s2.setT(i * 1000 / 60); s2.room.update(1 / 60); }
  assert.deepEqual(s2.agent.p, s.agent.p, 'same seed, same path');
  const here = [...s.agent.p]; s.at([here[0], 0, here[2] + 1]); s.room.update(1 / 60); s.room.update(1 / 60);
  assert.deepEqual(s.agent.p, here, 'pauses near a player');
});

test('LLM seam: unmatched chat goes to the injected llm(); riddle answers never do', async () => {
  const seen = [];
  const r = new Riddler({ riddles: RIDDLES, now: () => 0, llm: async (p) => { seen.push(p); return 'From the model: ' + p; } });
  const a = await r.chat('sage', 'p1', 'what is the weather on mars');
  assert.equal(a.llm, true); assert.match(a.text, /From the model/); assert.deepEqual(seen, ['what is the weather on mars']);
  await r.chat('sage', 'p1', 'riddle'); const ans = await r.chat('sage', 'p1', 'towel');
  assert.equal(seen.length, 1); assert.ok(!ans.llm);
  const ag = new Agent({ id: 'x', seed: 1 }, { now: () => 0, riddler: null });
  assert.equal(ag.snapshot().id, 'x');
});
