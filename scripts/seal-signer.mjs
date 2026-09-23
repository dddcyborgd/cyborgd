#!/usr/bin/env node
/*! cyborgd — seal-signer · (c) 2026 BANKON / PYTHAI · MIT · upstream patterns © oncyberio (MIT) */
// The WRITE side of a bankon-vault/1 file (the read side is daemon/vault.mjs): seal the faucet's
// signing key under a passphrase so the key never sits in /etc/cyborgd.env in the clear.
//   node scripts/seal-signer.mjs <out.vault.json>            key from CYBORGD_SIGNER_KEY (or a fresh random one)
//   passphrase from CYBORGD_VAULT_PASSPHRASE (required)      prints the signer ADDRESS only, never the key
// Layout (byte-compatible with DeltaVerse/engine/bankon-vault.js fromPassphrase):
//   master = PBKDF2-SHA256(passphrase, salt, 210000, 32) · entryKey = HKDF-SHA512(master, salt, 'bankon-vault-entry:'+id, 32)
//   entry  = AES-256-GCM(entryKey, iv = nonce(12), aad = id) → ct ‖ tag(16) · check entry '__check__' = 'bankon-vault-ok'
import { pbkdf2Sync, randomBytes, createCipheriv } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSION, ENTRY_PREFIX, CHECK_ID, CHECK_PLAINTEXT, PBKDF2_ITERATIONS, entryKey, fromPassphrase } from '../daemon/vault.mjs';
import { Wallet } from '../daemon/ethers.mjs';

function seal(key, id, plaintext) {
  const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(id, 'utf8'));
  const ct = Buffer.concat([c.update(Buffer.from(plaintext, 'utf8')), c.final(), c.getAuthTag()]);
  return { nonce: iv.toString('base64'), ct: ct.toString('base64') };
}

/** build a bankon-vault/1 document holding { id → plaintext } entries */
export function sealVault(passphrase, entries, metas = {}) {
  const salt = randomBytes(16);
  const master = pbkdf2Sync(String(passphrase), salt, PBKDF2_ITERATIONS, 32, 'sha256');
  const doc = { version: VERSION, kdf: { name: 'PBKDF2-SHA256', iterations: PBKDF2_ITERATIONS }, salt: salt.toString('base64'), check: seal(entryKey(master, salt, CHECK_ID), CHECK_ID, CHECK_PLAINTEXT), entries: {} };
  for (const [id, text] of Object.entries(entries)) doc.entries[id] = { ...seal(entryKey(master, salt, id), id, text), meta: metas[id] || {} };
  fromPassphrase(passphrase, doc);   // prove the read side opens it
  return doc;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const out = process.argv[2]; const pass = process.env.CYBORGD_VAULT_PASSPHRASE;
  if (!out || !pass) { console.error('usage: CYBORGD_VAULT_PASSPHRASE=… [CYBORGD_SIGNER_KEY=0x…] node scripts/seal-signer.mjs <out.vault.json>'); process.exit(2); }
  const w = process.env.CYBORGD_SIGNER_KEY ? new Wallet(process.env.CYBORGD_SIGNER_KEY) : Wallet.createRandom();
  const doc = sealVault(pass, { 'cyborgd-signer': w.privateKey }, { 'cyborgd-signer': { format: 'privateKey', address: w.address, purpose: 'cyborgd faucet voucher signer', createdAt: new Date().toISOString() } });
  writeFileSync(out, JSON.stringify(doc, null, 2) + '\n', { mode: 0o600 });
  console.log(`sealed ${out} · entry cyborgd-signer · signer address ${w.address}`);
}
