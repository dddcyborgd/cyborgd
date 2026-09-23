/*! cyborgd — ws · (c) 2026 BANKON / PYTHAI · MIT · upstream patterns © oncyberio (MIT) */
// RFC 6455 server side, hand-rolled on node:http + node:net. Node 24 ships a WebSocket CLIENT
// (globalThis.WebSocket) but no server; this module is the server: the upgrade handshake
// (Sec-WebSocket-Accept), frame parse/encode for text · binary · ping · pong · close, client
// masking (required, RFC 6455 §5.1), 7/16/64-bit payload lengths, and continuation reassembly
// (cheap enough to keep even though the cyborg/1 protocol never fragments).
//
//   attach(httpServer, { path: '/ws', onConnection(sock) })
//   sock = { id, send(obj|string|Buffer), close(code, reason), on('message'|'close'|'error'|'pong', fn),
//            ping(), remoteAddress, readyState, alive }
//
// JSON text frames by default: send(object) → JSON.stringify → text frame. Heartbeat: a ping every
// HEARTBEAT_MS; two missed pongs and the socket is destroyed (the client is gone, not slow).
import { createHash, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';

export const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
export const OP = { CONT: 0x0, TEXT: 0x1, BINARY: 0x2, CLOSE: 0x8, PING: 0x9, PONG: 0xa };
export const HEARTBEAT_MS = 15_000;
export const MAX_MISSED_PONGS = 2;
export const MAX_PAYLOAD = 1 << 20;             // 1 MiB — cyborg/1 messages are tiny; anything bigger is abuse

export function acceptKey(secWebSocketKey) {
  return createHash('sha1').update(String(secWebSocketKey) + GUID).digest('base64');
}

/** Encode one frame. payload: Buffer|string. opts.mask=true produces a CLIENT frame (tests). */
export function encodeFrame(opcode, payload = Buffer.alloc(0), opts = {}) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
  const len = data.length;
  const fin = opts.fin === false ? 0 : 0x80;
  let header;
  if (len < 126) header = Buffer.from([fin | (opcode & 0x0f), len]);
  else if (len < 65536) { header = Buffer.alloc(4); header[0] = fin | (opcode & 0x0f); header[1] = 126; header.writeUInt16BE(len, 2); }
  else { header = Buffer.alloc(10); header[0] = fin | (opcode & 0x0f); header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2); }
  if (!opts.mask) return Buffer.concat([header, data]);
  header[1] |= 0x80;
  const key = opts.maskKey ? Buffer.from(opts.maskKey) : randomBytes(4);
  const masked = Buffer.allocUnsafe(len);
  for (let i = 0; i < len; i++) masked[i] = data[i] ^ key[i & 3];
  return Buffer.concat([header, key, masked]);
}

/**
 * Decode as many complete frames as `buf` holds. Returns { frames:[{fin,opcode,masked,payload}], rest }.
 * Throws on a reserved-bit set, a bad length encoding (RSV or the 64-bit MSB), or an oversize payload.
 */
export function decodeFrames(buf, { maxPayload = MAX_PAYLOAD } = {}) {
  const frames = [];
  let off = 0;
  while (buf.length - off >= 2) {
    const b0 = buf[off], b1 = buf[off + 1];
    if (b0 & 0x70) throw new WsError(1002, 'reserved bits set');
    const fin = !!(b0 & 0x80), opcode = b0 & 0x0f, masked = !!(b1 & 0x80);
    let len = b1 & 0x7f, hdr = 2;
    if (len === 126) { if (buf.length - off < 4) break; len = buf.readUInt16BE(off + 2); hdr = 4; }
    else if (len === 127) {
      if (buf.length - off < 10) break;
      const big = buf.readBigUInt64BE(off + 2);
      if (big > BigInt(Number.MAX_SAFE_INTEGER) || (big & (1n << 63n))) throw new WsError(1009, 'bad 64-bit length');
      len = Number(big); hdr = 10;
    }
    if (len > maxPayload) throw new WsError(1009, 'payload too large');
    if (opcode >= OP.CLOSE && (len > 125 || !fin)) throw new WsError(1002, 'bad control frame');
    const total = hdr + (masked ? 4 : 0) + len;
    if (buf.length - off < total) break;
    let payload = buf.subarray(off + hdr + (masked ? 4 : 0), off + total);
    if (masked) {
      const key = buf.subarray(off + hdr, off + hdr + 4);
      const out = Buffer.allocUnsafe(len);
      for (let i = 0; i < len; i++) out[i] = payload[i] ^ key[i & 3];
      payload = out;
    } else payload = Buffer.from(payload);
    frames.push({ fin, opcode, masked, payload });
    off += total;
  }
  return { frames, rest: buf.subarray(off) };
}

export function encodeClose(code = 1000, reason = '') {
  const r = Buffer.from(String(reason), 'utf8').subarray(0, 123);
  const b = Buffer.alloc(2 + r.length); b.writeUInt16BE(code, 0); r.copy(b, 2);
  return b;
}
export function decodeClose(payload) {
  if (!payload || payload.length < 2) return { code: 1005, reason: '' };
  return { code: payload.readUInt16BE(0), reason: payload.subarray(2).toString('utf8') };
}

export class WsError extends Error { constructor(code, msg) { super(msg); this.code = code; } }

let _seq = 0;
export function sockId() { return 's' + (++_seq).toString(36) + '-' + randomBytes(4).toString('hex'); }

/** A connected socket (server side). */
export class WsSocket extends EventEmitter {
  constructor(socket, { heartbeatMs = HEARTBEAT_MS, maxPayload = MAX_PAYLOAD } = {}) {
    super();
    this.id = sockId();
    this.socket = socket;
    this.remoteAddress = socket.remoteAddress;
    this.readyState = 1;               // 1 open · 2 closing · 3 closed
    this.alive = true;
    this.missed = 0;
    this.maxPayload = maxPayload;
    this._buf = Buffer.alloc(0);
    this._frag = null;                 // { opcode, chunks[] }
    this._closeSent = false;
    socket.setNoDelay(true);
    socket.on('data', (d) => this._onData(d));
    socket.on('error', (e) => this.emit('error', e));
    socket.on('close', () => this._finish(this._closeInfo || { code: 1006, reason: 'abnormal' }));
    socket.on('end', () => { if (this.readyState === 1) this.close(1000, 'end'); });
    if (heartbeatMs > 0) {
      this._hb = setInterval(() => {
        if (this.readyState !== 1) return;
        if (this.missed >= MAX_MISSED_PONGS) { this._closeInfo = { code: 1001, reason: 'heartbeat' }; this.terminate(); return; }
        this.missed++; this.ping();
      }, heartbeatMs);
      this._hb.unref?.();
    }
  }
  _onData(d) {
    this._buf = this._buf.length ? Buffer.concat([this._buf, d]) : d;
    let parsed;
    try { parsed = decodeFrames(this._buf, { maxPayload: this.maxPayload }); }
    catch (e) { this.close(e.code || 1002, e.message); return; }
    this._buf = Buffer.from(parsed.rest);
    for (const f of parsed.frames) this._onFrame(f);
  }
  _onFrame(f) {
    if (!f.masked) return this.close(1002, 'client frames must be masked');
    switch (f.opcode) {
      case OP.TEXT: case OP.BINARY:
        if (this._frag) return this.close(1002, 'new data frame inside fragment');
        if (f.fin) return this._deliver(f.opcode, f.payload);
        this._frag = { opcode: f.opcode, chunks: [f.payload], size: f.payload.length }; return;
      case OP.CONT:
        if (!this._frag) return this.close(1002, 'continuation without start');
        this._frag.chunks.push(f.payload); this._frag.size += f.payload.length;
        if (this._frag.size > this.maxPayload) return this.close(1009, 'fragmented payload too large');
        if (f.fin) { const { opcode, chunks } = this._frag; this._frag = null; this._deliver(opcode, Buffer.concat(chunks)); }
        return;
      case OP.PING: this._raw(encodeFrame(OP.PONG, f.payload)); this.emit('ping', f.payload); return;
      case OP.PONG: this.missed = 0; this.alive = true; this.emit('pong', f.payload); return;
      case OP.CLOSE: {
        const info = decodeClose(f.payload);
        this._closeInfo = info;
        if (!this._closeSent) { this._closeSent = true; this._raw(encodeFrame(OP.CLOSE, encodeClose(info.code === 1005 ? 1000 : info.code, ''))); }
        this.readyState = 2; this.socket.end(); return;
      }
      default: return this.close(1002, 'unknown opcode ' + f.opcode);
    }
  }
  _deliver(opcode, payload) {
    if (opcode === OP.TEXT) { const s = payload.toString('utf8'); this.emit('message', s, false); }
    else this.emit('message', payload, true);
  }
  _raw(buf) { if (this.readyState === 1 || (this.readyState === 2 && !this._closeSent)) { try { this.socket.write(buf); } catch (e) { this.emit('error', e); } } }
  /** send(object) → JSON text · send(string) → text · send(Buffer) → binary */
  send(data) {
    if (this.readyState !== 1) return false;
    if (Buffer.isBuffer(data)) { this._raw(encodeFrame(OP.BINARY, data)); return true; }
    const text = typeof data === 'string' ? data : JSON.stringify(data);
    this._raw(encodeFrame(OP.TEXT, text)); return true;
  }
  ping(payload = Buffer.alloc(0)) { this._raw(encodeFrame(OP.PING, payload)); }
  close(code = 1000, reason = '') {
    if (this.readyState >= 2) return;
    this.readyState = 2; this._closeInfo = { code, reason };
    if (!this._closeSent) { this._closeSent = true; try { this.socket.write(encodeFrame(OP.CLOSE, encodeClose(code, reason))); } catch (e) { /* gone */ } }
    const t = setTimeout(() => this.terminate(), 1000); t.unref?.();
    this.socket.end();
  }
  terminate() { if (this.readyState === 3) return; try { this.socket.destroy(); } catch (e) { /* gone */ } this._finish(this._closeInfo || { code: 1006, reason: 'terminated' }); }
  _finish(info) {
    if (this.readyState === 3) return;
    this.readyState = 3; clearInterval(this._hb);
    this.emit('close', info.code, info.reason);
  }
}

/**
 * Attach the upgrade handler to an existing http.Server. Only `path` upgrades are accepted;
 * anything else gets a 404 and the raw socket is closed.
 */
export function attach(httpServer, { path = '/ws', onConnection, heartbeatMs = HEARTBEAT_MS, maxPayload = MAX_PAYLOAD } = {}) {
  const sockets = new Set();
  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '/', 'http://x');
    const key = req.headers['sec-websocket-key'];
    const version = req.headers['sec-websocket-version'];
    const upgrade = String(req.headers.upgrade || '').toLowerCase();
    if (url.pathname !== path) { socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n'); socket.destroy(); return; }
    if (upgrade !== 'websocket' || !key || version !== '13') { socket.write('HTTP/1.1 400 Bad Request\r\nSec-WebSocket-Version: 13\r\nConnection: close\r\n\r\n'); socket.destroy(); return; }
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + acceptKey(key) + '\r\n\r\n');
    const ws = new WsSocket(socket, { heartbeatMs, maxPayload });
    ws.remoteAddress = req.headers['x-forwarded-for']?.split(',')[0].trim() || socket.remoteAddress;
    ws.url = url;
    sockets.add(ws);
    ws.on('close', () => sockets.delete(ws));
    if (head && head.length) ws._onData(head);
    try { onConnection?.(ws, req); } catch (e) { ws.close(1011, 'handler error'); }
  });
  return {
    sockets,
    closeAll(code = 1001, reason = 'shutdown') { for (const s of sockets) s.close(code, reason); },
  };
}
