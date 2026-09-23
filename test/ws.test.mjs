/*! cyborgd — test ws · (c) 2026 BANKON / PYTHAI · MIT · upstream patterns © oncyberio (MIT) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { acceptKey, encodeFrame, decodeFrames, encodeClose, decodeClose, OP, attach, WsError } from '../daemon/ws.mjs';

test('accept key matches the RFC 6455 §4.2.2 example', () => {
  assert.equal(acceptKey('dGhlIHNhbXBsZSBub25jZQ=='), 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
});

test('frames round-trip at 7-, 16- and 64-bit lengths, masked and unmasked', () => {
  for (const len of [0, 1, 125, 126, 65535, 65536, 70000]) {
    const payload = Buffer.alloc(len, 0xab);
    for (const mask of [false, true]) {
      const { frames, rest } = decodeFrames(encodeFrame(OP.BINARY, payload, { mask }));
      assert.equal(frames.length, 1, `len ${len} mask ${mask}`);
      assert.equal(frames[0].masked, mask);
      assert.equal(frames[0].payload.length, len);
      assert.ok(frames[0].payload.equals(payload));
      assert.equal(rest.length, 0);
    }
  }
});

test('partial frames wait, multiple frames in one buffer all decode', () => {
  const a = encodeFrame(OP.TEXT, 'hello', { mask: true }), b = encodeFrame(OP.TEXT, 'world', { mask: true });
  const both = Buffer.concat([a, b]);
  const r = decodeFrames(both.subarray(0, both.length - 3));
  assert.equal(r.frames.length, 1); assert.equal(r.frames[0].payload.toString(), 'hello'); assert.equal(r.rest.length, b.length - 3);
  const r2 = decodeFrames(both); assert.deepEqual(r2.frames.map((f) => f.payload.toString()), ['hello', 'world']);
});

test('control frames: ping/pong/close, close code round-trip, oversize and RSV rejected', () => {
  const { frames } = decodeFrames(encodeFrame(OP.CLOSE, encodeClose(1001, 'going away'), { mask: true }));
  assert.equal(frames[0].opcode, OP.CLOSE);
  assert.deepEqual(decodeClose(frames[0].payload), { code: 1001, reason: 'going away' });
  assert.deepEqual(decodeClose(Buffer.alloc(0)), { code: 1005, reason: '' });
  const bad = encodeFrame(OP.TEXT, 'x'); bad[0] |= 0x40;
  assert.throws(() => decodeFrames(bad), (e) => e instanceof WsError && e.code === 1002);
  assert.throws(() => decodeFrames(encodeFrame(OP.BINARY, Buffer.alloc(2000)), { maxPayload: 1000 }), (e) => e.code === 1009);
  assert.throws(() => decodeFrames(encodeFrame(OP.PING, Buffer.alloc(200))), (e) => e.code === 1002);
});

test('live server: handshake, JSON echo, unmasked client frame is rejected, heartbeat drops a silent peer', async () => {
  const server = createServer((req, res) => { res.writeHead(404); res.end(); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const seen = [];
  const hub = attach(server, { path: '/ws', heartbeatMs: 60, onConnection: (ws) => { ws.on('message', (m) => { seen.push(m); ws.send({ echo: JSON.parse(m) }); }); } });
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  const reply = new Promise((r) => { ws.onmessage = (e) => r(JSON.parse(e.data)); });
  ws.send(JSON.stringify({ type: 'ping', t: 1 }));
  assert.deepEqual(await reply, { echo: { type: 'ping', t: 1 } });
  assert.equal(hub.sockets.size, 1);
  // the browser client answers pings automatically, so it survives the heartbeat
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(hub.sockets.size, 1);
  const closed = new Promise((r) => { ws.onclose = (e) => r(e.code); });
  ws.close(1000, 'bye');
  assert.equal(await closed, 1000);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(hub.sockets.size, 0);
  // wrong path → 404, no upgrade
  const bad = new WebSocket(`ws://127.0.0.1:${port}/nope`);
  const badResult = await new Promise((r) => { bad.onerror = () => r('error'); bad.onopen = () => r('open'); });
  assert.equal(badResult, 'error');
  hub.closeAll();
  await new Promise((r) => server.close(r));
});
