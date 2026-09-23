#!/usr/bin/env node
/*
 * fetch-upstream.mjs — vendor upstream sources by pinned commit, one tarball per repo (rate-limit kind).
 *
 * Reads  archive/SOURCES.plan.json  : [{ repo, sha, ref, license, paths[], skip[] }]
 * Writes archive/<repo>/<path>       : the vendored subtrees (byte-identical to upstream)
 *        archive/SOURCES.json        : { repo, sha, ref, license, tarballSha256, fetchedAt, paths, files }
 *
 * Clean-room policy (DeltaVerse / dddcyborgd): take the code in, keep it local, attribute it.
 * Never a runtime dependency; never a CDN. Tarballs are cached in ~/.cache/dddcyborgd/.
 *
 *   node scripts/fetch-upstream.mjs            fetch anything missing / changed
 *   node scripts/fetch-upstream.mjs --check    verify SOURCES.json matches the plan (CI gate, no network)
 *
 * (c) 2026 BANKON / PYTHAI · MIT · upstream © oncyberio (MIT) and others as recorded per entry.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, rmSync, cpSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir, homedir } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ARCHIVE = join(ROOT, 'archive');
const PLAN = join(ARCHIVE, 'SOURCES.plan.json');
const OUT = join(ARCHIVE, 'SOURCES.json');
const CACHE = join(homedir(), '.cache', 'dddcyborgd');
const CHECK = process.argv.includes('--check');

const plan = JSON.parse(readFileSync(PLAN, 'utf8'));
const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { sources: [] };

function sha256(buf) { return createHash('sha256').update(buf).digest('hex'); }
function walk(dir) { const out = []; if (!existsSync(dir)) return out; for (const e of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, e.name); if (e.isDirectory()) out.push(...walk(p)); else out.push(p); } return out; }

async function download(url, dest) {
  const res = await fetch(url, { headers: { 'user-agent': 'dddcyborgd-fetch-upstream' } });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, buf);
  return buf;
}

if (CHECK) {
  let bad = 0;
  for (const p of plan) {
    const got = prev.sources.find((s) => s.repo === p.repo);
    if (!got || got.sha !== p.sha) { console.error(`STALE ${p.repo}: want ${p.sha} have ${got ? got.sha : 'none'}`); bad++; continue; }
    const files = walk(join(ARCHIVE, p.repo.split('/')[1])).length;
    if (files !== got.files) { console.error(`STALE ${p.repo}: ${files} files on disk, ${got.files} recorded`); bad++; }
  }
  console.log(bad ? `fetch-upstream --check: ${bad} stale` : `fetch-upstream --check: ok (${plan.length} sources)`);
  process.exit(bad ? 1 : 0);
}

const sources = [];
for (const p of plan) {
  const [owner, name] = p.repo.split('/');
  const dest = join(ARCHIVE, name);
  const have = prev.sources.find((s) => s.repo === p.repo);
  if (have && have.sha === p.sha && existsSync(dest) && walk(dest).length === have.files) { console.log(`= ${p.repo}@${p.sha.slice(0, 7)} up to date (${have.files} files)`); sources.push(have); continue; }

  const tgz = join(CACHE, `${name}-${p.sha}.tar.gz`);
  let buf;
  if (existsSync(tgz)) { buf = readFileSync(tgz); console.log(`~ ${p.repo}: cached tarball`); }
  else { const url = `https://codeload.github.com/${owner}/${name}/tar.gz/${p.sha}`; console.log(`↓ ${url}`); buf = await download(url, tgz); }
  const tarballSha256 = sha256(buf);

  const tmp = join(tmpdir(), `dddcyborgd-${name}-${process.pid}`);
  rmSync(tmp, { recursive: true, force: true }); mkdirSync(tmp, { recursive: true });
  execFileSync('tar', ['-xzf', tgz, '-C', tmp]);
  const top = readdirSync(tmp)[0];
  const src = join(tmp, top);

  rmSync(dest, { recursive: true, force: true }); mkdirSync(dest, { recursive: true });
  const skip = (p.skip || []).map((s) => new RegExp(s));
  let files = 0;
  for (const rel of p.paths) {
    const from = join(src, rel);
    if (!existsSync(from)) { console.warn(`  ! missing upstream path ${rel}`); continue; }
    const to = join(dest, rel);
    if (statSync(from).isDirectory()) {
      mkdirSync(to, { recursive: true });
      cpSync(from, to, { recursive: true, filter: (s) => !skip.some((re) => re.test(s.slice(src.length))) && !/node_modules/.test(s) });
    } else { mkdirSync(dirname(to), { recursive: true }); cpSync(from, to); }
  }
  files = walk(dest).length;
  rmSync(tmp, { recursive: true, force: true });
  const rec = { repo: p.repo, sha: p.sha, ref: p.ref, license: p.license, upstream: `https://github.com/${p.repo}/tree/${p.sha}`, tarballSha256, fetchedAt: new Date().toISOString(), paths: p.paths, skip: p.skip || [], files, note: p.note || '' };
  sources.push(rec);
  console.log(`✓ ${p.repo}@${p.sha.slice(0, 7)} → archive/${name} (${files} files)`);
}
writeFileSync(OUT, JSON.stringify({ $schema: 'dddcyborgd/sources.v1', generatedBy: 'scripts/fetch-upstream.mjs', sources }, null, 2) + '\n');
console.log(`wrote archive/SOURCES.json (${sources.length} sources)`);
