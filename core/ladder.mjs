/*! cyborgd — ladder · (c) 2026 BANKON / PYTHAI · MIT · upstream patterns © oncyberio (MIT) */
// The privilege ladder (DeltaVerse/deploy/privilege-tiers.json `ladder[]`), PURE JS so rooms, zones
// and the triad election rank participants identically in the browser host and the daemon.
// 8 rungs + 1: participant(0) recognized-participant(1) member(2) player(3) trader(4) owner(5)
// overseer(6) overlord(7) and mastermind(8), the +1 — never minted, creation is not logged into.
export const LADDER = Object.freeze([
  { rung: 'participant',            rank: 0, source: 'presence' },
  { rung: 'recognized-participant', rank: 1, source: 'signature' },
  { rung: 'member',                 rank: 2, source: 'signature' },
  { rung: 'player',                 rank: 3, source: 'holdings' },
  { rung: 'trader',                 rank: 4, source: 'holdings' },
  { rung: 'owner',                  rank: 5, source: 'ens' },
  { rung: 'overseer',               rank: 6, source: 'appointment' },
  { rung: 'overlord',               rank: 7, source: 'ens' },
  { rung: 'mastermind',             rank: 8, source: 'creation', position: '+1' },
]);
const RANK = Object.fromEntries(LADDER.map((r) => [r.rung, r.rank]));
const NAME = Object.fromEntries(LADDER.map((r) => [r.rank, r.rung]));
/** aliases the registries and older claims use */
export const ALIASES = Object.freeze({ public: 'participant', anyone: 'participant', recognized: 'recognized-participant', deployer: 'owner', model: 'member', agent: 'player', cabinet: 'overseer' });
/** compat vocabulary (login333 `tier`) → rank when a claim predates the `rung` field */
export const TIER_FALLBACK = Object.freeze({ overlord: 7, overseer: 6, deployer: 5, member: 2 });
export const HOST_MIN_RUNG = 'member';

/** rank of a rung name (or a numeric rank); unknown → 0 (participant) */
export function rankOf(rung) {
  if (typeof rung === 'number') return Number.isFinite(rung) ? Math.max(0, Math.min(8, Math.floor(rung))) : 0;
  const k = String(rung || '').toLowerCase();
  const r = RANK[ALIASES[k] || k];
  return r === undefined ? 0 : r;
}
export function rungName(rank) { return NAME[rankOf(rank)] || 'participant'; }
export function atLeast(rung, minRung) { return rankOf(rung) >= rankOf(minRung); }
export function isRung(name) { const k = String(name || '').toLowerCase(); return RANK[ALIASES[k] || k] !== undefined; }

/** rung rank for a claim object: `rung` wins, then `tier` fallback, else member (a signed wallet) */
export function rungOfClaim(c) {
  if (!c) return 0;
  if (c.rung && isRung(c.rung)) return rankOf(c.rung);
  if (c.tier && TIER_FALLBACK[String(c.tier).toLowerCase()] !== undefined) return TIER_FALLBACK[String(c.tier).toLowerCase()];
  return c.sub ? 2 : 0;
}
