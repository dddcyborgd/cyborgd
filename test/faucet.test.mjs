/*! cyborgd — test faucet · (c) 2026 BANKON / PYTHAI · MIT · upstream patterns © oncyberio (MIT) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Wallet } from '../daemon/ethers.mjs';
import { Faucet, FaucetError } from '../daemon/faucet.mjs';
import { VoucherSigner, recover } from '../daemon/voucher.mjs';
import { State } from '../daemon/state.mjs';
import { claimSign } from '../daemon/claim.mjs';
import { solvePow } from '../daemon/pow.mjs';

const issuer = Wallet.createRandom(), user = Wallet.createRandom();
const signer = new VoucherSigner(process.env.CYBORGD_SIGNER_KEY || Wallet.createRandom().privateKey);
const TOKENS = [
  { id: 'luv', label: 'LUV', chainId: 1, symbol: 'LUV', decimals: 18, contract: '0x447aE1ACafec942210b8545218a3a5c5C24b3952', token: '0x2711111111683B8708cb9a48cBf36a51315F8254', faucet: 'cyborg-faucet', amount: '1000', cooldownSec: 60, capPerDay: 2, minRung: 'member' },
  { id: 'gas', label: '0G', chainId: 16661, symbol: '0G', decimals: 18, contract: '0x447aE1ACafec942210b8545218a3a5c5C24b3952', token: '0x0000000000000000000000000000000000000000', faucet: 'cyborg-faucet', amount: '1', cooldownSec: 0, capPerDay: 0, minRung: 'trader' },
  { id: 'off', chainId: 1, contract: '0x447aE1ACafec942210b8545218a3a5c5C24b3952', token: '0x0000000000000000000000000000000000000000', faucet: 'cyborg-faucet', amount: '1', minRung: 'member', enabled: false },
];
const claimFor = (rung) => { const iat = Math.floor(Date.now() / 1000); return claimSign(issuer, { iss: issuer.address, clientID: 'ov', sub: user.address, tier: 'member', rung, name: null, iat, exp: iat + 300 }); };
const rejects = (p, code) => p.then(() => assert.fail('expected ' + code), (e) => { assert.ok(e instanceof FaucetError, String(e)); assert.equal(e.code, code); return e; });

function make(t0 = Date.parse('2026-09-23T10:00:00Z')) {
  let t = t0; const dir = mkdtempSync(join(tmpdir(), 'cyborgd-faucet-'));
  const f = new Faucet({ tokens: TOKENS, chains: { 1: { rpc: ['http://rpc'] } }, signer, state: new State(dir), issuer: issuer.address, now: () => t, bits: 8 });
  const pow = () => { const { challenge, bits } = f.challenge(); return { challenge, nonce: solvePow(challenge, bits) }; };
  return { f, pow, dir, setT: (v) => { t = v; }, t: () => t };
}

test('challenge → pow → drip → an EIP-712 voucher that recovers to the signer; a replayed challenge is rejected', async () => {
  const { f, pow } = make();
  assert.equal(f.tokensPublic().length, 2, 'disabled tokens are hidden'); assert.equal(f.tokensPublic()[0].note, undefined);
  const claim = await claimFor('member'), p = pow();
  const { voucher } = await f.drip({ token: 'luv', address: user.address, claim, pow: p });
  assert.equal(recover('cyborg-faucet', 1, voucher.contract, voucher.message, voucher.signature), signer.address);
  assert.equal(voucher.to, user.address); assert.equal(voucher.amount, '1000'); assert.equal(voucher.tokenId, 'luv'); assert.deepEqual(voucher.rpc, ['http://rpc']); assert.match(voucher.nonce, /^\d+$/);
  assert.equal(voucher.deadline, Math.floor(Date.parse('2026-09-23T10:00:00Z') / 1000) + 3600);
  const e = await rejects(f.drip({ token: 'luv', address: user.address, claim, pow: p }), 'pow'); assert.match(e.message, /already used/);
  await rejects(f.drip({ token: 'luv', address: user.address, claim, pow: { challenge: 'f'.repeat(64), nonce: '1' } }), 'pow');
  const { challenge } = f.challenge(); await rejects(f.drip({ token: 'luv', address: user.address, claim, pow: { challenge, nonce: 'wrong' } }), 'pow');
  assert.equal(f.stats().drips, 1);
});

test('cooldown, daily cap (per address AND per sub), minRung, unknown token, bad claim, no signer', async () => {
  const { f, pow, setT, t } = make();
  const claim = await claimFor('member');
  await f.drip({ token: 'luv', address: user.address, claim, pow: pow() });
  const cd = await rejects(f.drip({ token: 'luv', address: user.address, claim, pow: pow() }), 'cooldown'); assert.equal(cd.extra.retryAfterSec, 60);
  setT(t() + 61_000); await f.drip({ token: 'luv', address: user.address, claim, pow: pow() });
  setT(t() + 61_000); await rejects(f.drip({ token: 'luv', address: user.address, claim, pow: pow() }), 'daily-cap');
  await rejects(f.drip({ token: 'luv', address: Wallet.createRandom().address, claim, pow: pow() }), 'daily-cap', 'another wallet, same sub → still capped');
  setT(Date.parse('2026-09-24T00:00:01Z')); await f.drip({ token: 'luv', address: user.address, claim, pow: pow() });
  const r = await rejects(f.drip({ token: 'gas', address: user.address, claim, pow: pow() }), 'rung'); assert.equal(r.extra.minRung, 'trader');
  await f.drip({ token: 'gas', address: user.address, claim: await claimFor('trader'), pow: pow() });
  await rejects(f.drip({ token: 'off', address: user.address, claim, pow: pow() }), 'unknown-token');
  await rejects(f.drip({ token: 'luv', address: user.address, claim: 'nope', pow: pow() }), 'bad-claim');
  await rejects(f.drip({ token: 'luv', address: user.address, pow: pow() }), 'no-claim');
  await rejects(f.drip({ token: 'luv', address: 'not-an-address', claim, pow: pow() }), 'bad-address');
  const st = f.status(user.address); assert.equal(st.cooldowns.luv.today, 1); assert.equal(st.last.length, 4);
  const none = new Faucet({ tokens: TOKENS, issuer: issuer.address }); await rejects(none.drip({ token: 'luv', address: user.address, claim, pow: {} }), 'no-signer');
});

test('the riddle path (dripForEffect): no PoW, identity from the room, same ledger + cooldowns', async () => {
  const { f, setT, t } = make();
  const { voucher } = await f.dripForEffect({ token: 'luv', address: user.address, sub: user.address, rung: 2, agent: 'herald', riddle: 'echo' });
  assert.equal(recover('cyborg-faucet', 1, voucher.contract, voucher.message, voucher.signature), signer.address);
  await rejects(f.dripForEffect({ token: 'luv', address: user.address, sub: user.address, rung: 2 }), 'cooldown');
  await rejects(f.dripForEffect({ token: 'gas', address: user.address, sub: user.address, rung: 2 }), 'rung');
  await rejects(f.dripForEffect({ token: 'luv', address: null, sub: null, rung: 2 }), 'bad-address');
  const claim = await claimFor('member'), c = f.challenge();
  await rejects(f.drip({ token: 'luv', address: user.address, claim, pow: { challenge: c.challenge, nonce: solvePow(c.challenge, c.bits) } }), 'cooldown', 'HTTP and riddle share one ledger');
  setT(t() + 61_000); assert.ok((await f.dripForEffect({ token: 'luv', address: user.address, sub: user.address, rung: 2 })).voucher);
});
