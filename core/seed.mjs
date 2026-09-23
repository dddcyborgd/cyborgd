/*! cyborgd — seed · (c) 2026 BANKON / PYTHAI · MIT · upstream patterns © oncyberio (MIT) */
// Deterministic randomness. PURE JS. Nothing in core/ may call Math.random: every "random" choice
// (an aivatar's idle path, which greeting it picks) derives from a seed so the host, the anchor and
// a replay all agree. mulberry32 (Tommy Ettinger, public domain) + a 32-bit FNV-1a string hash.
export function hashSeed(s) {
  if (typeof s === 'number') return s >>> 0;
  let h = 0x811c9dc5;
  const str = String(s ?? '');
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** a PRNG: next() ∈ [0,1) · int(n) ∈ [0,n) · pick(arr) · range(a,b) · fork(label) → an independent stream */
export function rng(seed) {
  let a = hashSeed(seed) || 1;
  const next = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const r = {
    seed: hashSeed(seed),
    next,
    int: (n) => Math.floor(next() * n),
    pick: (arr) => (arr && arr.length ? arr[Math.floor(next() * arr.length)] : undefined),
    range: (lo, hi) => lo + next() * (hi - lo),
    fork: (label) => rng(hashSeed(seed) ^ hashSeed(label)),
  };
  return r;
}

/** a stable choice for (seed, index) — the greeting line for player #k, the same every time */
export function choose(arr, seed, index = 0) {
  if (!arr || !arr.length) return undefined;
  return arr[(hashSeed(seed) + (index >>> 0) * 2654435761) % arr.length >>> 0];
}
