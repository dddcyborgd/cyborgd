/*! cyborgd — test claim · (c) 2026 BANKON / PYTHAI · MIT · upstream patterns © oncyberio (MIT) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Wallet } from '../daemon/ethers.mjs';
import { claimSign, claimVerify, claimMessage, claimDecode, identify, rankOf, atLeast, rungOfClaim, b64u, unb64u, LADDER } from '../daemon/claim.mjs';

const issuer = Wallet.createRandom();
const now = () => Math.floor(Date.now() / 1000);
const mk = (o = {}) => ({ iss: issuer.address, clientID: 'ov', sub: '0x00000000000000000000000000000000000000AA', tier: 'deployer', rung: 'owner', name: 'alice.bankon.eth', iat: now(), exp: now() + 120, ...o });

test('canonical text matches login333 (fixed line order, optional rung spliced at index 5)', () => {
  const c = mk({ iat: 1, exp: 2 });
  assert.equal(claimMessage(c), ['login333 tier claim', 'iss: ' + issuer.address, 'clientID: ov', 'sub: ' + c.sub, 'tier: deployer', 'rung: owner', 'name: alice.bankon.eth', 'iat: 1', 'exp: 2'].join('\n'));
  const { rung, ...old } = c;
  assert.equal(claimMessage(old).split('\n').length, 8);
  assert.equal(claimMessage({ ...old, name: null }).split('\n')[5], 'name: -');
});

test('sign → verify round-trip with a throwaway wallet; the ladder rung is honoured', async () => {
  const tok = await claimSign(issuer, mk());
  const c = claimVerify(tok, issuer.address);
  assert.equal(c.rung, 'owner'); assert.equal(c.sub, mk().sub);
  const id = identify(tok, issuer.address);
  assert.equal(id.rung, 5); assert.equal(id.rank, 'owner'); assert.equal(id.verified, true);
});

test('wrong issuer, tampered claim, malformed token, expiry all fail with login333 error strings', async () => {
  const tok = await claimSign(issuer, mk());
  assert.throws(() => claimVerify(tok, Wallet.createRandom().address), /untrusted issuer/);
  const [p, s] = tok.split('.'); const c = JSON.parse(unb64u(p).toString('utf8')); c.rung = 'overlord';
  assert.throws(() => claimVerify(b64u(JSON.stringify(c)) + '.' + s, issuer.address), /issuer mismatch/);
  assert.throws(() => claimVerify('nodot', issuer.address), /malformed token/);
  assert.throws(() => claimVerify(p + '.0xdeadbeef', issuer.address), /bad claim signature/);
  const expired = await claimSign(issuer, mk({ iat: 1, exp: 2 }));
  assert.throws(() => claimVerify(expired, issuer.address), /expired/);
  assert.throws(() => claimDecode(expired), /expired/);
});

test('insecure mode decodes without verifying and says so', async () => {
  const forged = b64u(JSON.stringify(mk({ rung: 'overlord' }))) + '.0x00';
  const id = identify(forged, null);
  assert.equal(id.verified, false); assert.equal(id.rung, 7);
  assert.throws(() => identify(forged, issuer.address));
  assert.deepEqual(identify(null, issuer.address), { sub: null, rung: 0, rank: 'participant', name: null, claim: null, verified: false });
});

test('ladder: rankOf / atLeast / rungOfClaim incl. tier fallback and aliases', () => {
  assert.equal(LADDER.length, 9);
  assert.equal(rankOf('overlord'), 7); assert.equal(rankOf('mastermind'), 8); assert.equal(rankOf('nope'), 0); assert.equal(rankOf(3), 3); assert.equal(rankOf('public'), 0); assert.equal(rankOf('deployer'), 5);
  assert.ok(atLeast('overseer', 'member')); assert.ok(!atLeast('member', 'player'));
  assert.equal(rungOfClaim({ tier: 'deployer' }), 5); assert.equal(rungOfClaim({ tier: 'member', sub: '0x1' }), 2); assert.equal(rungOfClaim({ sub: '0x1' }), 2); assert.equal(rungOfClaim({}), 0);
  assert.equal(rungOfClaim({ rung: 'trader', tier: 'member' }), 4);
});
