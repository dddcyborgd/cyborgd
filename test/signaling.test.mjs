/*! cyborgd — test signaling · (c) 2026 BANKON / PYTHAI · MIT · upstream patterns © oncyberio (MIT) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Anchor } from '../daemon/signaling.mjs';

let n = 0;
/** a fake WsSocket: what daemon/ws.mjs hands to Anchor.onConnection */
class FakeWs extends EventEmitter {
  constructor() { super(); this.id = 'ws' + (++n); this.remoteAddress = '127.0.0.1'; this.out = []; this.closed = null; }
  send(o) { if (this.closed) return false; this.out.push(typeof o === 'string' ? JSON.parse(o) : o); return true; }
  close(code, reason) { if (this.closed) return; this.closed = { code, reason }; this.emit('close', code, reason); }
  push(o) { this.emit('message', JSON.stringify(o), false); }
  of(t) { return this.out.filter((m) => m.type === t); }
}
const tick = () => new Promise((r) => setTimeout(r, 5));
const REG = [{ id: 'agora', minRole: 'participant', zones: [], agents: [] }, { id: 'dojo', minRole: 'participant', zones: [], agents: [] }];

async function connect(anchor, space, extra = {}) {
  const ws = new FakeWs(); anchor.onConnection(ws);
  ws.push({ type: 'hello', v: 'cyborg/1', space, ...extra }); await tick();
  return { ws, sid: ws.of('welcome')[0]?.sessionId };
}

test('rtc is relayed only between sessions of the SAME space; payload untouched; peers/host roster on join', async () => {
  const anchor = new Anchor({ registry: REG, now: () => 0 });
  const a = await connect(anchor, 'agora'), b = await connect(anchor, 'agora'), d = await connect(anchor, 'dojo');
  assert.ok(a.sid && b.sid && d.sid, 'all welcomed');
  assert.deepEqual(a.ws.of('peers').slice(-1)[0].list.map((p) => p.sessionId), [a.sid, b.sid], 'the roster is per space');
  assert.equal(a.ws.of('host')[0].sessionId, 'anchor', 'participants (rung 0) cannot host → the anchor does');
  const payload = { sdp: 'v=0 offer', big: 'x'.repeat(1000) };
  a.ws.push({ type: 'rtc', to: b.sid, kind: 'offer', payload }); await tick();
  assert.deepEqual(b.ws.of('rtc'), [{ type: 'rtc', from: a.sid, kind: 'offer', payload }]);
  assert.equal(d.ws.of('rtc').length, 0, 'the other space hears nothing');
  a.ws.push({ type: 'rtc', to: d.sid, kind: 'ice', payload: {} }); await tick();
  assert.equal(d.ws.of('rtc').length, 0, 'cross-space rtc is dropped'); assert.equal(a.ws.of('error').slice(-1)[0].code, 'no-peer');
  a.ws.push({ type: 'rtc', to: a.sid, kind: 'answer', payload: {} }); await tick();
  assert.equal(a.ws.of('error').slice(-1)[0].code, 'no-peer', 'no self-relay');
  b.ws.push({ type: 'rtc', to: a.sid, kind: 'answer', payload: 'plain string' }); await tick();
  assert.equal(a.ws.of('rtc')[0].payload, 'plain string');
  assert.equal(anchor.stats().connections, 3); assert.equal(anchor.summary().spaces, 2);
});

test('mirror from a non-host errors; lost → repoint; a leaving host re-elects; hello must come first', async () => {
  const anchor = new Anchor({ registry: REG, now: () => 0 });
  const h = await connect(anchor, 'dojo', { claim: undefined }); // rung 0 → anchor hosts
  h.ws.push({ type: 'mirror', tick: 3, snap: { players: {} } }); await tick();
  assert.equal(h.ws.of('error').slice(-1)[0].code, 'not-host');
  h.ws.push({ type: 'lost', host: 'anchor' }); await tick();
  assert.equal(h.ws.of('repoint').slice(-1)[0].host, 'anchor');
  const bad = new FakeWs(); anchor.onConnection(bad); bad.push({ type: 'ping', t: 1 }); await tick();
  assert.equal(bad.of('error')[0].code, 'expected-hello'); assert.equal(bad.closed.code, 1008);
  const lost = new FakeWs(); anchor.onConnection(lost); lost.push({ type: 'hello', v: 'cyborg/0', space: 'dojo' }); await tick();
  assert.equal(lost.of('error')[0].code, 'invalid');
  h.ws.close(1000, 'bye'); await tick();
  assert.equal(anchor.stats().connections, 0); assert.equal(anchor.triad.hostOf('dojo'), 'anchor');
});
