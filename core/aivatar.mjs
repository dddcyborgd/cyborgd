/*! cyborgd — aivatar · (c) 2026 BANKON / PYTHAI · MIT · upstream patterns © oncyberio (MIT) */
// The cyborg AI avatar: server-side NPC behaviour. PURE JS (time via now(), randomness from seeds).
// An agent definition:
//   { id, kind:"aivatar", type: iNFT|THOT|dNFT|aNFT, name, seed, spawn:[x,y,z], zone:{c,r}|"zoneId",
//     say:[…greeting lines], riddle?:{ ids?:[…riddle ids], reward?:{token,amount} }, behaviours?:[…] }
// Behaviours (a registry — add one by adding a function to BEHAVIOURS):
//   wander  a seeded idle path inside its zone, ≤ 1.2 m/s, pauses while a player is close
//   greet   a player comes within 3 m → face them, animation "greet", say{text,emotion} chosen by seed + player index
//   mirror  event{name:"gesture",data:{name}} (smile|jawOpen|browsUp|nod) → mirrors the gesture + a line
//   reach   the FOCUSED player within 1.5 m → the arm extends toward them: arm{extend,yaw,pitch} from the
//           ARCBALL projection of the player onto the sphere around the agent's shoulder (core/arcball.mjs)
//   focus   event{name:"focus",data:{agent}} → dialogue mode; msg{to:agentId,data:{text}} answered by riddle.mjs
//   riddle  greet → offer → check → on success effect {type:"voucher",kind:"drip",…} (once per player per agent per day)
// Effects returned from update()/onEvent()/onMsg(): {type:'say',…} · {type:'voucher',…} · {type:'animation',…}
import { rng, choose, hashSeed } from './seed.mjs';
import { v3, contains, centreOf, radiusOf } from './zones.mjs';
import { arcball } from './arcball.mjs';
import { Riddler } from './riddle.mjs';

export const GREET_RANGE = 3;
export const REACH_RANGE = 1.5;
export const WANDER_SPEED = 1.2;
export const EMOTIONS = ['joy', 'curious', 'calm', 'wary'];
export const GESTURE_LINES = {
  smile: 'A smile — I mirror it back to you.', jawOpen: 'Oh! What surprised you?', browsUp: 'Raised brows. Curious, are we?', nod: 'I nod with you. Agreed.',
  greet: 'Well met. I return the greeting.', wave: 'I wave back across the sphere.', point: 'You point — I look where you look.', raise: 'Raised high. I answer in kind.', bow: 'A bow. I bow to the participant.',
};
export const GESTURE_ANIM = { smile: 'smile', jawOpen: 'jawOpen', browsUp: 'browsUp', nod: 'nod', greet: 'greet', wave: 'wave', point: 'point', raise: 'raise', bow: 'bow' };
// items of influence on the participant's sphere (sceptre, orb…): the aivatar answers a raised or used item
export const ITEM_LINES = { raise: 'The {item} rises on your sphere — I feel its pull.', use: 'Your {item} speaks. I answer.', lower: 'The {item} rests.', select: 'The {item} — a fine choice.' };
export const DEFAULT_SAY = ['Welcome, participant.', 'I have a riddle, if you have a minute.', 'The fabric sees you.', 'Ask me who I am.'];

const yawTo = (from, to) => Math.atan2(to[0] - from[0], -(to[2] - from[2]));
const playerKeyOf = (p) => p.sub || p.sessionId;

export class Agent {
  constructor(def, { now = () => 0, riddler = null, zones = [] } = {}) {
    this.def = def; this.id = def.id; this.kind = 'aivatar'; this.type = def.type || 'iNFT'; this.name = def.name || def.id;
    this.seed = def.seed ?? def.id; this.now = now; this.riddler = riddler;
    this.zone = typeof def.zone === 'string' ? (zones.find((z) => z.id === def.zone)?.bounds || null) : (def.zone || null);
    this.zoneId = typeof def.zone === 'string' ? def.zone : (def.zoneId || null);
    this.spawn = def.spawn ? v3.clone(def.spawn) : (this.zone ? centreOf(this.zone) : [0, 0, 0]);
    this.p = v3.clone(this.spawn); this.r = [0, def.yaw || 0, 0]; this.a = 'idle'; this.arm = null; this.say = null;
    this.behaviours = new Set(def.behaviours || Object.keys(BEHAVIOURS));
    this.rand = rng(this.seed).fork('wander');
    this.target = null; this.waitUntil = 0; this.near = new Map(); this.playerIndex = new Map(); this.focus = null; this.sayUntil = 0; this.animUntil = 0;
    this.sayLines = def.say && def.say.length ? def.say : DEFAULT_SAY;
  }
  get yaw() { return this.r[1]; }
  indexOf(player) { const k = playerKeyOf(player); if (!this.playerIndex.has(k)) this.playerIndex.set(k, this.playerIndex.size); return this.playerIndex.get(k); }
  face(p) { this.r = [0, yawTo(this.p, p), 0]; }
  speak(text, emotion, to, holdMs = 6000) { const t = this.now(); this.say = { text, emotion, t, ...(to ? { to } : {}) }; this.sayUntil = t + holdMs; return { type: 'say', agent: this.id, text, emotion, ...(to ? { to } : {}) }; }
  animate(name, holdMs = 2000) { this.a = name; this.animUntil = this.now() + holdMs; return { type: 'animation', agent: this.id, name }; }
  inZone(p) { return this.zone ? contains(this.zone, p) : true; }
  /** advance dt seconds against the current players (Map or array); returns effects */
  update(dt, players) {
    const list = players instanceof Map ? [...players.values()] : (players || []);
    const t = this.now(), effects = [];
    if (this.say && t >= this.sayUntil) this.say = null;
    if (this.a !== 'idle' && this.a !== 'walk' && t >= this.animUntil) this.a = 'idle';
    let nearest = null, nearestD = Infinity;
    for (const pl of list) { const d = v3.dist(this.p, pl.p); if (d < nearestD) { nearest = pl; nearestD = d; } }
    for (const b of this.behaviours) { const fn = BEHAVIOURS[b]; if (fn && fn.update) effects.push(...(fn.update(this, dt, list, { nearest, nearestD, t }) || [])); }
    return effects;
  }
  onEvent(player, ev) {
    const effects = [];
    for (const b of this.behaviours) { const fn = BEHAVIOURS[b]; if (fn && fn.event) effects.push(...(fn.event(this, player, ev) || [])); }
    return effects;
  }
  /** dialogue: msg{to:agentId,data:{text}} — async because the LLM seam may be async */
  async onMsg(player, text, { day } = {}) {
    if (!this.riddler) return [this.speak('…', 'calm', player.sessionId)];
    const key = playerKeyOf(player);
    const r = await this.riddler.chat(this.id, key, String(text ?? ''), { riddleIds: this.def.riddle?.ids, t: this.now(), day });
    const effects = [this.speak(r.text, r.emotion || 'calm', player.sessionId)];
    for (const e of r.effects || []) if (e.type === 'riddle-solved') {
      const reward = e.reward || this.def.riddle?.reward;
      if (reward) effects.push({ type: 'voucher', kind: 'drip', agent: this.id, riddle: e.riddle, day: e.day, to: { sessionId: player.sessionId, sub: player.sub || null, address: player.sub || null }, token: reward.token, amount: reward.amount });
      effects.push(this.animate('celebrate', 3000));
    }
    return effects;
  }
  snapshot() {
    const s = { id: this.id, kind: this.kind, type: this.type, name: this.name, p: this.p.map((n) => Math.round(n * 1000) / 1000), r: this.r.map((n) => Math.round(n * 1000) / 1000), a: this.a };
    if (this.arm) s.arm = this.arm;
    if (this.say) s.say = this.say;
    if (this.zoneId) s.zone = this.zoneId;
    return s;
  }
}

export const BEHAVIOURS = {
  wander: {
    update(ag, dt, list, { nearestD, t }) {
      if (ag.focus || nearestD < GREET_RANGE) { if (ag.a === 'walk') ag.a = 'idle'; return []; }
      if (t < ag.waitUntil) return [];
      if (!ag.target) {
        const c = ag.zone ? centreOf(ag.zone) : ag.spawn, r = ag.zone ? Math.max(0.5, radiusOf(ag.zone) * 0.8) : 3;
        const ang = ag.rand.range(0, Math.PI * 2), dist = ag.rand.range(0, r);
        ag.target = [c[0] + Math.cos(ang) * dist, ag.spawn[1], c[2] + Math.sin(ang) * dist];
      }
      const d = v3.sub(ag.target, ag.p), len = v3.len(d);
      if (len < 0.05) { ag.target = null; ag.waitUntil = t + ag.rand.range(2000, 7000); ag.a = 'idle'; return []; }
      const step = Math.min(len, WANDER_SPEED * dt);
      ag.p = v3.add(ag.p, v3.scale(d, step / len)); ag.r = [0, Math.atan2(d[0], -d[2]), 0]; ag.a = 'walk';
      return [];
    },
  },
  greet: {
    update(ag, dt, list) {
      const effects = [];
      for (const pl of list) {
        const reach = Math.max(GREET_RANGE, (pl.field && pl.field.r) || 0); // the participant's field of influence widens the greeting
        const d = v3.dist(ag.p, pl.p), was = ag.near.get(pl.sessionId) || false, now = d <= reach;
        if (now && !was) {
          const idx = ag.indexOf(pl);
          ag.face(pl.p);
          effects.push(ag.animate('greet', 2500));
          effects.push(ag.speak(choose(ag.sayLines, ag.seed, idx), choose(EMOTIONS, hashSeed(ag.seed) + 7, idx), pl.sessionId));
        }
        ag.near.set(pl.sessionId, now);
      }
      for (const sid of [...ag.near.keys()]) if (!list.some((pl) => pl.sessionId === sid)) ag.near.delete(sid);
      return effects;
    },
  },
  // the participant's FIELD OF INFLUENCE (dvengine DVField): resizable, bounded by the space extent − 1 —
  // "a thing has to be separate from infinity to recognise it (infinity − 1), and the DeltaVerse recognised itself".
  // While the field covers the agent it greets at the field's radius instead of 3 m; at the bound it recognises the participant.
  field: {
    event(ag, player, ev) {
      if (ev.name !== 'field' || !ev.data) return [];
      player.field = { r: ev.data.r, max: ev.data.max, at: ev.data.at || null, t: ag.now ? ag.now() : Date.now() };
      if (ev.data.at === 'bound') { ag.face(player.p); return [ag.animate('raise', 1800), ag.speak('Your field reaches the edge of this space — one short of everything. The DeltaVerse recognises you, ' + (player.name || 'participant') + '.', 'joy', player.sessionId, 4000)]; }
      return [];
    },
  },
  item: {
    event(ag, player, ev) {
      if (ev.name !== 'item' || !ev.data || !ITEM_LINES[ev.data.action]) return [];
      const line = ITEM_LINES[ev.data.action].replace('{item}', String(ev.data.name));
      return [ag.animate(ev.data.action === 'raise' ? 'raise' : ev.data.action === 'use' ? 'bow' : 'nod', 1600), ag.speak(line, ev.data.action === 'use' ? 'joy' : 'curious', player.sessionId, 3000)];
    },
  },
  mirror: {
    event(ag, player, ev) {
      if (ev.name !== 'gesture' || !GESTURE_ANIM[ev.data?.name]) return [];
      if (v3.dist(ag.p, player.p) > GREET_RANGE * 2) return [];
      ag.face(player.p);
      return [ag.animate(GESTURE_ANIM[ev.data.name], 1800), ag.speak(GESTURE_LINES[ev.data.name], ev.data.name === 'jawOpen' ? 'curious' : 'joy', player.sessionId, 3000)];
    },
  },
  reach: {
    update(ag, dt, list) {
      const pl = ag.focus ? list.find((x) => x.sessionId === ag.focus) : null;
      if (!pl) { ag.arm = null; return []; }
      const d = v3.dist(ag.p, pl.p);
      if (d > REACH_RANGE) { if (ag.arm) ag.arm = null; return []; }
      ag.face(pl.p);
      const shoulder = arcball.shoulderOf(ag.p, ag.yaw);
      const chest = [pl.p[0], pl.p[1] + 1.2, pl.p[2]];
      const r = arcball.reach(shoulder, chest, { r: REACH_RANGE, agentYaw: ag.yaw });
      ag.arm = { extend: r.extend, yaw: r.yaw, pitch: r.pitch };
      if (ag.a === 'idle') ag.a = 'reach';
      return [];
    },
  },
  focus: {
    event(ag, player, ev) {
      if (ev.name !== 'focus') return [];
      if (ev.data.agent === ag.id) { ag.focus = player.sessionId; ag.face(player.p); return [ag.speak('I am listening.', 'curious', player.sessionId, 4000)]; }
      if (ag.focus === player.sessionId) { ag.focus = null; ag.arm = null; ag.riddler?.reset(ag.id, playerKeyOf(player)); }
      return [];
    },
  },
  riddle: {
    event(ag, player, ev) {
      if (ev.name !== 'riddle' || ev.data.agent !== ag.id || !ag.riddler) return [];
      const s = ag.riddler.session(ag.id, playerKeyOf(player));
      const o = ag.riddler.offer(s, ag.def.riddle?.ids);
      ag.focus = player.sessionId; ag.face(player.p);
      return [ag.speak(o.text, o.emotion, player.sessionId, 12000)];
    },
  },
};

/** build the agents of a room: defs from the room registry (+ a shared Riddler) */
export function createAgents(defs = [], { now, riddles = [], categories, llm, zones = [], seed = 'cyborgd' } = {}) {
  const riddler = new Riddler({ riddles, categories, llm, now, seed });
  const agents = new Map();
  for (const d of defs) agents.set(d.id, new Agent(d, { now, riddler, zones }));
  return { agents, riddler };
}

export { Riddler, playerKeyOf };
