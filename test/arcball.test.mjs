/*! cyborgd — test arcball · (c) 2026 BANKON / PYTHAI · MIT · upstream patterns © oncyberio (MIT) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { project, onSphere, sphericalOf, fromSpherical, reach, shoulderOf, orbit, DEFAULT_RADIUS } from '../core/arcball.mjs';

const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

test('project: inside the radius z = sqrt(r² − x² − y²) (a point on the sphere)', () => {
  for (const [x, y, r] of [[0, 0, 1], [0.3, 0.4, 1], [0.5, 0.5, 1.5], [-0.7, 0.2, 2]]) {
    const p = project([x, y], r);
    assert.ok(onSphere([x, y], r));
    assert.ok(close(p[2], Math.sqrt(r * r - x * x - y * y)), `z for ${x},${y}`);
    assert.ok(close(Math.hypot(...p), r), 'lies on the sphere');
  }
  assert.deepEqual(project([0, 0], 1.5), [0, 0, 1.5]);
});

test('project: outside r²/2 the hyperbolic sheet z = (r²/2)/√(x²+y²), continuous at the seam, → 0 at infinity', () => {
  const r = 1.5, seam = r / Math.SQRT2;
  const inside = project([seam - 1e-7, 0], r), outside = project([seam + 1e-7, 0], r);
  assert.ok(close(inside[2], outside[2], 1e-5), 'C⁰ at the seam');
  assert.ok(!onSphere([seam + 1e-7, 0], r));
  const far = project([100, 100], r); assert.ok(close(far[2], (r * r / 2) / Math.hypot(100, 100)));
  assert.ok(far[2] > 0 && far[2] < 0.01);
  assert.ok(close(project([2, 2], 1.5)[2], (1.5 * 1.5 / 2) / Math.hypot(2, 2)));
  assert.equal(project(['a', undefined], 1)[2], 1, 'garbage in → origin');
});

test('spherical ↔ vector round-trip; yaw 0 faces −z', () => {
  const s = sphericalOf([0, 0, -1]); assert.ok(close(s.yaw, 0) && close(s.pitch, 0));
  assert.ok(close(sphericalOf([1, 0, 0]).yaw, Math.PI / 2));
  assert.ok(close(sphericalOf([0, 1, 0]).pitch, Math.PI / 2));
  for (const [yaw, pitch] of [[0.3, 0.2], [-1.2, 0.7], [2.5, -0.4]]) { const v = fromSpherical(yaw, pitch, 2); const b = sphericalOf(v); assert.ok(close(b.yaw, yaw) && close(b.pitch, pitch) && close(b.len, 2)); }
  assert.deepEqual(sphericalOf([0, 0, 0]), { yaw: 0, pitch: 0, len: 0 });
});

test('reach: extend grows with distance inside r, 0 beyond; yaw/pitch follow the target', () => {
  const sh = [0, 1.35, 0];
  const dead = reach(sh, [0, 1.35, -0.5]); assert.ok(close(dead.extend, 0.5 / DEFAULT_RADIUS, 1e-3)); assert.ok(close(dead.yaw, 0, 1e-3)); assert.ok(close(dead.pitch, 0, 1e-3));
  const far = reach(sh, [0, 1.35, -1.4]); assert.ok(far.extend > dead.extend && far.extend <= 1);
  const beyond = reach(sh, [0, 1.35, -1.6]); assert.equal(beyond.extend, 0); assert.ok(close(beyond.dist, 1.6, 1e-3));
  const right = reach(sh, [0.5, 1.35, -0.5]); assert.ok(right.yaw > 0, 'target to the right → positive yaw');
  const left = reach(sh, [-0.5, 1.35, -0.5]); assert.ok(left.yaw < 0);
  const up = reach(sh, [0, 1.9, -0.5]); assert.ok(up.pitch > 0); const down = reach(sh, [0, 0.9, -0.5]); assert.ok(down.pitch < 0);
  assert.ok(close(right.yaw, -left.yaw, 1e-3), 'symmetric');
  // the agent frame: with agentYaw = π/2 the agent faces +x, so a target at +x is straight ahead
  const turned = reach(sh, [0.5, 1.35, 0], { agentYaw: Math.PI / 2 }); assert.ok(close(turned.yaw, 0, 1e-3));
  assert.deepEqual(Object.keys(reach(sh, sh)), ['extend', 'yaw', 'pitch', 'dist', 'surface']);
});

test('shoulderOf rotates the shoulder offset with the agent yaw', () => {
  const s0 = shoulderOf([0, 0, 0], 0); assert.ok(close(s0[0], 0.22) && close(s0[1], 1.35) && close(s0[2], 0));
  const s90 = shoulderOf([0, 0, 0], Math.PI / 2); assert.ok(close(s90[0], 0, 1e-9) && close(s90[2], -0.22));
  const moved = shoulderOf([3, 1, -2], 0); assert.ok(close(moved[0], 3.22) && close(moved[1], 2.35) && close(moved[2], -2));
});

test('orbit: the rotation between two arcball points (Shoemake); no drag → no rotation', () => {
  const none = orbit([0, 0], [0, 0]); assert.equal(none.angle, 0);
  const o = orbit([0, 0], [0.5, 0], 1); assert.ok(o.angle > 0 && o.angle < Math.PI / 2); assert.ok(close(Math.hypot(...o.axis), 1));
  assert.ok(close(o.axis[1], -1, 1e-9) || close(o.axis[1], 1, 1e-9), 'a horizontal drag rotates about y');
  const q = orbit([0, 0], [1, 0], 1); assert.ok(close(q.angle, Math.acos(0.5 / Math.hypot(1, 0.5))), 'x = r lands on the sheet at z = r/2');
});
