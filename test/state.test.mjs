/*! cyborgd — test state · (c) 2026 BANKON / PYTHAI · MIT · upstream patterns © oncyberio (MIT) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, appendFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Wallet } from '../daemon/ethers.mjs';
import { State, Ledger, Counters, dayKey } from '../daemon/state.mjs';
import { Faucet } from '../daemon/faucet.mjs';
import { VoucherSigner } from '../daemon/voucher.mjs';

const TOK = [{ id: 'luv', chainId: 1, contract: '0x447aE1ACafec942210b8545218a3a5c5C24b3952', token: '0x2711111111683B8708cb9a48cBf36a51315F8254', faucet: 'cyborg-faucet', amount: '1', cooldownSec: 3600, capPerDay: 1, minRung: 'member' }];
const signer = VoucherSigner.random(), user = Wallet.createRandom().address;

test('JSONL ledger: append, replay, bad lines skipped, counters atomic + persisted', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cyborgd-state-'));
  const l = new Ledger(join(dir, 'x.jsonl'));
  l.append({ t: 1, kind: 'a' }); l.append({ kind: 'b' });
  appendFileSync(l.file, 'not json\n');
  const seen = []; assert.equal(l.replay((e) => seen.push(e.kind)), 2); assert.deepEqual(seen, ['a', 'b']); assert.equal(l.skipped, 1);
  assert.ok(l.read()[1].t > 0, 't is stamped when absent');
  const c = new Counters(join(dir, 'c.json')); assert.equal(c.next('nonce'), 1); assert.equal(c.next('nonce'), 2);
  assert.equal(new Counters(join(dir, 'c.json')).get('nonce'), 2, 'persisted before next() returned'); assert.ok(!existsSync(join(dir, 'c.json.tmp')));
  const s = new State(dir); s.saveSpace('my:space', { v: 'cyborg-space/1', id: 'my:space' });
  assert.deepEqual(s.listSpaces(), ['my_space']); assert.equal(s.loadSpace('my:space').id, 'my:space'); assert.equal(s.loadSpace('nope'), null);
  assert.equal(dayKey(Date.parse('2026-09-23T23:59:59Z')), '2026-09-23');
});

test('the faucet ledger survives a restart: cooldown, daily cap, nonce counter and consumed challenges all replay', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cyborgd-state-'));
  let t = Date.parse('2026-09-23T12:00:00Z'); const now = () => t;
  const f1 = new Faucet({ tokens: TOK, signer, state: new State(dir), now, bits: 8 });
  const ch = f1.challenge(); assert.equal(f1.challenges.size, 1);
  const { voucher } = await f1.dripForEffect({ token: 'luv', address: user, sub: user, rung: 2 });
  const lines = readFileSync(join(dir, 'faucet.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((e) => e.kind), ['challenge', 'drip']); assert.equal(lines[1].nonce, voucher.nonce); assert.equal(lines[1].address, user.toLowerCase());
  // "restart": a fresh Faucet over the same state dir
  const f2 = new Faucet({ tokens: TOK, signer, state: new State(dir), now, bits: 8 });
  assert.equal(f2.drips, 1); assert.equal(f2.challenges.size, 1, 'a live challenge is still live');
  const st = f2.status(user); assert.equal(st.cooldowns.luv.today, 1); assert.equal(st.cooldowns.luv.retryAfterSec, 3600); assert.equal(st.last[0].nonce, voucher.nonce);
  await assert.rejects(f2.dripForEffect({ token: 'luv', address: user, sub: user, rung: 2 }), (e) => e.code === 'cooldown');
  assert.equal(f2.challenges.consume(ch.challenge, 'x'), 'proof of work insufficient', 'still known after restart');
  f2.challenges.consume(ch.challenge, (await import('../daemon/pow.mjs')).solvePow(ch.challenge, 8));
  const f3 = new Faucet({ tokens: TOK, signer, state: new State(dir), now, bits: 8 });
  assert.equal(f3.challenges.consume(ch.challenge, '0'), 'challenge already used', 'consumption replays');
  t += 3601_000; await assert.rejects(f3.dripForEffect({ token: 'luv', address: user, sub: user, rung: 2 }), (e) => e.code === 'daily-cap');
  t = Date.parse('2026-09-24T12:00:00Z');
  const v2 = (await f3.dripForEffect({ token: 'luv', address: user, sub: user, rung: 2 })).voucher;
  assert.notEqual(v2.nonce, voucher.nonce); assert.equal(new Counters(join(dir, 'counters.json')).get('nonce'), 2, 'the counter never reuses a value');
});
