/*! cyborgd — arcball · (c) 2026 BANKON / PYTHAI · MIT · upstream patterns © oncyberio (MIT) */
// The arcball: a 2D point → a point on a unit-ish sphere of radius r, with a hyperbolic sheet outside
// the sphere so the mapping is continuous to infinity. This is the same construction three.js
// ArcballControls uses (unprojectOnTbSurface — https://threejs.org/examples/#misc_controls_arcball,
// after Ken Shoemake's "ARCBALL" 1992 and Holroyd's hybrid sphere/hyperbola):
//
//     inside  (x² + y² ≤ r²/2):  z = √(r² − x² − y²)          the sphere
//     outside (x² + y² >  r²/2):  z = (r²/2) / √(x² + y²)       the hyperbolic sheet (C¹ at the seam)
//
// cyborgd uses it twice. The aivatar projects a focused player's position (relative to the agent's
// shoulder) onto this surface to get the ARM: yaw/pitch of the extension and how far the arm
// reaches. The client uses the very same function to orbit its camera around the agent with an
// arcball perspective, so what the participant sees and what the agent "feels" agree.
export const DEFAULT_RADIUS = 1.5;
export const SHOULDER = [0.22, 1.35, 0];      // right shoulder offset from the agent's feet (metres), agent facing -z

/** project a 2D point (x, y) in the plane onto the arcball surface of radius r → [x, y, z] */
export function project(v, r = DEFAULT_RADIUS) {
  const x = +v[0] || 0, y = +v[1] || 0;
  const d2 = x * x + y * y, r2 = r * r;
  const z = d2 <= r2 / 2 ? Math.sqrt(r2 - d2) : (r2 / 2) / Math.sqrt(d2);
  return [x, y, z];
}

/** true when (x, y) lands on the sphere part of the surface (not the sheet) */
export function onSphere(v, r = DEFAULT_RADIUS) { const x = +v[0] || 0, y = +v[1] || 0; return x * x + y * y <= (r * r) / 2; }

/** spherical angles of a vector: yaw about +y (0 = facing -z, as the room's forward), pitch up +  */
export function sphericalOf(v) {
  const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  if (len === 0) return { yaw: 0, pitch: 0, len: 0 };
  return { yaw: Math.atan2(v[0], -v[2]), pitch: Math.asin(Math.max(-1, Math.min(1, v[1] / len))), len };
}

/** the inverse: yaw/pitch/len → vector (for the client camera orbit) */
export function fromSpherical(yaw, pitch, len = 1) {
  const c = Math.cos(pitch);
  return [Math.sin(yaw) * c * len, Math.sin(pitch) * len, -Math.cos(yaw) * c * len];
}

/**
 * The arm. shoulder + target are world positions; the relative vector d = target − shoulder is taken
 * in the agent's facing frame (agentYaw), its horizontal-plane coordinates (x = right, y = up) are
 * projected onto the arcball surface and the resulting surface point gives the arm's yaw/pitch.
 * extend is 0 beyond reach r and grows with the distance to the target inside it (the arm reaches
 * out to touch): extend = clamp(dist / r, 0, 1) when dist ≤ r, else 0.
 *   returns { extend, yaw, pitch, dist, surface:[x,y,z] }
 */
export function reach(shoulder, target, { r = DEFAULT_RADIUS, agentYaw = 0 } = {}) {
  const d = [target[0] - shoulder[0], target[1] - shoulder[1], target[2] - shoulder[2]];
  const dist = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
  // into the agent frame: undo the agent's yaw about +y (forward = (sin yaw, 0, -cos yaw) → local -z)
  const cy = Math.cos(agentYaw), sy = Math.sin(agentYaw);
  const lx = d[0] * cy + d[2] * sy, lz = -d[0] * sy + d[2] * cy, ly = d[1];
  // the plane the arcball sees: x = lateral (right), y = up; depth (toward the target, -z) comes from the surface
  const surface = project([lx, ly], r);
  const forwardZ = lz <= 0 ? -surface[2] : surface[2];    // target in front → arm points forward (-z), behind → back
  const sph = sphericalOf([surface[0], surface[1], forwardZ]);
  const extend = dist <= r ? Math.max(0, Math.min(1, dist / r)) : 0;
  const round = (n) => Math.round(n * 1000) / 1000;
  return { extend: round(extend), yaw: round(sph.yaw), pitch: round(sph.pitch), dist: round(dist), surface: surface.map(round) };
}

/** the shoulder position of an agent standing at p with yaw (world) */
export function shoulderOf(p, yaw = 0, offset = SHOULDER) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return [p[0] + offset[0] * c + offset[2] * s, p[1] + offset[1], p[2] - offset[0] * s + offset[2] * c];
}

/**
 * Camera orbit helper for the client: a drag from screen point a to b (both in [-1,1] normalized
 * device coords scaled by r) rotates the camera around the agent by the angle between the two
 * arcball surface points (Shoemake). Returns { axis:[x,y,z], angle } — the rotation to apply.
 */
export function orbit(a, b, r = DEFAULT_RADIUS) {
  const pa = project(a, r), pb = project(b, r);
  const la = Math.hypot(...pa), lb = Math.hypot(...pb);
  if (la === 0 || lb === 0) return { axis: [0, 1, 0], angle: 0 };
  const na = pa.map((x) => x / la), nb = pb.map((x) => x / lb);
  const dot = Math.max(-1, Math.min(1, na[0] * nb[0] + na[1] * nb[1] + na[2] * nb[2]));
  const axis = [na[1] * nb[2] - na[2] * nb[1], na[2] * nb[0] - na[0] * nb[2], na[0] * nb[1] - na[1] * nb[0]];
  const al = Math.hypot(...axis);
  return { axis: al > 0 ? axis.map((x) => x / al) : [0, 1, 0], angle: Math.acos(dot) };
}

export const arcball = { DEFAULT_RADIUS, SHOULDER, project, onSphere, sphericalOf, fromSpherical, reach, shoulderOf, orbit };
export default arcball;
