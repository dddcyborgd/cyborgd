/*! cyborgd — faucet · (c) 2026 BANKON / PYTHAI · MIT · upstream patterns © oncyberio (MIT) */
// The faucet ladder, one function per rung of it:
//   GET  /faucet/tokens     the registry (registries/faucet-tokens.json), enabled entries only
//   GET  /faucet/challenge  { challenge, bits:21, ttl:300 } — single use
//   POST /faucet/drip       { token, address, claim, pow:{challenge,nonce} }
//        → claimVerify (login333) → rung ≥ token.minRung → PoW sha256(challenge+':'+nonce) ≥ bits leading
//          zero bits → per-address AND per-sub cooldown + daily cap (state/faucet.jsonl replayed at boot)
//          → deterministic nonce → sign (EIP-712) → { voucher }
//   GET  /faucet/status?address=  cooldowns + the last drips
// The aivatar riddle path calls dripForEffect(): identity already proven at join, no PoW, same ledger.
import { identify, atLeast } from './claim.mjs';
import { ChallengeStore } from './pow.mjs';
import { DripLimiter } from './rate.mjs';
import { dayKey } from './state.mjs';
import { nonceFor } from './voucher.mjs';
import { isAddress, getAddress } from './ethers.mjs';

export const DEADLINE_S = 3600;

export class FaucetError extends Error { constructor(status, code, message, extra) { super(message); this.status = status; this.code = code; this.extra = extra || {}; } }

export class Faucet {
  constructor({ tokens = [], chains = {}, signer = null, state = null, issuer = null, now = Date.now, bits, ttlS } = {}) {
    this.tokens = tokens.filter((t) => t.enabled !== false); this.allTokens = tokens; this.chains = chains; this.signer = signer; this.state = state; this.issuer = issuer; this.now = now;
    this.ledger = state ? state.faucet : null;
    this.challenges = new ChallengeStore({ bits, ttlS, ledger: this.ledger, now });
    this.limiter = new DripLimiter({ now });
    this.drips = 0;
    if (this.ledger) this.replay();
  }
  replay() {
    const n = this.ledger.replay((e) => { if (e.kind === 'drip') { this.limiter.record(e); this.drips++; } else this.challenges.replayEntry(e); });
    return n;
  }
  get insecure() { return !this.issuer; }
  get ready() { return !!this.signer; }
  token(id) { const t = this.tokens.find((x) => x.id === id); if (!t) throw new FaucetError(404, 'unknown-token', 'unknown token ' + id); return t; }
  tokensPublic() { return this.tokens.map(({ note, ...t }) => ({ ...t, signer: this.signer?.address || null })); }
  challenge() { return this.challenges.issue(); }

  /** the full ladder (HTTP) */
  async drip({ token, address, claim, pow } = {}) {
    if (!this.signer) throw new FaucetError(503, 'no-signer', 'faucet has no signing key (CYBORGD_SIGNER_KEY or CYBORGD_VAULT)');
    const tok = this.token(String(token || ''));
    if (!isAddress(String(address || ''))) throw new FaucetError(400, 'bad-address', 'address');
    let id;
    try { id = identify(claim, this.issuer); } catch (e) { throw new FaucetError(401, 'bad-claim', String(e.message || e)); }
    if (!id.sub) throw new FaucetError(401, 'no-claim', 'a login333 claim is required');
    if (!atLeast(id.rung, tok.minRung)) throw new FaucetError(403, 'rung', tok.id + ' requires ' + tok.minRung, { rung: id.rank, minRung: tok.minRung });
    if (!pow || typeof pow !== 'object') throw new FaucetError(400, 'pow', 'pow{challenge,nonce} required');
    const bad = this.challenges.consume(pow.challenge, pow.nonce);
    if (bad) throw new FaucetError(403, 'pow', bad);
    return this.issue(tok, address, id, { reason: 'drip', insecure: !id.verified });
  }
  /** the riddle path: identity from the room, no PoW */
  async dripForEffect({ token, address, sub, rung, agent, riddle, sessionId } = {}) {
    if (!this.signer) throw new FaucetError(503, 'no-signer', 'faucet has no signing key');
    const tok = this.token(String(token || ''));
    if (!isAddress(String(address || ''))) throw new FaucetError(400, 'bad-address', 'the participant has no wallet address (join with a claim)');
    if (!atLeast(rung ?? 0, tok.minRung)) throw new FaucetError(403, 'rung', tok.id + ' requires ' + tok.minRung);
    return this.issue(tok, address, { sub: sub || address, rung, verified: true }, { reason: 'riddle', agent, riddle, sessionId });
  }
  async issue(tok, address, id, meta = {}) {
    const limited = this.limiter.check(tok, address, id.sub, tok);
    if (limited) throw new FaucetError(429, limited.reason, limited.reason === 'cooldown' ? 'cooldown: retry in ' + limited.retryAfterSec + ' s' : 'daily cap reached', { retryAfterSec: limited.retryAfterSec });
    const t = this.now(), day = dayKey(t);
    const counter = this.state ? this.state.counters.next('nonce') : ++this.drips;
    const nonce = nonceFor(id.sub, tok.id, day, counter);
    const deadline = Math.floor(t / 1000) + DEADLINE_S;
    const voucher = await this.signer.drip({ faucet: tok.faucet, chainId: tok.chainId, contract: tok.contract, token: tok.token, to: getAddress(address), amount: tok.amount, nonce, deadline });
    const entry = { t, kind: 'drip', token: tok.id, address: String(address).toLowerCase(), sub: String(id.sub).toLowerCase(), amount: tok.amount, nonce, chain: tok.chainId, reason: meta.reason, ...(meta.agent ? { agent: meta.agent, riddle: meta.riddle } : {}), ...(meta.insecure ? { insecure: true } : {}) };
    this.ledger?.append(entry); this.limiter.record(entry); this.drips++;
    return { voucher: { ...voucher, tokenId: tok.id, label: tok.label, symbol: tok.symbol, decimals: tok.decimals, rpc: this.rpcFor(tok.chainId), explorer: this.chains[tok.chainId]?.explorer || null, ...(meta.insecure ? { insecure: true } : {}) } };
  }
  rpcFor(chainId) { return this.chains[String(chainId)]?.rpc || []; }
  status(address) {
    if (!isAddress(String(address || ''))) throw new FaucetError(400, 'bad-address', 'address');
    return { ...this.limiter.status(address, this.tokens), signer: this.signer?.address || null, insecure: this.insecure };
  }
  stats() { return { tokens: this.tokens.length, drips: this.drips, challenges: this.challenges.size, signer: this.signer?.address || null, insecure: this.insecure }; }
}
