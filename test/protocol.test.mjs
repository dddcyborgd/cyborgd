/*! cyborgd — test protocol · (c) 2026 BANKON / PYTHAI · MIT · upstream patterns © oncyberio (MIT) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseClient, enc, isServerMessage, CLIENT_TYPES, SERVER_TYPES, VERSION, MAX_TXT } from '../core/protocol.mjs';
import * as daemonProtocol from '../daemon/protocol.mjs';

const ok = (m) => { const r = parseClient(m); assert.equal(r.ok, true, JSON.stringify(m) + ' → ' + r.message); return r.msg; };
const bad = (m, code = 'invalid') => { const r = parseClient(m); assert.equal(r.ok, false, JSON.stringify(m) + ' should fail'); assert.equal(r.code, code); return r; };

test('the daemon re-exports the pure protocol', () => { assert.equal(daemonProtocol.VERSION, VERSION); assert.equal(daemonProtocol.parseClient, parseClient); });

test('hello guard', () => {
  ok({ type: 'hello', v: VERSION, space: 'agora' });
  ok({ type: 'hello', v: VERSION, space: 'agora', claim: 'abc.def', name: 'A', avatar: { kind: 'vrm', seed: 3, tint: '#fff' }, role: 'host' });
  bad({ type: 'hello', v: 'cyborg/0', space: 'agora' });
  bad({ type: 'hello', v: VERSION, space: 'has space' });
  bad({ type: 'hello', v: VERSION, space: 'agora', avatar: { kind: 'robot' } });
  bad({ type: 'hello', v: VERSION, space: 'agora', role: 'anchor' });
});

test('state / cmd guards', () => {
  ok({ type: 'state', p: [0, 0, 0], r: [0, 1, 0], a: 'idle', s: 1, txt: 'hi' });
  bad({ type: 'state', p: [0, 0], r: [0, 1, 0], a: 'idle', s: 1 });
  bad({ type: 'state', p: [0, 0, 1e6], r: [0, 1, 0], a: 'idle', s: 1 });
  bad({ type: 'state', p: [0, 0, 0], r: [0, 1, 0], a: 'idle', s: 1, txt: 'x'.repeat(MAX_TXT + 1) });
  ok({ type: 'cmd', tick: 1, seq: 1, mx: 0.5, my: -1, sprint: false, jp: true, jr: false, jh: false, yaw: 0.1 });
  bad({ type: 'cmd', tick: 1.5, seq: 1, mx: 0, my: 0, sprint: false, jp: false, jr: false, jh: false, yaw: 0 });
  bad({ type: 'cmd', tick: 1, seq: 1, mx: 2, my: 0, sprint: false, jp: false, jr: false, jh: false, yaw: 0 });
});

test('msg / event / ping guards', () => {
  ok({ type: 'msg', data: { text: 'hi' } }); ok({ type: 'msg', to: 'herald', data: 'x' });
  bad({ type: 'msg' }); bad({ type: 'msg', data: 'x'.repeat(5000) });
  ok({ type: 'event', name: 'gesture', data: { name: 'smile' } }); bad({ type: 'event', name: 'gesture', data: { name: 'wink' } });
  ok({ type: 'event', name: 'focus', data: { agent: null } }); ok({ type: 'event', name: 'focus', data: { agent: 'herald' } });
  bad({ type: 'event', name: 'dance', data: {} });
  ok({ type: 'ping', t: 5 }); bad({ type: 'ping' });
});

test('triad guards: rtc, mirror, lost', () => {
  ok({ type: 'rtc', to: 'peer-1', kind: 'offer', payload: { sdp: 'v=0' } });
  bad({ type: 'rtc', to: 'peer-1', kind: 'candidate', payload: {} });
  bad({ type: 'rtc', to: 'peer-1', kind: 'ice' });
  ok({ type: 'mirror', tick: 10, snap: { players: {}, agents: {} } });
  bad({ type: 'mirror', tick: -1, snap: {} }); bad({ type: 'mirror', tick: 1, snap: { players: [] } });
  ok({ type: 'lost' }); ok({ type: 'lost', host: 'peer-1' }); bad({ type: 'lost', host: 42 });
});

test('shape errors and unknown types', () => {
  bad('not json', 'bad-json'); bad('[1]', 'bad-shape'); bad({ type: 'warp' }, 'unknown-type'); bad({ type: 'welcome' }, 'unknown-type');
  assert.equal(parseClient(JSON.stringify({ type: 'ping', t: 1 })).ok, true);
  assert.equal(parseClient('x'.repeat(300000)).code, 'too-large');
});

test('encoders emit only server types and every listed type has one', () => {
  const samples = [enc.welcome({ sessionId: 'a' }), enc.denied('r', 'member', 'participant'), enc.joined({ sessionId: 'a', name: 'n', avatar: {}, rank: 'member', rung: 2, role: 'client' }), enc.left('a'), enc.snap(1, 2, {}, {}), enc.ack(1, 1, {}), enc.msg('a', {}), enc.voucher({}), enc.say('h', 'hi', 'joy'), enc.pong(1, 2), enc.error('c', 'm'), enc.peers([]), enc.host('a'), enc.repoint('anchor', 3), enc.rtc('a', 'ice', {})];
  for (const s of samples) assert.ok(isServerMessage(s), s.type);
  assert.deepEqual(new Set(samples.map((s) => s.type)), new Set(SERVER_TYPES));
  assert.ok(CLIENT_TYPES.includes('rtc') && CLIENT_TYPES.includes('mirror') && CLIENT_TYPES.includes('lost'));
});
