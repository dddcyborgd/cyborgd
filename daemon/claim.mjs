/*! cyborgd — claim · (c) 2026 BANKON / PYTHAI · MIT · upstream patterns © oncyberio (MIT) */
// The participant identity: a login333 tier claim. token = base64url(JSON claim) + '.' + signature,
// where signature is the issuer's EIP-191 personal_sign over the canonical text below. claimVerify
// is an EXACT port of DeltaVerse/server/login333.mjs (same canonical line order, same optional
// `rung` line spliced at index 5, same error strings) so a claim minted at deltaverse.pythai.net/verify
// verifies here byte-for-byte.
//
// The ladder (DeltaVerse/deploy/privilege-tiers.json `ladder[]`) lives in core/ladder.mjs (pure) and is re-exported here.
import { verifyMessage } from './ethers.mjs';

import { LADDER, TIER_FALLBACK, rankOf, rungName, atLeast, rungOfClaim } from '../core/ladder.mjs';
export { LADDER, TIER_FALLBACK, rankOf, rungName, atLeast, rungOfClaim };

export const b64u = (b) => Buffer.from(b).toString('base64').replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
export const unb64u = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/** canonical claim message (fixed field order) — the recovered signer MUST equal claim.iss */
export function claimMessage(c) {
  const lines = ['login333 tier claim', 'iss: ' + c.iss, 'clientID: ' + c.clientID, 'sub: ' + c.sub,
                 'tier: ' + c.tier, 'name: ' + (c.name || '-'), 'iat: ' + c.iat, 'exp: ' + c.exp];
  if (c.rung) lines.splice(5, 0, 'rung: ' + c.rung);   // ladder rung signs when present; old claims verify unchanged
  return lines.join('\n');
}

/** issue a claim with an ethers Wallet (tests + dev issuers); production claims come from login333 */
export async function claimSign(wallet, c) {
  const sig = await wallet.signMessage(claimMessage(c));
  return b64u(JSON.stringify(c)) + '.' + sig;
}

/** EXACT port of login333 claimVerify: throws 'malformed token' · 'bad claim signature' · 'issuer mismatch (tampered claim)' · 'untrusted issuer' · 'expired' */
export function claimVerify(token, trustedIssuer) {
  const [p, sig] = String(token).split('.');
  if (!p || !sig) throw new Error('malformed token');
  const c = JSON.parse(unb64u(p).toString('utf8'));
  let rec; try { rec = verifyMessage(claimMessage(c), sig); } catch (e) { throw new Error('bad claim signature'); }
  if (rec.toLowerCase() !== String(c.iss).toLowerCase()) throw new Error('issuer mismatch (tampered claim)');
  if (trustedIssuer && rec.toLowerCase() !== trustedIssuer.toLowerCase()) throw new Error('untrusted issuer');
  if (c.exp && Math.floor(Date.now() / 1000) > c.exp) throw new Error('expired');
  return c;
}

/** decode WITHOUT verifying (the insecure mode when LOGIN333_ISSUER is unset) — still honours exp */
export function claimDecode(token) {
  const [p] = String(token).split('.');
  if (!p) throw new Error('malformed token');
  const c = JSON.parse(unb64u(p).toString('utf8'));
  if (c.exp && Math.floor(Date.now() / 1000) > c.exp) throw new Error('expired');
  return c;
}

/**
 * Resolve the identity a socket / request presents.
 *   returns { sub, rung, rank, name, claim, verified }
 * issuer set   → claimVerify (throws on any defect)
 * issuer unset → claimDecode, verified:false (the daemon logs loudly and marks responses insecure)
 * no token     → participant (rung 0, sub null)
 */
export function identify(token, issuer) {
  if (!token) return { sub: null, rung: 0, rank: 'participant', name: null, claim: null, verified: false };
  const claim = issuer ? claimVerify(token, issuer) : claimDecode(token);
  const rung = rungOfClaim(claim);
  return { sub: claim.sub || null, rung, rank: rungName(rung), name: claim.name || null, claim, verified: !!issuer };
}
