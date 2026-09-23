/*! cyborgd — item.test · (c) 2026 BANKON / PYTHAI · MIT */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseClient, EVENT_NAMES, GESTURES, ITEM_ACTIONS } from '../core/protocol.mjs';
const validate = (m) => parseClient(JSON.stringify(m));
import { GESTURE_ANIM, ITEM_LINES } from '../core/aivatar.mjs';
test('item event validates (sphere of influence: sceptre raise/use/lower/select)', () => {
  assert.ok(EVENT_NAMES.includes('item'));
  for (const action of ITEM_ACTIONS) assert.equal(validate({ type: 'event', name: 'item', data: { name: 'sceptre', action } }).ok, true, action);
  assert.equal(validate({ type: 'event', name: 'item', data: { name: 'sceptre', action: 'throw' } }).ok, false);
});
test('the new gestures are accepted and have an animation + a line', () => {
  for (const g of ['greet', 'wave', 'point', 'raise', 'bow']) {
    assert.ok(GESTURES.includes(g), g);
    assert.equal(validate({ type: 'event', name: 'gesture', data: { name: g } }).ok, true, g);
    assert.ok(GESTURE_ANIM[g], g + ' anim');
  }
  assert.ok(ITEM_LINES.raise.includes('{item}'));
});
test('field event: r within [0,max]; the bound is one short of everything', () => {
  assert.equal(validate({ type: 'event', name: 'field', data: { r: 5, max: 69 } }).ok, true);
  assert.equal(validate({ type: 'event', name: 'field', data: { r: 70, max: 69 } }).ok, false, 'a field cannot exceed its bound');
});
