#!/usr/bin/env node
/*
 * library.mjs — the dvengine catalogue generator (mirror of DeltaVerse scripts/oncyber-awe.mjs).
 *
 * Walks the repo and emits registry.json + LIBRARY.md: every ported lane (engine/ components/ edit/ editors/
 * net/ xr/ verse/ transform/ studio/ legacy/) and every vendored upstream file under archive/ with a port
 * verdict. Also regenerates components/registry.json from the folder-is-module tree.
 *
 *   node scripts/library.mjs [--check]        (--check: exit 1 if registry.json would change)
 *
 * (c) 2026 BANKON / PYTHAI · dddcyborgd · MIT
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname, relative, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const NAME = PKG.name.split('/').pop();

function walk(dir, out = []) { if (!existsSync(dir)) return out; for (const e of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, e.name); if (e.name === 'node_modules' || e.name === '.git') continue; if (e.isDirectory()) walk(p, out); else out.push(p); } return out; }
const rel = (p) => relative(ROOT, p).split('\\').join('/');
const lines = (p) => { try { return readFileSync(p, 'utf8').split('\n').length; } catch { return 0; } };
const bytes = (p) => { try { return statSync(p).size; } catch { return 0; } };

// ---- lanes: the ported code ------------------------------------------------------------------
const LANES = {
  dvengine: ['engine', 'components', 'edit', 'editors', 'net', 'xr', 'verse', 'legacy', 'studio', 'transform', 'scripts', 'test'],
  cyborgd: ['core', 'daemon', 'registries', 'ops', 'scripts', 'test', 'skills'],
}[NAME] || ['scripts', 'test'];
const CODE = /\.(m?js|html|css|json|sol)$/;
function firstLine(p) { try { const s = readFileSync(p, 'utf8'); const m = /\/\*!?\s*\n?\s*\*?\s*([^\n]*)/.exec(s); return (m ? m[1] : '').replace(/^\*\s*/, '').trim().slice(0, 160); } catch { return ''; } }
function globalsOf(p) { try { const s = readFileSync(p, 'utf8'); const g = new Set(); let m; const re = /global\.(DV[A-Za-z0-9]+|Cyborgd[A-Za-z0-9]*|AweRuntime)\s*=/g; while ((m = re.exec(s))) g.add(m[1]); return [...g]; } catch { return []; } }
const lanes = [];
for (const lane of LANES) {
  const dir = join(ROOT, lane); if (!existsSync(dir)) continue;
  const files = walk(dir).filter((p) => CODE.test(p) && !p.endsWith('.js.xml')).map((p) => ({ path: rel(p), lines: lines(p), bytes: bytes(p), globals: globalsOf(p), banner: firstLine(p) }));
  lanes.push({ lane, files: files.length, lines: files.reduce((a, f) => a + f.lines, 0), globals: [...new Set(files.flatMap((f) => f.globals))], entries: files });
}

// ---- components: folder-is-module registry --------------------------------------------------
let components = null;
if (existsSync(join(ROOT, 'components'))) {
  const seed = existsSync(join(ROOT, 'components', 'manifest.json')) ? JSON.parse(readFileSync(join(ROOT, 'components', 'manifest.json'), 'utf8')) : { components: [] };
  const seedMap = Object.fromEntries((seed.components || []).map((c) => [c.type, c]));
  const types = readdirSync(join(ROOT, 'components'), { withFileTypes: true }).filter((e) => e.isDirectory() && existsSync(join(ROOT, 'components', e.name, 'index.js'))).map((e) => e.name).sort();
  components = types.map((type) => {
    const p = join(ROOT, 'components', type, 'index.js'); const s = readFileSync(p, 'utf8');
    const props = [...new Set([...s.matchAll(/props\.([a-zA-Z0-9_]+)/g)].map((m) => m[1]))].sort();
    const upstream = /awe port/.test(s) || (seedMap[type] && seedMap[type].upstream === 'awe') ? 'awe' : 'deltaverse-native';
    return { type, file: `${type}/index.js`, lines: lines(p), props, upstream, lazy: true,
      link: upstream === 'awe' ? `https://github.com/oncyberio/awe/tree/main/packages/engine/src/space/components/${type}` : 'https://github.com/dddcyborgd/dvengine' };
  });
  const regPath = join(ROOT, 'components', 'registry.json');
  const reg = JSON.stringify({ $schema: 'dddcyborgd/components.v1', generatedBy: 'scripts/library.mjs', count: components.length, components }, null, 2) + '\n';
  if (!CHECK) writeFileSync(regPath, reg);
}

// ---- archive: vendored upstream with port verdicts ------------------------------------------
const sources = existsSync(join(ROOT, 'archive', 'SOURCES.json')) ? JSON.parse(readFileSync(join(ROOT, 'archive', 'SOURCES.json'), 'utf8')).sources : [];
const PORTS = JSON.parse(existsSync(join(ROOT, 'scripts', 'ports.json')) ? readFileSync(join(ROOT, 'scripts', 'ports.json'), 'utf8') : '[]');
function verdictFor(p) { for (const r of PORTS) if (new RegExp(r.match).test(p)) return r; return { verdict: 'catalogued', portedTo: '' }; }
const archive = sources.map((s) => {
  const name = s.repo.split('/')[1]; const dir = join(ROOT, 'archive', name);
  const files = walk(dir).map((p) => { const r = rel(p); const v = verdictFor(r); return { path: r, lines: lines(p), verdict: v.verdict, portedTo: v.portedTo || '' }; });
  const tally = {}; for (const f of files) tally[f.verdict] = (tally[f.verdict] || 0) + 1;
  return { repo: s.repo, sha: s.sha, license: s.license, upstream: s.upstream, files: files.length, lines: files.reduce((a, f) => a + f.lines, 0), tally, entries: files };
});

const registry = { $schema: `dddcyborgd/${NAME}-registry.v1`, name: PKG.name, version: PKG.version, generatedBy: 'scripts/library.mjs', home: `https://github.com/dddcyborgd/${NAME}`,
  upstream: { org: 'https://github.com/oncyberio', product: 'https://oncyber.io', docs: 'https://docs.oncyber.io' },
  lanes: lanes.map(({ entries, ...l }) => l), components: components ? components.length : 0, archive: archive.map(({ entries, ...a }) => a),
  detail: { lanes, archive } };
const regText = JSON.stringify(registry, null, 2) + '\n';
const regPath = join(ROOT, 'registry.json');
if (CHECK) { const cur = existsSync(regPath) ? readFileSync(regPath, 'utf8') : ''; const same = cur.replace(/"generatedAt"[^\n]*\n/, '') === regText.replace(/"generatedAt"[^\n]*\n/, ''); console.log(same ? 'library --check: ok' : 'library --check: registry.json would change'); process.exit(same ? 0 : 1); }
writeFileSync(regPath, regText);

// ---- LIBRARY.md -----------------------------------------------------------------------------
let md = `# ${NAME} — LIBRARY (generated by scripts/library.mjs)\n\nHome: ${registry.home} · upstream: ${registry.upstream.org} (MIT) · product: ${registry.upstream.product} · docs: ${registry.upstream.docs}\n\n## Lanes (the ported code)\n\n| lane | files | lines | globals |\n|---|---:|---:|---|\n`;
for (const l of lanes) md += `| \`${l.lane}/\` | ${l.files} | ${l.lines} | ${l.globals.map((g) => '`' + g + '`').join(' ') || '—'} |\n`;
if (components) { md += `\n## Components (folder-is-module · \`components/<type>/index.js\`) — ${components.length}\n\n| type | props | lines | upstream |\n|---|---|---:|---|\n`; for (const c of components) md += `| \`${c.type}\` | ${c.props.map((p) => '`' + p + '`').join(' ')} | ${c.lines} | [${c.upstream}](${c.link}) |\n`; }
md += `\n## Archive (vendored upstream, pinned by sha)\n\n| repo | sha | license | files | lines | verdicts |\n|---|---|---|---:|---:|---|\n`;
for (const a of archive) md += `| [${a.repo}](${a.upstream}) | \`${a.sha.slice(0, 7)}\` | ${a.license} | ${a.files} | ${a.lines} | ${Object.entries(a.tally).map(([k, v]) => `${k} ${v}`).join(' · ')} |\n`;
md += `\n### Port map\n\n| upstream | verdict | ported to |\n|---|---|---|\n`;
for (const r of PORTS) md += `| \`${r.match}\` | ${r.verdict} | ${r.portedTo || '—'} |\n`;
md += `\nVerdicts: **ported** = a clean-room DV module exists · **partial** = subset ported, rest catalogued · **catalogued** = kept as reference · **reference** = pins/licence/docs only.\n`;
writeFileSync(join(ROOT, 'LIBRARY.md'), md);
console.log(`library: ${lanes.length} lanes · ${components ? components.length : 0} components · ${archive.length} archive repos → registry.json + LIBRARY.md`);
