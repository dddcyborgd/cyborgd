/*! cyborgd — test voucher · (c) 2026 BANKON / PYTHAI · MIT · upstream patterns © oncyberio (MIT) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Wallet, TypedDataEncoder, keccak256, toUtf8Bytes } from '../daemon/ethers.mjs';
import { VoucherSigner, typeString, typeHash, domainOf, digestOf, domainSeparator, recover, verifyVoucher, nonceFor, DOMAINS, TYPES } from '../daemon/voucher.mjs';

const FAUCET = '0xfa0C63b5BD49a5eE2e725379D1728F0E966Ef199', SPACE = '0x5ace4baEc5b9F80cDe517Ed42D51F360Eb52595e', LUV = '0x2711111111683B8708cb9a48cBf36a51315F8254';
const w = Wallet.createRandom(), signer = new VoucherSigner(w.privateKey);

test('type strings + typehashes verbatim from cyborg-contracts (Drip / SpaceInit / Claim)', () => {
  assert.equal(typeString('Drip'), 'Drip(address token,address to,uint256 amount,uint256 nonce,uint256 deadline)');
  assert.equal(typeString('SpaceInit'), 'SpaceInit(address to,uint256 roomId,uint256 inftTokenId,bytes32 thotRoot,string sceneURI,bytes32 sceneHash,uint256 nonce,uint256 deadline)');
  assert.equal(typeString('Claim'), 'Claim(address recipient,uint256 amount,uint256 nonce,uint256 deadline)');
  for (const p of Object.keys(TYPES)) assert.equal(typeHash(p), keccak256(toUtf8Bytes(typeString(p))));
  assert.deepEqual(DOMAINS['cyborg-faucet'], { name: 'CyborgFaucet', version: '1' }); assert.deepEqual(DOMAINS['cyborg-space'], { name: 'CyborgSpace', version: '1' });
  assert.deepEqual(domainOf('cyborg-faucet', 1, FAUCET.toLowerCase()), { name: 'CyborgFaucet', version: '1', chainId: 1, verifyingContract: FAUCET });
  assert.equal(domainSeparator('cyborg-space', 16661, SPACE), TypedDataEncoder.hashDomain({ name: 'CyborgSpace', version: '1', chainId: 16661, verifyingContract: SPACE }));
});

test('Drip: the digest is EIP-712 hash(domain, Drip, message) and recovers to the signer; redeem args match the ABI order', async () => {
  const v = await signer.drip({ chainId: 1, contract: FAUCET, token: LUV, to: w.address, amount: '1000', nonce: '42', deadline: 1_900_000_000 });
  assert.equal(v.primaryType, 'Drip'); assert.equal(v.typeHash, typeHash('Drip'));
  assert.equal(v.digest, digestOf('cyborg-faucet', 1, FAUCET, v.message));
  assert.equal(recover('cyborg-faucet', 1, FAUCET, v.message, v.signature), w.address);
  assert.notEqual(recover('cyborg-faucet', 16661, FAUCET, v.message, v.signature), w.address, 'another chainId is another domain');
  assert.deepEqual(v.redeem.args, [LUV, w.address, '1000', '42', 1_900_000_000, v.signature]);
  assert.match(v.redeem.method, /^drip\(address token,address to,uint256 amount,uint256 nonce,uint256 deadline,bytes sig\)$/);
  assert.equal(verifyVoucher(v, w.address, 1_800_000_000).ok, true); assert.equal(verifyVoucher(v, w.address, 1_900_000_001).expired, true);
  assert.equal(verifyVoucher(v, Wallet.createRandom().address, 0).ok, false);
});

test('SpaceInit + Claim recover; nonces are deterministic per (sub, token, day, counter)', async () => {
  const s = await signer.spaceInit({ chainId: 16661, contract: SPACE, to: w.address, roomId: 7, inftTokenId: 3, sceneURI: 'ar://scene', nonce: '1', deadline: 1_900_000_000 });
  assert.equal(s.primaryType, 'SpaceInit'); assert.equal(recover('cyborg-space', 16661, SPACE, s.message, s.signature), w.address);
  assert.equal(s.message.thotRoot, '0x' + '00'.repeat(32)); assert.deepEqual(s.redeem.args, [s.message, s.signature]);
  const c = await signer.drip({ faucet: 'shambaluv-airdrop', chainId: 1, contract: '0xdf2C1836550c5711EF9c021cB0de86241dc1DEf3', to: w.address, amount: '5', nonce: '9', deadline: 1_900_000_000 });
  assert.deepEqual(Object.keys(c.message), ['recipient', 'amount', 'nonce', 'deadline']); assert.equal(recover('shambaluv-airdrop', 1, c.contract, c.message, c.signature), w.address);
  assert.equal(nonceFor('0xAB', 'luv', '2026-09-23', 1), nonceFor('0xab', 'luv', '2026-09-23', 1)); assert.notEqual(nonceFor('0xab', 'luv', '2026-09-23', 1), nonceFor('0xab', 'luv', '2026-09-23', 2));
  assert.match(nonceFor('0xab', 'luv', '2026-09-23', 1), /^\d+$/);
});
