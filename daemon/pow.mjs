/*! cyborgd — pow · (c) 2026 BANKON / PYTHAI · MIT · upstream patterns © oncyberio (MIT) */
// Hashcash for the faucet: the server hands out a 32-byte challenge (single use, 300 s TTL); the
// client finds a nonce such that sha256(challenge + ':' + nonce) has ≥ `bits` leading zero bits.
// 21 bits ≈ 2 M hashes ≈ a second or two in a browser worker — free for a person, a cost for a farm.
import { createHash, randomBytes } from 'node:crypto';

export const DEFAULT_BITS = 21;
export const DEFAULT_TTL_S = 300;

export function newChallenge() { return randomBytes(32).toString('hex'); }

export function leadingZeroBits(buf) {
  let n = 0;
  for (const b of buf) { if (b === 0) { n += 8; continue; } n += Math.clz32(b) - 24; break; }
  return n;
}

export function hashOf(challenge, nonce) { return createHash('sha256').update(String(challenge) + ':' + String(nonce)).digest(); }

export function verifyPow(challenge, nonce, bits = DEFAULT_BITS) {
  if (typeof challenge !== 'string' || !/^[0-9a-f]{64}$/.test(challenge)) return false;
  if (nonce === undefined || nonce === null || String(nonce).length > 64) return false;
  return leadingZeroBits(hashOf(challenge, nonce)) >= bits;
}

/** brute-force a nonce (tests, selftest, the reference client) */
export function solvePow(challenge, bits = DEFAULT_BITS, start = 0) {
  for (let n = start; ; n++) if (leadingZeroBits(hashOf(challenge, n)) >= bits) return String(n);
}

/** single-use challenge store, in memory, with a ledger hook for restart survival */
export class ChallengeStore {
  constructor({ bits = DEFAULT_BITS, ttlS = DEFAULT_TTL_S, ledger = null, now = Date.now } = {}) {
    this.bits = bits; this.ttlS = ttlS; this.ledger = ledger; this.now = now;
    this.live = new Map();       // challenge → exp (ms)
    this.consumed = new Set();
  }
  /** replay ledger entries: {kind:'challenge', challenge, exp} · {kind:'consumed', challenge} */
  replayEntry(e) {
    if (e.kind === 'challenge' && e.exp > this.now()) this.live.set(e.challenge, e.exp);
    if (e.kind === 'consumed') { this.live.delete(e.challenge); this.consumed.add(e.challenge); }
  }
  issue() {
    this.gc();
    const challenge = newChallenge(), exp = this.now() + this.ttlS * 1000;
    this.live.set(challenge, exp);
    this.ledger?.append({ kind: 'challenge', challenge, bits: this.bits, exp });
    return { challenge, bits: this.bits, ttl: this.ttlS };
  }
  /** consume: returns null on success or a reason string */
  consume(challenge, nonce) {
    this.gc();
    if (this.consumed.has(challenge)) return 'challenge already used';
    const exp = this.live.get(challenge);
    if (!exp) return 'unknown or expired challenge';
    if (!verifyPow(challenge, nonce, this.bits)) return 'proof of work insufficient';
    this.live.delete(challenge); this.consumed.add(challenge);
    this.ledger?.append({ kind: 'consumed', challenge });
    if (this.consumed.size > 50_000) this.consumed.clear();   // expired ones can never be replayed anyway
    return null;
  }
  gc() { const t = this.now(); for (const [c, exp] of this.live) if (exp <= t) this.live.delete(c); }
  get size() { return this.live.size; }
}
