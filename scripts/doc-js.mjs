#!/usr/bin/env node
/*
 * doc-js.mjs — the .js.xml sidecar generator (port of DeltaVerse scripts/doc-js-layer.mjs, repo-agnostic).
 *
 * Every git-tracked .js/.mjs outside archive/ and vendor/ gets a <path>.xml <doc> next to it. The tool OWNS
 * exactly: <doc for>, <lane>, <kind>, <github sha> (content-addressed blob sha of the bytes on disk) and the
 * <migration> attributes. <how> and <why> prose belongs to the author: seeded once, never rewritten.
 *
 *   node scripts/doc-js.mjs           write / refresh sidecars
 *   node scripts/doc-js.mjs --check   verify (exit 1 if a sidecar is missing or its sha is stale)
 *
 * (c) 2026 BANKON / PYTHAI · MIT
 */
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');
const RULES = JSON.parse(readFileSync(join(ROOT, 'scripts', 'doc-js.rules.json'), 'utf8'));

function blobSha(buf) { return createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex'); }
function tracked() {
  return execSync('git ls-files -z', { cwd: ROOT }).toString().split('\0').filter((p) => /\.(m?js)$/.test(p) && !/^(archive|vendor|dist|node_modules)\//.test(p));
}
function classify(p) { for (const r of RULES.rules) if (new RegExp(r.match).test(p)) return r; return RULES.default; }
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function sidecar(p, sha, c) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<doc for="${esc(p)}" repo="${esc(RULES.repo)}" generatedBy="scripts/doc-js.mjs">\n  <lane>${esc(c.lane)}</lane>\n  <kind>${esc(c.kind)}</kind>\n  <github sha="${sha}" upstream="${esc(RULES.upstream || '')}"/>\n  <migration target="${esc(c.target || 'stays-js')}" status="${esc(c.status || 'prototype')}">\n    <how>${esc(c.how || '')}</how>\n    <why>${esc(c.why || '')}</why>\n  </migration>\n</doc>\n`;
}
function refresh(xml, p, sha, c) {
  return xml
    .replace(/<doc for="[^"]*"/, `<doc for="${esc(p)}"`)
    .replace(/<lane>[^<]*<\/lane>/, `<lane>${esc(c.lane)}</lane>`)
    .replace(/<kind>[^<]*<\/kind>/, `<kind>${esc(c.kind)}</kind>`)
    .replace(/<github sha="[^"]*"/, `<github sha="${sha}"`)
    .replace(/<migration target="[^"]*" status="[^"]*">/, `<migration target="${esc(c.target || 'stays-js')}" status="${esc(c.status || 'prototype')}">`);
}
let missing = 0, stale = 0, written = 0, ok = 0;
for (const p of tracked()) {
  const abs = join(ROOT, p), xmlPath = abs + '.xml';
  const sha = blobSha(readFileSync(abs));
  const c = classify(p);
  if (!existsSync(xmlPath)) { if (CHECK) { console.error(`MISSING ${p}.xml`); missing++; } else { writeFileSync(xmlPath, sidecar(p, sha, c)); written++; } continue; }
  const cur = readFileSync(xmlPath, 'utf8');
  const next = refresh(cur, p, sha, c);
  if (next !== cur) { if (CHECK) { console.error(`STALE ${p}.xml`); stale++; } else { writeFileSync(xmlPath, next); written++; } } else ok++;
}
console.log(CHECK ? `doc:js --check: ${ok} ok · ${missing} missing · ${stale} stale` : `doc:js: ${written} written · ${ok} unchanged`);
process.exit(CHECK && (missing || stale) ? 1 : 0);
