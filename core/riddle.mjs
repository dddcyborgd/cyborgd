/*! cyborgd — riddle · (c) 2026 BANKON / PYTHAI · MIT · upstream patterns © oncyberio (MIT) */
// A tiny AIML-like matcher + the riddle state machine. PURE JS.
// AIML — Artificial Intelligence Markup Language — is Dr. Richard S. Wallace's (A.L.I.C.E., 1995–1999)
// pattern language: <category><pattern>HELLO *</pattern><template>…</template></category>, with `*`
// wildcards and <srai> (symbolic reduction: rewrite the input and match again). cyborgd keeps the
// two ideas that matter — wildcard patterns and srai — as plain JSON categories:
//   { pattern: "HELLO *", template: "Hello, {0}." }          {0} = the first wildcard capture
//   { pattern: "HI *",    srai: "HELLO {0}" }                  reduce and rematch (depth ≤ 8)
// The riddle flow follows upstream game-server-v2/template.md (oncyberio, MIT): invite → present →
// capture → correct ⇒ `reward` (ONLY on a correct answer) / incorrect ⇒ notify + offer a hint.
// LLM seam: if `llm(prompt, ctx)` is injected, non-riddle chat that no category matches goes to it.
export const ATTEMPT_COOLDOWN_MS = 60_000;      // one attempt per 60 s per (player, agent)
export const MAX_SRAI_DEPTH = 8;

export function normalize(s) {
  return String(s ?? '').toUpperCase().replace(/[^\p{L}\p{N}\s*]/gu, ' ').replace(/\s+/g, ' ').trim();
}
export function normalizeAnswer(s) { return String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''); }

/** compile one pattern: `*` → (.+?) greedy-safe capture, `_` same, whole-line anchored */
export function compilePattern(pattern) {
  const n = normalize(pattern);
  const re = '^' + n.split(/\s+/).map((w) => (w === '*' || w === '_' ? '(.+?)' : w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('\\s+') + '$';
  return { pattern: n, re: new RegExp(re, 'u'), stars: (n.match(/[*_]/g) || []).length, words: n.split(/\s+/).filter((w) => w !== '*' && w !== '_').length };
}

export class Matcher {
  constructor(categories = []) { this.cats = []; for (const c of categories) this.add(c); }
  add(c) { const cp = compilePattern(c.pattern); this.cats.push({ ...c, ...cp }); this.cats.sort((a, b) => b.words - a.words || a.stars - b.stars); return this; }
  static fill(t, stars) { return String(t).replace(/\{(\d+)\}/g, (_, i) => stars[+i] ?? ''); }
  /** match(input) → { template, stars, category } | null */
  match(input, depth = 0) {
    const n = normalize(input);
    for (const c of this.cats) {
      const m = c.re.exec(n);
      if (!m) continue;
      const stars = m.slice(1).map((s) => s.trim());
      if (c.srai !== undefined) { if (depth >= MAX_SRAI_DEPTH) return null; return this.match(Matcher.fill(c.srai, stars), depth + 1); }
      const templates = Array.isArray(c.template) ? c.template : [c.template];
      return { templates: templates.map((t) => Matcher.fill(t, stars)), stars, category: c };
    }
    return null;
  }
}

export const DEFAULT_CATEGORIES = [
  { pattern: 'HELLO', template: ['Hello. Ask me for a riddle when you are ready.', 'Greetings, participant.'] },
  { pattern: 'HI', srai: 'HELLO' }, { pattern: 'HEY', srai: 'HELLO' }, { pattern: 'HI *', srai: 'HELLO' }, { pattern: 'HEY *', srai: 'HELLO' }, { pattern: 'HELLO *', srai: 'HELLO' }, { pattern: '* HELLO', srai: 'HELLO' },
  { pattern: 'WHO ARE YOU', template: 'I am an aivatar of the DeltaVerse — a cyborg that lives in this space.' },
  { pattern: 'WHAT ARE YOU', srai: 'WHO ARE YOU' }, { pattern: 'WHAT IS YOUR NAME', srai: 'WHO ARE YOU' },
  { pattern: '* RIDDLE *', srai: 'RIDDLE' }, { pattern: 'RIDDLE *', srai: 'RIDDLE' }, { pattern: '* RIDDLE', srai: 'RIDDLE' },
  { pattern: 'YES', template: '__offer__' }, { pattern: 'YES *', srai: 'YES' }, { pattern: 'SURE', srai: 'YES' }, { pattern: 'OK', srai: 'YES' }, { pattern: 'OKAY', srai: 'YES' }, { pattern: 'PLEASE', srai: 'YES' },
  { pattern: 'NO', template: 'Another time, then. I will be here.' }, { pattern: 'NO *', srai: 'NO' }, { pattern: 'NOPE', srai: 'NO' },
  { pattern: 'RIDDLE', template: '__offer__' },
  { pattern: 'HINT', template: '__hint__' }, { pattern: '* HINT *', srai: 'HINT' }, { pattern: '* HINT', srai: 'HINT' }, { pattern: 'HINT *', srai: 'HINT' },
  { pattern: 'THANK *', template: 'You are welcome.' }, { pattern: 'THANKS', srai: 'THANK YOU' },
  { pattern: 'BYE', template: 'Until next time.' }, { pattern: 'GOODBYE', srai: 'BYE' },
];

/**
 * Riddler: the per-(player, agent) dialogue. Sessions keyed `${agentId}|${playerKey}`.
 *   riddler.chat(agentId, playerKey, text, { rung, day }) → { text, emotion, effects:[] }
 *   effects: { type:'riddle-solved', agent, player, riddle, reward } — the aivatar turns it into voucher
 * A player earns each agent's reward once per day (dayKey), one answer attempt per 60 s.
 */
export class Riddler {
  constructor({ riddles = [], categories = DEFAULT_CATEGORIES, llm = null, now = () => 0, seed = 'cyborgd' } = {}) {
    this.riddles = riddles; this.matcher = new Matcher(categories); this.llm = llm; this.now = now; this.seed = seed;
    this.sessions = new Map(); this.solved = new Map();     // `${agent}|${player}|${day}` → riddleId
  }
  static dayOf(t) { return new Date(t).toISOString().slice(0, 10); }
  session(agentId, playerKey) {
    const k = agentId + '|' + playerKey;
    let s = this.sessions.get(k);
    if (!s) { s = { agent: agentId, player: playerKey, stage: 'idle', riddle: null, lastAttempt: null, attempts: 0, hinted: false }; this.sessions.set(k, s); }
    return s;
  }
  reset(agentId, playerKey) { this.sessions.delete(agentId + '|' + playerKey); }
  pickRiddle(agentId, playerKey, riddleIds) {
    const pool = riddleIds && riddleIds.length ? this.riddles.filter((r) => riddleIds.includes(r.id)) : this.riddles;
    if (!pool.length) return null;
    let h = 0; for (const ch of agentId + '|' + playerKey + '|' + this.seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return pool[h % pool.length];
  }
  offer(s, riddleIds) {
    s.riddle = this.pickRiddle(s.agent, s.player, riddleIds);
    if (!s.riddle) return { text: 'I have no riddle for you today.', emotion: 'calm' };
    s.stage = 'asked'; s.attempts = 0; s.hinted = false;
    return { text: 'Here is your riddle: ' + s.riddle.q + ' — what is your answer?', emotion: 'curious' };
  }
  hint(s) {
    if (s.stage !== 'asked' || !s.riddle) return { text: 'Ask for a riddle first.', emotion: 'calm' };
    s.hinted = true;
    return { text: s.riddle.hint ? 'A hint: ' + s.riddle.hint : 'No hint for this one.', emotion: 'calm' };
  }
  /** the single attempt path: case/whitespace/punctuation-insensitive, one attempt per 60 s */
  answer(s, text, t, day) {
    const solvedKey = s.agent + '|' + s.player + '|' + day;
    if (s.lastAttempt !== null && t - s.lastAttempt < ATTEMPT_COOLDOWN_MS) {
      return { text: 'Think a little longer — one attempt a minute.', emotion: 'wary', effects: [], retryAfterMs: ATTEMPT_COOLDOWN_MS - (t - s.lastAttempt) };
    }
    s.lastAttempt = t; s.attempts++;
    const given = normalizeAnswer(text);
    const ok = (Array.isArray(s.riddle.a) ? s.riddle.a : [s.riddle.a]).some((a) => normalizeAnswer(a) === given);
    if (!ok) return { text: 'Sorry, that is not correct. ' + (s.hinted ? 'Try again in a minute.' : 'Would you like a hint?'), emotion: 'calm', effects: [] };
    s.stage = 'solved';
    const effects = [];
    if (this.solved.has(solvedKey)) return { text: 'Correct — again. You already earned this one today.', emotion: 'joy', effects };
    this.solved.set(solvedKey, s.riddle.id);
    if (s.riddle.reward) effects.push({ type: 'riddle-solved', agent: s.agent, player: s.player, riddle: s.riddle.id, reward: s.riddle.reward, day });
    return { text: 'Correct! ' + (s.riddle.reward ? 'Your reward is on its way.' : 'Well solved.'), emotion: 'joy', effects };
  }
  async chat(agentId, playerKey, text, { riddleIds, t = this.now(), day = Riddler.dayOf(t), ctx } = {}) {
    const s = this.session(agentId, playerKey);
    const m = this.matcher.match(text);
    const tpl = m ? m.templates[Math.abs(this.matcher.cats.indexOf(m.category) + s.attempts) % m.templates.length] : null;
    if (tpl === '__offer__') return { ...this.offer(s, riddleIds), effects: [] };
    if (tpl === '__hint__') return { ...this.hint(s), effects: [] };
    if (s.stage === 'asked' && s.riddle) {
      const r = this.answer(s, text, t, day);
      if (r.effects) return r;
    }
    if (tpl) return { text: tpl, emotion: 'calm', effects: [] };
    if (this.llm) {
      try { const out = await this.llm(text, { agent: agentId, player: playerKey, stage: s.stage, ...(ctx || {}) }); if (out) return { text: String(out).slice(0, 280), emotion: 'curious', effects: [], llm: true }; } catch (e) { /* fall through */ }
    }
    return { text: 'Say "riddle" and I will offer you one.', emotion: 'calm', effects: [] };
  }
}
