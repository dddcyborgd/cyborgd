/*! cyborgd — field.test · the field of influence policy · (c) 2026 BANKON / PYTHAI · MIT */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { policyFor, degree, atBound, visibleTo, normalise } from '../core/field.mjs';
import { createRoom, setFieldPolicy } from '../core/rooms.mjs';
import { LoopbackTransport } from '../core/transport.mjs';
const table = JSON.parse(readFileSync(new URL('../registries/field-policy.json', import.meta.url), 'utf8'));
test('the hierarchy holds two dials per rung: outflow rises, inflow falls', () => {
  assert.ok(policyFor(table, 'participant').outflow < policyFor(table, 'member').outflow);
  assert.ok(policyFor(table, 'overlord').outflow === 1 && policyFor(table, 'overlord').inflow < policyFor(table, 'participant').inflow);
  assert.deepEqual(policyFor(table, 'nobody'), policyFor(table, 'participant'));
});
test('the DeltaVerse always recognises a field: degree = r/max × outflow; the bound is max (extent − 1)', () => {
  assert.equal(degree({ r: 34.5, max: 69 }, { outflow: 1 }), 0.5);
  assert.equal(degree({ r: 69, max: 69 }, policyFor(table, 'participant')), 0.15);
  assert.equal(atBound({ r: 68.6, max: 69 }), true); assert.equal(atBound({ r: 60, max: 69 }), false);
});
test('visibility: open to all · connected to links · private to nobody else', () => {
  assert.equal(visibleTo({ mode: 'open' }, 'a', 'b'), true);
  assert.equal(visibleTo({ mode: 'connected', links: ['b'] }, 'a', 'b'), true);
  assert.equal(visibleTo({ mode: 'connected', links: [] }, 'a', 'b'), false);
  assert.equal(visibleTo({ mode: 'private' }, 'a', 'b'), false);
  assert.equal(visibleTo({ mode: 'private' }, 'a', 'a'), true);
});
test('private needs a signature: a presence-only participant falls back to open', () => {
  assert.equal(normalise({ r: 1, max: 9, mode: 'private' }, { rung: 'participant', signed: false }, table).mode, 'open');
  assert.equal(normalise({ r: 1, max: 9, mode: 'private' }, { rung: 'member', signed: true }, table).mode, 'private');
  assert.equal(normalise({ r: 1, max: 9 }, { rung: 'member', signed: true }, table).mode, 'connected');
});
test('room: welcome carries the policy + fieldMax; open fields ride the snapshot, connected ones reach only their links', () => {
  setFieldPolicy(table);
  const room = createRoom({ id: 'f', zones: [{ id: 'all', minRole: 'participant', bounds: { c: [0, 0, 0], r: 40 } }] }, { now: () => 1000 });
  const [a, ra] = LoopbackTransport.pair(), [b, rb] = LoopbackTransport.pair();
  const got = { a: [], b: [] }; ra.onMessage((m) => got.a.push(m)); rb.onMessage((m) => got.b.push(m));
  const ja = room.join(a, { rung: 2, sub: '0xA' }, { name: 'alice' }), jb = room.join(b, { rung: 2, sub: '0xB' }, { name: 'bob' });
  const wa = got.a.find((m) => m.type === 'welcome');
  assert.equal(wa.fieldMax, 39, 'extent − 1'); assert.deepEqual(wa.policy, policyFor(table, 'member'));
  const sidA = wa.sessionId, sidB = got.b.find((m) => m.type === 'welcome').sessionId;
  room.handle(sidA, { type: 'event', name: 'field', data: { r: 5, max: 39 } });            // member default: connected, no links
  room.tick();
  const snapB = got.b.filter((m) => m.type === 'snap').pop();
  assert.equal(snapB.players[sidA] && snapB.players[sidA].field, undefined, 'connected field without links is not on the wire');
  room.handle(sidA, { type: 'event', name: 'field', data: { r: 6, max: 39, mode: 'connected', links: [sidB] } });
  room.tick();
  assert.ok(got.b.some((m) => m.type === 'msg' && m.data && m.data.field && m.data.field.r === 6), 'the link receives the field');
  room.handle(sidA, { type: 'event', name: 'field', data: { r: 7, max: 99, mode: 'open' } });   // max clamped to the bound
  room.tick();
  const open = got.b.filter((m) => m.type === 'snap').pop().players[sidA].field;
  assert.deepEqual(open, { r: 7, max: 39, mode: 'open' });
  void ja; void jb;
});
