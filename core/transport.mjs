/*! cyborgd — transport · (c) 2026 BANKON / PYTHAI · MIT · upstream patterns © oncyberio (MIT) */
// THE TRANSPORT INTERFACE. PURE JS. Everything in core/ that talks to a peer talks through this and
// nothing else, so the same Room runs over a WebSocket (daemon/ws.mjs wraps WsSocket), over an
// RTCDataChannel (dvengine's rtc transport, in the browser host) or over a LoopbackTransport pair
// (tests, and a single-tab host talking to itself).
//
//   interface Transport {
//     id: string                           stable per connection (the session id is assigned by the room)
//     send(obj): boolean                   deliver one JSON-serialisable message; false when closed
//     onMessage(fn(obj)): unsubscribe      fn receives the PARSED object (the transport owns JSON)
//     onClose(fn(code, reason)): unsub     fired exactly once
//     close(code?, reason?): void          idempotent
//     readonly open: boolean
//     meta?: { remoteAddress?, role?, … }  free-form, never trusted for identity (claims are)
//   }
//
// Rules a transport MUST keep: messages arrive in order; onMessage never fires after onClose;
// send() after close is a no-op returning false; the object handed to onMessage is owned by the
// receiver (a loopback pair therefore deep-copies through JSON so no two sides share state).
let _n = 0;
export function transportId(prefix = 't') { return prefix + (++_n).toString(36); }

/** a base with the subscription plumbing; subclasses implement _send and _close */
export class BaseTransport {
  constructor(id, meta = {}) { this.id = id || transportId(); this.meta = meta; this._msg = new Set(); this._cls = new Set(); this.open = true; }
  onMessage(fn) { this._msg.add(fn); return () => this._msg.delete(fn); }
  onClose(fn) { this._cls.add(fn); return () => this._cls.delete(fn); }
  _deliver(obj) { if (!this.open) return; for (const fn of [...this._msg]) fn(obj); }
  _closed(code = 1000, reason = '') { if (!this.open) return; this.open = false; for (const fn of [...this._cls]) fn(code, reason); this._msg.clear(); this._cls.clear(); }
  send() { return false; }
  close() { this._closed(); }
}

/**
 * LoopbackTransport.pair() → [a, b]: a.send(x) arrives at b.onMessage (JSON-copied). Delivery is
 * queued and drained in order (no re-entrancy); with { sync:false } delivery happens on a microtask.
 * Closing one side closes the other with the same code/reason.
 */
export class LoopbackTransport extends BaseTransport {
  constructor(id, meta, { sync = true } = {}) { super(id, meta); this.peer = null; this.sync = sync; this._q = []; this._draining = false; this.sent = 0; this.received = 0; }
  static pair(opts = {}) {
    const a = new LoopbackTransport(opts.idA, opts.metaA, opts), b = new LoopbackTransport(opts.idB, opts.metaB, opts);
    a.peer = b; b.peer = a;
    return [a, b];
  }
  send(obj) {
    if (!this.open || !this.peer || !this.peer.open) return false;
    const copy = JSON.parse(JSON.stringify(obj));
    this.sent++;
    this.peer._enqueue(copy);
    return true;
  }
  _enqueue(obj) {
    this._q.push(obj);
    if (this.sync) this._drain(); else Promise.resolve().then(() => this._drain());
  }
  _drain() {
    if (this._draining) return;
    this._draining = true;
    try { while (this._q.length && this.open) { const m = this._q.shift(); this.received++; this._deliver(m); } }
    finally { this._draining = false; }
  }
  close(code = 1000, reason = '') {
    if (!this.open) return;
    this._q.length = 0;
    this._closed(code, reason);
    const p = this.peer; this.peer = null;
    if (p && p.open) p.close(code, reason);
  }
}

/** a recording sink for tests: collects everything sent to it */
export class RecordingTransport extends BaseTransport {
  constructor(id, meta) { super(id, meta); this.out = []; }
  send(obj) { if (!this.open) return false; this.out.push(JSON.parse(JSON.stringify(obj))); return true; }
  /** simulate an inbound message */
  push(obj) { this._deliver(JSON.parse(JSON.stringify(obj))); }
  ofType(t) { return this.out.filter((m) => m.type === t); }
  last(t) { const l = t ? this.ofType(t) : this.out; return l[l.length - 1]; }
  clear() { this.out.length = 0; }
}

/** wrap any object with send/onMessage/onClose/close into the interface (duck-typing check) */
export function isTransport(t) {
  return !!t && typeof t.send === 'function' && typeof t.onMessage === 'function' && typeof t.onClose === 'function' && typeof t.close === 'function';
}
