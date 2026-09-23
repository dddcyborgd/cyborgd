#!/usr/bin/env node
/*! cyborgd — build-core · (c) 2026 BANKON / PYTHAI · MIT · upstream patterns © oncyberio (MIT) */
// dist/cyborgd-core.js: the isomorphic core as ONE browser file — `window.CyborgdCore` — with no
// bundler. core/ files only import each other, so a simple transform suffices: every module becomes a
// function body in a tiny module shim; `import { a, b as c } from './x.mjs'` lines become
// destructuring from the shim's registry, `export` keywords are stripped and the names collected.
// Namespace re-exports (`export * as x from`) and named re-exports (`export { a } from`) are handled
// in core/index.mjs only. Verified by evaluating the output in a `vm` context with only `window`.
//
//   node scripts/build-core.mjs [--check]     → dist/cyborgd-core.js + dist/MANIFEST.json
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CORE = join(ROOT, 'core');
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

/** parse a core module: returns { imports:[{names,from}], namespaces:[{alias,from}], reexports:[{names,from}], body, exports:[] } */
export function transformModule(src, name) {
  const imports = [], namespaces = [], reexports = [], exportsList = [];
  let body = src;
  // import { a, b as c } from './x.mjs';
  body = body.replace(/^import\s*\{([^}]*)\}\s*from\s*'\.\/([a-z0-9-]+)\.mjs';?\s*$/gm, (_, names, from) => { imports.push({ names: names.split(',').map((s) => s.trim()).filter(Boolean), from }); return ''; });
  // export * as x from './x.mjs';
  body = body.replace(/^export\s*\*\s*as\s+([A-Za-z0-9_$]+)\s+from\s*'\.\/([a-z0-9-]+)\.mjs';?\s*$/gm, (_, alias, from) => { namespaces.push({ alias, from }); return ''; });
  // export { a, b } from './x.mjs';
  body = body.replace(/^export\s*\{([^}]*)\}\s*from\s*'\.\/([a-z0-9-]+)\.mjs';?\s*$/gm, (_, names, from) => { reexports.push({ names: names.split(',').map((s) => s.trim()).filter(Boolean), from }); return ''; });
  // export { a, b };  (local)
  body = body.replace(/^export\s*\{([^}]*)\};?\s*$/gm, (_, names) => { for (const n of names.split(',').map((s) => s.trim()).filter(Boolean)) exportsList.push(n.includes(' as ') ? n.split(' as ')[1].trim() + ':' + n.split(' as ')[0].trim() : n); return ''; });
  // export default X;
  body = body.replace(/^export\s+default\s+([A-Za-z0-9_$]+);?\s*$/gm, (_, n) => { exportsList.push('default:' + n); return ''; });
  // export const|let|var|function|class|async function NAME
  body = body.replace(/^export\s+(const|let|var|function|class|async function)\s+([A-Za-z0-9_$]+)/gm, (_, kind, n) => { exportsList.push(n); return kind + ' ' + n; });
  if (/^\s*(import|export)\b/m.test(body)) throw new Error(name + ': an import/export form the shim does not handle survived the transform');
  if (/\bnode:|\bprocess\.|\bBuffer\.|\brequire\(/.test(body.replace(/\/\/.*$/gm, ''))) throw new Error(name + ': core must not reference node:, process, Buffer or require');
  return { imports, namespaces, reexports, exports: exportsList, body };
}

export function build() {
  const files = readdirSync(CORE).filter((f) => f.endsWith('.mjs')).sort((a, b) => (a === 'index.mjs' ? 1 : b === 'index.mjs' ? -1 : a.localeCompare(b)));
  const mods = files.map((f) => ({ name: f.slice(0, -4), file: f, src: readFileSync(join(CORE, f), 'utf8') })).map((m) => ({ ...m, ...transformModule(m.src, m.file), sha256: createHash('sha256').update(m.src).digest('hex') }));
  // dependency order (topological; core is small, a simple repeated pass suffices)
  const order = []; const pending = [...mods];
  while (pending.length) {
    const before = pending.length;
    for (let i = 0; i < pending.length; i++) {
      const m = pending[i]; const deps = [...m.imports, ...m.namespaces, ...m.reexports].map((d) => d.from);
      if (deps.every((d) => order.some((o) => o.name === d))) { order.push(m); pending.splice(i, 1); i--; }
    }
    if (pending.length === before) throw new Error('circular import among core modules: ' + pending.map((p) => p.name).join(', '));
  }
  let out = `/*! cyborgd-core ${PKG.version} — the isomorphic core of cyborgd (github.com/dddcyborgd/cyborgd) · (c) 2026 BANKON / PYTHAI · MIT · upstream patterns © oncyberio (MIT) · built by scripts/build-core.mjs */\n`;
  out += `(function (root) {\n  'use strict';\n  var __mods = {};\n  function __get(n) { if (!__mods[n]) throw new Error('cyborgd-core: unknown module ' + n); return __mods[n]; }\n`;
  for (const m of order) {
    out += `\n  // ── core/${m.file} ──\n  __mods[${JSON.stringify(m.name)}] = (function () {\n    var __exports = {};\n`;
    for (const im of m.imports) { const parts = im.names.map((n) => (n.includes(' as ') ? n.split(' as ')[1].trim() + ' = __get("' + im.from + '").' + n.split(' as ')[0].trim() : n + ' = __get("' + im.from + '").' + n)); out += `    var ${parts.join(', ')};\n`; }
    for (const ns of m.namespaces) out += `    __exports[${JSON.stringify(ns.alias)}] = __get(${JSON.stringify(ns.from)});\n`;
    out += m.body.split('\n').map((l) => (l.trim() ? '    ' + l : '')).join('\n') + '\n';
    for (const re of m.reexports) for (const n of re.names) { const [orig, alias] = n.includes(' as ') ? n.split(' as ').map((s) => s.trim()) : [n, n]; out += `    __exports[${JSON.stringify(alias)}] = __get(${JSON.stringify(re.from)}).${orig};\n`; }
    for (const e of m.exports) { const [alias, orig] = e.includes(':') ? e.split(':') : [e, e]; out += `    __exports[${JSON.stringify(alias)}] = ${orig};\n`; }
    out += `    return __exports;\n  })();\n`;
  }
  out += `\n  var core = __mods.index; core.modules = __mods; core.BUILD = ${JSON.stringify({ version: PKG.version, files: order.map((m) => m.file) })};\n`;
  out += `  if (typeof module !== 'undefined' && module.exports) module.exports = core;\n  root.CyborgdCore = core;\n})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));\n`;
  const manifest = { $schema: 'cyborgd/core-manifest.v1', version: PKG.version, global: 'CyborgdCore', file: 'cyborgd-core.js', bytes: Buffer.byteLength(out), sha256: createHash('sha256').update(out).digest('hex'),
    modules: order.map((m) => ({ name: m.name, file: 'core/' + m.file, sha256: m.sha256, exports: m.exports.map((e) => e.split(':')[0]).concat(m.namespaces.map((n) => n.alias)).concat(m.reexports.flatMap((r) => r.names.map((n) => (n.includes(' as ') ? n.split(' as ')[1].trim() : n)))) })) };
  return { js: out, manifest };
}

/** evaluate the bundle in a context with only `window` — the isomorphism proof */
export function verify(js) {
  const window = {};
  const ctx = vm.createContext({ window });
  vm.runInContext(js, ctx, { filename: 'cyborgd-core.js', timeout: 5000 });
  const core = window.CyborgdCore;
  if (!core || typeof core.createRoom !== 'function' || typeof core.triadStep !== 'function' || typeof core.project !== 'function') throw new Error('bundle did not expose the core API');
  // a tiny functional probe: a room with a loopback pair, a triad step, an arcball projection
  const room = core.createRoom({ id: 'probe' }, { now: () => 0 });
  const [a, b] = core.LoopbackTransport.pair(); const got = []; b.onMessage((m) => got.push(m));
  room.join(a, { rung: 2 }, { name: 'probe' });
  if (got[0]?.type !== 'welcome') throw new Error('bundle room did not welcome');
  const r = core.triadStep(core.emptyTriad(), { type: 'join', space: 'x', sid: 'a', rung: 2, t: 0 });
  if (r.state.spaces.x.host !== 'a') throw new Error('bundle triad did not elect');
  if (Math.abs(core.project([0, 0], 2)[2] - 2) > 1e-9) throw new Error('bundle arcball wrong');
  return { exports: Object.keys(core).length, modules: Object.keys(core.modules) };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const CHECK = process.argv.includes('--check');
  const { js, manifest } = build();
  const v = verify(js);
  const dist = join(ROOT, 'dist');
  if (CHECK) { let cur = ''; try { cur = readFileSync(join(dist, 'cyborgd-core.js'), 'utf8'); } catch (e) { /* none */ } console.log(cur === js ? 'build-core --check: ok' : 'build-core --check: dist/cyborgd-core.js would change'); process.exit(cur === js ? 0 : 1); }
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(dist, 'cyborgd-core.js'), js);
  writeFileSync(join(dist, 'MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`build-core: dist/cyborgd-core.js ${manifest.bytes} bytes · ${manifest.modules.length} modules · ${v.exports} exports · verified in vm with only window`);
}
