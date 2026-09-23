/*! cyborgd — rate · (c) 2026 BANKON / PYTHAI · MIT · upstream patterns © oncyberio (MIT) */
// Cooldowns + daily caps for the faucet, and a generic token bucket for sockets/HTTP. The faucet
// side is fed by the drip ledger (replayed at boot), keyed by BOTH address and claim sub so a
// wallet cannot dodge a cooldown by presenting another claim, nor a claim by naming another wallet.
import { dayKey } from './state.mjs';

export class DripLimiter {
  constructor({ now = Date.now } = {}) {
    this.now = now;
    this.last = new Map();      // `${token}|${key}` → last drip t
    this.daily = new Map();     // `${token}|${key}|${day}` → count
    this.history = new Map();   // key → [{t, token, amount, nonce}] (last 20, for /faucet/status)
  }
  static keys(address, sub) {
    const ks = [];
    if (address) ks.push('a:' + String(address).toLowerCase());
    if (sub) ks.push('s:' + String(sub).toLowerCase());
    return ks;
  }
  record(e) {   // e = {t, token, address, sub, amount, nonce}
    for (const k of DripLimiter.keys(e.address, e.sub)) {
      this.last.set(e.token + '|' + k, Math.max(e.t, this.last.get(e.token + '|' + k) || 0));
      const dk = e.token + '|' + k + '|' + dayKey(e.t);
      this.daily.set(dk, (this.daily.get(dk) || 0) + 1);
      const h = this.history.get(k) || []; h.push({ t: e.t, token: e.token, amount: e.amount, nonce: e.nonce });
      if (h.length > 20) h.shift(); this.history.set(k, h);
    }
  }
  /** null if allowed, else { reason, retryAfterSec } */
  check(token, address, sub, { cooldownSec = 0, capPerDay = 0 } = {}) {
    const t = this.now();
    for (const k of DripLimiter.keys(address, sub)) {
      const last = this.last.get(token.id + '|' + k) || 0;
      if (cooldownSec > 0 && t - last < cooldownSec * 1000) return { reason: 'cooldown', retryAfterSec: Math.ceil((cooldownSec * 1000 - (t - last)) / 1000) };
      if (capPerDay > 0 && (this.daily.get(token.id + '|' + k + '|' + dayKey(t)) || 0) >= capPerDay) {
        const midnight = new Date(t); midnight.setUTCHours(24, 0, 0, 0);
        return { reason: 'daily-cap', retryAfterSec: Math.ceil((midnight.getTime() - t) / 1000) };
      }
    }
    return null;
  }
  status(address, tokens) {
    const t = this.now(), k = 'a:' + String(address).toLowerCase();
    const cooldowns = {};
    for (const tok of tokens) {
      const last = this.last.get(tok.id + '|' + k) || 0;
      const left = Math.max(0, Math.ceil((tok.cooldownSec * 1000 - (t - last)) / 1000));
      cooldowns[tok.id] = { last: last || null, retryAfterSec: last ? left : 0, today: this.daily.get(tok.id + '|' + k + '|' + dayKey(t)) || 0, capPerDay: tok.capPerDay };
    }
    return { address, cooldowns, last: this.history.get(k) || [] };
  }
}

/** token bucket: `capacity` events per `perMs` — for HTTP by IP and WS messages by socket */
export class Bucket {
  constructor(capacity, perMs, now = Date.now) { this.capacity = capacity; this.perMs = perMs; this.now = now; this.m = new Map(); }
  take(key, n = 1) {
    const t = this.now();
    let b = this.m.get(key);
    if (!b) { b = { tokens: this.capacity, at: t }; this.m.set(key, b); }
    b.tokens = Math.min(this.capacity, b.tokens + ((t - b.at) / this.perMs) * this.capacity); b.at = t;
    if (b.tokens < n) return false;
    b.tokens -= n; return true;
  }
  gc(maxAgeMs = 600_000) { const t = this.now(); for (const [k, b] of this.m) if (t - b.at > maxAgeMs) this.m.delete(k); }
}

/** EWMA latency + jitter (the calcLatencyIPDTV idea: jitter = mean |delta| between consecutive samples) */
export class LatencyMeter {
  constructor(alpha = 0.2) { this.alpha = alpha; this.latency = 0; this.jitter = 0; this.samples = 0; this._prev = null; }
  sample(rttMs) {
    const half = rttMs / 2;
    if (this.samples === 0) { this.latency = half; this.jitter = 0; }
    else {
      this.latency = this.latency + this.alpha * (half - this.latency);
      this.jitter = this.jitter + this.alpha * (Math.abs(half - this._prev) - this.jitter);
    }
    this._prev = half; this.samples++;
    return { latency: this.latency, jitter: this.jitter };
  }
}
