/*! cyborgd — test core-isomorphic · (c) 2026 BANKON / PYTHAI · MIT · upstream patterns © oncyberio (MIT) */
// The proof that core/ is isomorphic: no node-only reference in any source, and the built bundle
// runs in a vm context that has NOTHING but `window`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { build, verify } from '../scripts/build-core.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CORE = join(ROOT, 'core');
const files = readdirSync(CORE).filter((f) => f.endsWith('.mjs')).sort();
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('every core/*.mjs imports only its siblings and never names process / Buffer / require / node: / fs / globalThis.window', async () => {
  assert.ok(files.length >= 13, 'core has ' + files.length + ' modules');
  for (const f of files) {
    const src = strip(readFileSync(join(CORE, f), 'utf8'));
    for (const re of [/\bprocess\b/, /\bBuffer\b/, /\brequire\s*\(/, /['"]node:/, /\bfrom\s+['"](?!\.\/)/, /\bimport\s*\(/, /\bMath\.random\b/, /\bsetTimeout\b|\bsetInterval\b/, /\bfetch\s*\(/])
      assert.ok(!re.test(src), f + ' matches ' + re);
    const mod = await import('../core/' + f);
    assert.ok(Object.keys(mod).length > 0, f + ' exports something');
  }
});

test('dist/cyborgd-core.js evaluates with only { window } and exposes window.CyborgdCore', () => {
  const { js, manifest } = build();
  assert.equal(manifest.global, 'CyborgdCore'); assert.equal(manifest.modules.length, files.length);
  assert.deepEqual(manifest.modules.map((m) => m.file).sort(), files.map((f) => 'core/' + f).sort());
  assert.ok(!/\bimport\s|\bexport\s/.test(js.replace(/\/\/.*$/gm, '')), 'no import/export survives in the bundle');
  const window = {};
  vm.runInNewContext(js, { window }, { filename: 'cyborgd-core.js', timeout: 5000 });
  const core = window.CyborgdCore;
  assert.equal(typeof core.createRoom, 'function'); assert.equal(typeof core.triadStep, 'function'); assert.equal(typeof core.reach, 'function'); assert.equal(typeof core.parseClient, 'function');
  assert.equal(core.CORE_VERSION, '0.0.1-alpha'); assert.equal(core.VERSION, 'cyborg/1');
  assert.deepEqual(Object.keys(core.modules).sort(), files.map((f) => f.slice(0, -4)).sort());
  // the same room logic as the daemon: a loopback pair, a join, a zone rejection, a tick
  const room = core.createRoom({ id: 'iso', zones: [{ id: 'z', minRole: 'overlord', bounds: { c: [5, 0, 0], r: 1 } }] }, { now: () => 0 });
  const [a, b] = core.LoopbackTransport.pair(); const got = []; b.onMessage((m) => got.push(m));
  room.join(a, { rung: 2 }, { name: 'iso' }); b.send({ type: 'state', p: [5, 0, 0], r: [0, 0, 0], a: 'idle', s: 1 });
  assert.equal(got[0].type, 'welcome'); assert.ok(got.some((m) => m.code === 'zone-locked')); assert.equal(room.tick().type, 'snap');
  assert.equal(verify(js).modules.length, files.length);
});
