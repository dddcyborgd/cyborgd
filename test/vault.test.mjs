/*! cyborgd — test vault · (c) 2026 BANKON / PYTHAI · MIT · upstream patterns © oncyberio (MIT) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sealVault } from '../scripts/seal-signer.mjs';
import { fromPassphrase, signerKeyFrom, Vault } from '../daemon/vault.mjs';
import { Wallet } from '../daemon/ethers.mjs';
import { VoucherSigner } from '../daemon/voucher.mjs';

test('seal-signer writes a bankon-vault/1 the daemon opens; wrong passphrase / version / tampered entry all fail', () => {
  const w = Wallet.createRandom();
  const doc = sealVault('correct horse', { 'cyborgd-signer': w.privateKey, other: 'x' }, { 'cyborgd-signer': { format: 'privateKey' } });
  assert.equal(doc.version, 'bankon-vault/1'); assert.ok(!JSON.stringify(doc).includes(w.privateKey.slice(2, 20)), 'the key is not in the clear');
  const v = fromPassphrase('correct horse', doc);
  assert.deepEqual(v.list().map((e) => e.id), ['cyborgd-signer', 'other']);
  assert.equal(signerKeyFrom(v), w.privateKey); assert.equal(signerKeyFrom(v, 'other'), 'x');
  assert.equal(new VoucherSigner(signerKeyFrom(v)).address, w.address);
  assert.throws(() => fromPassphrase('wrong', doc), /did not unlock/);
  assert.throws(() => new Vault({ ...doc, version: 'bankon-vault/9' }, Buffer.alloc(32)), /unsupported vault version/);
  const t = JSON.parse(JSON.stringify(doc)); t.entries.other.ct = t.entries.other.ct.replace(/^./, (c) => (c === 'A' ? 'B' : 'A'));
  assert.throws(() => fromPassphrase('correct horse', t).get('other'));
  assert.throws(() => v.get('nope'), /entry not found/);
});
