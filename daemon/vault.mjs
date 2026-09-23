/*! cyborgd — vault · (c) 2026 BANKON / PYTHAI · MIT · upstream patterns © oncyberio (MIT) */
// The READ side of a bankon-vault file (port of DeltaVerse/engine/bankon-vault.js, format
// `bankon-vault/1`), so the daemon's signing key never sits in an env var in the clear:
//   master   = PBKDF2-SHA256(passphrase, salt, 210000, 32)          (fromPassphrase)
//   entryKey = HKDF-SHA512(master, salt, 'bankon-vault-entry:' + id, 32)
//   entry    = AES-256-GCM(entryKey, iv = nonce, aad = id) — WebCrypto layout: ciphertext ‖ 16-byte tag
//   check    = the reserved '__check__' entry must decrypt to 'bankon-vault-ok' (wrong passphrase → throws)
// File = JSON { version, salt(b64), check{nonce,ct}, entries:{ id: {nonce, ct, meta} }, kdf? }.
// Only fromPassphrase is ported (a daemon has no wallet to sign the binding message with).
import { pbkdf2Sync, hkdfSync, createDecipheriv } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const VERSION = 'bankon-vault/1';
export const ENTRY_PREFIX = 'bankon-vault-entry:';
export const CHECK_ID = '__check__';
export const CHECK_PLAINTEXT = 'bankon-vault-ok';
export const PBKDF2_ITERATIONS = 210000;

const ub64 = (s) => Buffer.from(String(s), 'base64');

export function entryKey(master, salt, id) { return Buffer.from(hkdfSync('sha512', master, salt, ENTRY_PREFIX + id, 32)); }

export function openSealed(key, id, blob) {
  const iv = ub64(blob.nonce), data = ub64(blob.ct);
  if (data.length < 16) throw new Error('ciphertext too short');
  const ct = data.subarray(0, data.length - 16), tag = data.subarray(data.length - 16);
  const d = createDecipheriv('aes-256-gcm', key, iv);
  d.setAAD(Buffer.from(id, 'utf8')); d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]);
}

export class Vault {
  constructor(doc, master) {
    if (!doc || doc.version !== VERSION) throw new Error('unsupported vault version: ' + (doc && doc.version));
    this.doc = doc; this.master = master; this.salt = ub64(doc.salt); this.entries = doc.entries || {};
    let ok = false;
    try { ok = openSealed(entryKey(master, this.salt, CHECK_ID), CHECK_ID, doc.check).toString('utf8') === CHECK_PLAINTEXT; } catch (e) { ok = false; }
    if (!ok) throw new Error('wrong key — vault did not unlock');
  }
  has(id) { return !!this.entries[id]; }
  list() { return Object.keys(this.entries).filter((k) => k !== CHECK_ID).map((id) => ({ id, meta: this.entries[id].meta || {} })); }
  meta(id) { return this.entries[id] ? { ...(this.entries[id].meta || {}) } : null; }
  getBytes(id) { const e = this.entries[id]; if (!e) throw new Error('entry not found: ' + id); return openSealed(entryKey(this.master, this.salt, id), id, e); }
  get(id) { return this.getBytes(id).toString('utf8'); }
}

/** open a vault document with a passphrase (throws on a wrong passphrase) */
export function fromPassphrase(passphrase, doc) {
  const salt = ub64(doc.salt);
  const master = pbkdf2Sync(String(passphrase), salt, PBKDF2_ITERATIONS, 32, 'sha256');
  return new Vault(doc, master);
}

/** open a vault file */
export function openVaultFile(path, passphrase) { return fromPassphrase(passphrase, JSON.parse(readFileSync(path, 'utf8'))); }

/** find the signer's private key: the first entry whose meta.format is 'privateKey' (or `entryId` when given) */
export function signerKeyFrom(vault, entryId) {
  if (entryId) return vault.get(entryId);
  const e = vault.list().find((x) => x.meta && x.meta.format === 'privateKey') || vault.list()[0];
  if (!e) throw new Error('vault holds no private key');
  return vault.get(e.id);
}
