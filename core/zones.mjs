/*! cyborgd — zones · (c) 2026 BANKON / PYTHAI · MIT · upstream patterns © oncyberio (MIT) */
// Containment math for the room's zones. PURE JS. A zone is { id, minRole, bounds, portalTo? } where
// bounds is a sphere { c:[x,y,z], r } or a box { min:[x,y,z], max:[x,y,z] }. Rooms gate movement with
// `zoneAt(zones, p)`: a state that lands a player in a zone whose minRole outranks the player is
// rejected (pushed back + error{code:"zone-locked"}). Portals: standing inside a zone with `portalTo`
// and within `PORTAL_REACH` of its centre counts as reaching the portal.
export const PORTAL_REACH = 1.5;

export const v3 = {
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  len: (a) => Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]),
  dist: (a, b) => v3.len(v3.sub(a, b)),
  norm: (a) => { const l = v3.len(a); return l > 0 ? v3.scale(a, 1 / l) : [0, 0, 0]; },
  lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
  clone: (a) => [a[0], a[1], a[2]],
};

export function isSphere(b) { return !!b && Array.isArray(b.c) && typeof b.r === 'number'; }
export function isBox(b) { return !!b && Array.isArray(b.min) && Array.isArray(b.max); }

export function contains(bounds, p) {
  if (isSphere(bounds)) return v3.dist(bounds.c, p) <= bounds.r;
  if (isBox(bounds)) return p[0] >= bounds.min[0] && p[0] <= bounds.max[0] && p[1] >= bounds.min[1] && p[1] <= bounds.max[1] && p[2] >= bounds.min[2] && p[2] <= bounds.max[2];
  return false;
}

export function centreOf(bounds) {
  if (isSphere(bounds)) return v3.clone(bounds.c);
  if (isBox(bounds)) return v3.scale(v3.add(bounds.min, bounds.max), 0.5);
  return [0, 0, 0];
}

export function radiusOf(bounds) {
  if (isSphere(bounds)) return bounds.r;
  if (isBox(bounds)) return v3.dist(bounds.min, bounds.max) / 2;
  return 0;
}

/** the innermost (smallest) zone containing p, or null */
export function zoneAt(zones, p) {
  let best = null, bestR = Infinity;
  for (const z of zones || []) {
    if (!contains(z.bounds, p)) continue;
    const r = radiusOf(z.bounds);
    if (r < bestR) { best = z; bestR = r; }
  }
  return best;
}

/** every zone containing p (outermost first) */
export function zonesAt(zones, p) {
  return (zones || []).filter((z) => contains(z.bounds, p)).sort((a, b) => radiusOf(b.bounds) - radiusOf(a.bounds));
}

/** the nearest point on/inside bounds to p (a push-back target when a locked zone is entered) */
export function clampTo(bounds, p) {
  if (isSphere(bounds)) {
    const d = v3.sub(p, bounds.c), l = v3.len(d);
    return l <= bounds.r ? v3.clone(p) : v3.add(bounds.c, v3.scale(d, bounds.r / l));
  }
  if (isBox(bounds)) return [0, 1, 2].map((i) => Math.min(bounds.max[i], Math.max(bounds.min[i], p[i])));
  return v3.clone(p);
}

/** push p just OUTSIDE bounds (the rejection: the player stays where they were allowed) */
export function pushOut(bounds, p, margin = 0.25) {
  const c = centreOf(bounds);
  let d = v3.sub(p, c);
  if (v3.len(d) === 0) d = [1, 0, 0];
  const r = radiusOf(bounds) + margin;
  return v3.add(c, v3.scale(v3.norm(d), r));
}

/** a zone with a portal within reach of p → { zone, to } or null */
export function portalReach(zones, p, reach = PORTAL_REACH) {
  for (const z of zonesAt(zones, p)) if (z.portalTo && v3.dist(centreOf(z.bounds), p) <= reach) return { zone: z.id, to: z.portalTo };
  return null;
}

/** validate a zone list shape; returns [] of problems */
export function validateZones(zones) {
  const bad = [];
  if (!Array.isArray(zones)) return ['zones must be an array'];
  const ids = new Set();
  for (const z of zones) {
    if (!z || typeof z.id !== 'string') { bad.push('zone id'); continue; }
    if (ids.has(z.id)) bad.push('duplicate zone ' + z.id);
    ids.add(z.id);
    if (!isSphere(z.bounds) && !isBox(z.bounds)) bad.push('zone ' + z.id + ' bounds');
  }
  for (const z of zones) if (z.portalTo && !ids.has(z.portalTo) && !/:/.test(z.portalTo)) bad.push('zone ' + z.id + ' portal to unknown ' + z.portalTo);
  return bad;
}
