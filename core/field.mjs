/*! cyborgd — field · the field of influence policy (pure) · (c) 2026 BANKON / PYTHAI · MIT */
// The DeltaVerse ALWAYS recognises a participant's field of influence. The OVERLORD hierarchy holds two dials per rung:
//   outflow — how much the DeltaVerse is affected by the field;  inflow — how much the field's subject is affected by the DeltaVerse.
// A field is `open` (everyone), `connected` (only the participants it links to) or `private` (its signer only — needs a signed claim).
// max radius = the space extent − 1: a thing must stay separate from infinity to be recognised (infinity − 1).
export const DEFAULT_POLICY = { outflow: 0.15, inflow: 1 };
export function policyFor(table, rung) { const t = (table && table.rungs) || {}; return t[rung] || t.participant || DEFAULT_POLICY; }
export function defaultMode(table, rung) { const d = (table && table.defaultMode) || {}; return d[rung] || 'open'; }
/** recognition degree in [0,1]: how far the field reaches, weighted by what the hierarchy lets it affect */
export function degree(field, policy) { if (!field || !(field.max > 0)) return 0; return Math.max(0, Math.min(1, field.r / field.max)) * (policy ? policy.outflow : 1); }
export function atBound(field, eps = 0.5) { return !!field && field.max > 0 && field.r >= field.max - eps; }
/** may `viewer` see / be affected by `owner`'s field? */
export function visibleTo(ownerField, ownerSid, viewerSid) {
  if (!ownerField || ownerSid === viewerSid) return true;
  const mode = ownerField.mode || 'open';
  if (mode === 'open') return true;
  if (mode === 'connected') return Array.isArray(ownerField.links) && ownerField.links.includes(viewerSid);
  return false; // private
}
/** normalise an incoming field event into the stored shape (privacy needs a signed claim) */
export function normalise(ev, player, table) {
  const rung = typeof player.rank === 'string' ? player.rank : (typeof player.rung === 'string' ? player.rung : 'participant'); // rooms keep the NAME in .rank and the number in .rung
  let mode = ev.mode || (player.field && player.field.mode) || defaultMode(table, rung);
  if (mode === 'private' && !player.signed) mode = 'open';
  const links = Array.isArray(ev.links) ? ev.links.slice(0, 64) : ((player.field && player.field.links) || []);
  return { r: ev.r, max: ev.max, at: ev.at || null, mode, links, policy: policyFor(table, rung) };
}
