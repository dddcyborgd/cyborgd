/*! cyborgd-core 0.0.1-alpha — the isomorphic core of cyborgd (github.com/dddcyborgd/cyborgd) · (c) 2026 BANKON / PYTHAI · MIT · upstream patterns © oncyberio (MIT) · built by scripts/build-core.mjs */
(function (root) {
  'use strict';
  var __mods = {};
  function __get(n) { if (!__mods[n]) throw new Error('cyborgd-core: unknown module ' + n); return __mods[n]; }

  // ── core/arcball.mjs ──
  __mods["arcball"] = (function () {
    var __exports = {};
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
    const DEFAULT_RADIUS = 1.5;
    const SHOULDER = [0.22, 1.35, 0];      // right shoulder offset from the agent's feet (metres), agent facing -z

    /** project a 2D point (x, y) in the plane onto the arcball surface of radius r → [x, y, z] */
    function project(v, r = DEFAULT_RADIUS) {
      const x = +v[0] || 0, y = +v[1] || 0;
      const d2 = x * x + y * y, r2 = r * r;
      const z = d2 <= r2 / 2 ? Math.sqrt(r2 - d2) : (r2 / 2) / Math.sqrt(d2);
      return [x, y, z];
    }

    /** true when (x, y) lands on the sphere part of the surface (not the sheet) */
    function onSphere(v, r = DEFAULT_RADIUS) { const x = +v[0] || 0, y = +v[1] || 0; return x * x + y * y <= (r * r) / 2; }

    /** spherical angles of a vector: yaw about +y (0 = facing -z, as the room's forward), pitch up +  */
    function sphericalOf(v) {
      const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
      if (len === 0) return { yaw: 0, pitch: 0, len: 0 };
      return { yaw: Math.atan2(v[0], -v[2]), pitch: Math.asin(Math.max(-1, Math.min(1, v[1] / len))), len };
    }

    /** the inverse: yaw/pitch/len → vector (for the client camera orbit) */
    function fromSpherical(yaw, pitch, len = 1) {
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
    function reach(shoulder, target, { r = DEFAULT_RADIUS, agentYaw = 0 } = {}) {
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
    function shoulderOf(p, yaw = 0, offset = SHOULDER) {
      const c = Math.cos(yaw), s = Math.sin(yaw);
      return [p[0] + offset[0] * c + offset[2] * s, p[1] + offset[1], p[2] - offset[0] * s + offset[2] * c];
    }

    /**
     * Camera orbit helper for the client: a drag from screen point a to b (both in [-1,1] normalized
     * device coords scaled by r) rotates the camera around the agent by the angle between the two
     * arcball surface points (Shoemake). Returns { axis:[x,y,z], angle } — the rotation to apply.
     */
    function orbit(a, b, r = DEFAULT_RADIUS) {
      const pa = project(a, r), pb = project(b, r);
      const la = Math.hypot(...pa), lb = Math.hypot(...pb);
      if (la === 0 || lb === 0) return { axis: [0, 1, 0], angle: 0 };
      const na = pa.map((x) => x / la), nb = pb.map((x) => x / lb);
      const dot = Math.max(-1, Math.min(1, na[0] * nb[0] + na[1] * nb[1] + na[2] * nb[2]));
      const axis = [na[1] * nb[2] - na[2] * nb[1], na[2] * nb[0] - na[0] * nb[2], na[0] * nb[1] - na[1] * nb[0]];
      const al = Math.hypot(...axis);
      return { axis: al > 0 ? axis.map((x) => x / al) : [0, 1, 0], angle: Math.acos(dot) };
    }

    const arcball = { DEFAULT_RADIUS, SHOULDER, project, onSphere, sphericalOf, fromSpherical, reach, shoulderOf, orbit };

    __exports["default"] = arcball;
    __exports["DEFAULT_RADIUS"] = DEFAULT_RADIUS;
    __exports["SHOULDER"] = SHOULDER;
    __exports["project"] = project;
    __exports["onSphere"] = onSphere;
    __exports["sphericalOf"] = sphericalOf;
    __exports["fromSpherical"] = fromSpherical;
    __exports["reach"] = reach;
    __exports["shoulderOf"] = shoulderOf;
    __exports["orbit"] = orbit;
    __exports["arcball"] = arcball;
    return __exports;
  })();

  // ── core/ladder.mjs ──
  __mods["ladder"] = (function () {
    var __exports = {};
    /*! cyborgd — ladder · (c) 2026 BANKON / PYTHAI · MIT · upstream patterns © oncyberio (MIT) */
    // The privilege ladder (DeltaVerse/deploy/privilege-tiers.json `ladder[]`), PURE JS so rooms, zones
    // and the triad election rank participants identically in the browser host and the daemon.
    // 8 rungs + 1: participant(0) recognized-participant(1) member(2) player(3) trader(4) owner(5)
    // overseer(6) overlord(7) and mastermind(8), the +1 — never minted, creation is not logged into.
    const LADDER = Object.freeze([
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
    const ALIASES = Object.freeze({ public: 'participant', anyone: 'participant', recognized: 'recognized-participant', deployer: 'owner', model: 'member', agent: 'player', cabinet: 'overseer' });
    /** compat vocabulary (login333 `tier`) → rank when a claim predates the `rung` field */
    const TIER_FALLBACK = Object.freeze({ overlord: 7, overseer: 6, deployer: 5, member: 2 });
    const HOST_MIN_RUNG = 'member';

    /** rank of a rung name (or a numeric rank); unknown → 0 (participant) */
    function rankOf(rung) {
      if (typeof rung === 'number') return Number.isFinite(rung) ? Math.max(0, Math.min(8, Math.floor(rung))) : 0;
      const k = String(rung || '').toLowerCase();
      const r = RANK[ALIASES[k] || k];
      return r === undefined ? 0 : r;
    }
    function rungName(rank) { return NAME[rankOf(rank)] || 'participant'; }
    function atLeast(rung, minRung) { return rankOf(rung) >= rankOf(minRung); }
    function isRung(name) { const k = String(name || '').toLowerCase(); return RANK[ALIASES[k] || k] !== undefined; }

    /** rung rank for a claim object: `rung` wins, then `tier` fallback, else member (a signed wallet) */
    function rungOfClaim(c) {
      if (!c) return 0;
      if (c.rung && isRung(c.rung)) return rankOf(c.rung);
      if (c.tier && TIER_FALLBACK[String(c.tier).toLowerCase()] !== undefined) return TIER_FALLBACK[String(c.tier).toLowerCase()];
      return c.sub ? 2 : 0;
    }

    __exports["LADDER"] = LADDER;
    __exports["ALIASES"] = ALIASES;
    __exports["TIER_FALLBACK"] = TIER_FALLBACK;
    __exports["HOST_MIN_RUNG"] = HOST_MIN_RUNG;
    __exports["rankOf"] = rankOf;
    __exports["rungName"] = rungName;
    __exports["atLeast"] = atLeast;
    __exports["isRung"] = isRung;
    __exports["rungOfClaim"] = rungOfClaim;
    return __exports;
  })();

  // ── core/protocol.mjs ──
  __mods["protocol"] = (function () {
    var __exports = {};
    /*! cyborgd — protocol · (c) 2026 BANKON / PYTHAI · MIT · upstream patterns © oncyberio (MIT) */
    // The cyborg/1 protocol: type guards + encoders. PURE JS (no node-only imports) — the same file runs in
    // the browser host (dist/cyborgd-core.js) and in the daemon. Every inbound message passes a guard
    // before a room sees it; an unknown or invalid message answers `error` and counts against the
    // sender (INVALID_LIMIT strikes → close 1008). Upstream precedent: the oo-game-server `player-state`
    // tuple [px,py,pz,rx,ry,rz,animation,scale,vrmUrl,text] becomes `state{p,r,a,s,txt}`; the awe
    // net-platformer command frame {tick,sequence,moveX,moveY,sprint,jumpPressed,jumpReleased,jumpHeld,yaw}
    // becomes `cmd{tick,seq,mx,my,sprint,jp,jr,jh,yaw}`.
    //
    // THE TRIAD adds five messages: `rtc` (relayed opaque signaling, same space only), `peers` (roster),
    // `host` (election result), `mirror` (host → anchor canonical snapshot) and `repoint` (anchor → a
    // client whose host vanished: "connect to this one now").
    const VERSION = 'cyborg/1';
    const INVALID_LIMIT = 20;
    const RATE = { sim: 60, net: 20 };
    const STATE_HZ_MAX = 20;
    const MAX_TXT = 140;
    const MAX_NAME = 32;
    const MAX_MSG_BYTES = 4096;
    const MAX_RTC_BYTES = 16384;
    const MAX_SNAP_BYTES = 262144;

    const CLIENT_TYPES = ['hello', 'state', 'cmd', 'msg', 'event', 'ping', 'rtc', 'mirror', 'lost'];
    const SERVER_TYPES = ['welcome', 'denied', 'joined', 'left', 'snap', 'ack', 'msg', 'voucher', 'say', 'pong', 'error',
                                 'peers', 'host', 'repoint', 'rtc'];
    const EVENT_NAMES = ['portal', 'riddle', 'reach', 'gesture', 'focus'];
    const GESTURES = ['smile', 'jawOpen', 'browsUp', 'nod'];
    const AVATAR_KINDS = ['aivatar', 'vrm', 'primitive'];
    const ROLES = ['client', 'host', 'anchor'];
    const RTC_KINDS = ['offer', 'answer', 'ice'];

    const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
    const isStr = (v, max = 256) => typeof v === 'string' && v.length <= max;
    const isVec3 = (v) => Array.isArray(v) && v.length === 3 && v.every(isNum);
    const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
    const isBool = (v) => typeof v === 'boolean';
    const isId = (v, max = 64) => isStr(v, max) && /^[A-Za-z0-9._:-]+$/.test(v);
    const isTick = (v) => isNum(v) && v >= 0 && v === Math.floor(v);
    const is = { num: isNum, str: isStr, vec3: isVec3, obj: isObj, bool: isBool, id: isId, tick: isTick };

    const guards = {
      hello(m) {
        if (m.v !== VERSION) return 'v must be ' + VERSION;
        if (!isId(m.space)) return 'space id';
        if (m.claim !== undefined && !isStr(m.claim, 4096)) return 'claim';
        if (m.name !== undefined && !isStr(m.name, MAX_NAME)) return 'name';
        if (m.vrm !== undefined && !isStr(m.vrm, 512)) return 'vrm';
        if (m.role !== undefined && !['client', 'host'].includes(m.role)) return 'role';
        if (m.avatar !== undefined) {
          if (!isObj(m.avatar) || !AVATAR_KINDS.includes(m.avatar.kind)) return 'avatar.kind';
          if (m.avatar.seed !== undefined && !(isNum(m.avatar.seed) || isStr(m.avatar.seed, 64))) return 'avatar.seed';
          if (m.avatar.tint !== undefined && !(isStr(m.avatar.tint, 16) && /^#?[0-9a-fA-F]{3,8}$/.test(m.avatar.tint))) return 'avatar.tint';
        }
        return null;
      },
      state(m) {
        if (!isVec3(m.p)) return 'p';
        if (!isVec3(m.r)) return 'r';
        if (!isStr(m.a, 32)) return 'a';
        if (!isNum(m.s) || m.s <= 0 || m.s > 10) return 's';
        if (m.txt !== undefined && !isStr(m.txt, MAX_TXT)) return 'txt';
        if (m.p.some((x) => Math.abs(x) > 1e5)) return 'p out of world';
        return null;
      },
      cmd(m) {
        if (!isTick(m.tick)) return 'tick';
        if (!isTick(m.seq)) return 'seq';
        if (!isNum(m.mx) || m.mx < -1 || m.mx > 1) return 'mx';
        if (!isNum(m.my) || m.my < -1 || m.my > 1) return 'my';
        if (!isBool(m.sprint) || !isBool(m.jp) || !isBool(m.jr) || !isBool(m.jh)) return 'sprint/jp/jr/jh';
        if (!isNum(m.yaw)) return 'yaw';
        return null;
      },
      msg(m) {
        if (m.to !== undefined && !isId(m.to)) return 'to';
        if (m.data === undefined) return 'data';
        if (JSON.stringify(m.data).length > MAX_MSG_BYTES) return 'data too large';
        return null;
      },
      event(m) {
        if (!EVENT_NAMES.includes(m.name)) return 'name';
        if (!isObj(m.data)) return 'data';
        if (m.name === 'gesture' && !GESTURES.includes(m.data.name)) return 'gesture name';
        if (m.name === 'focus' && !(m.data.agent === null || isId(m.data.agent))) return 'focus agent';
        if (m.name === 'portal' && !isId(m.data.to)) return 'portal to';
        if (m.name === 'reach' && !isId(m.data.zone)) return 'reach zone';
        if (m.name === 'riddle' && !isId(m.data.agent)) return 'riddle agent';
        if (JSON.stringify(m.data).length > MAX_MSG_BYTES) return 'data too large';
        return null;
      },
      ping(m) { return isNum(m.t) ? null : 't'; },
      /** rtc{to,kind,payload}: relayed to `to` if (and only if) it is in the sender's space; payload is never inspected */
      rtc(m) {
        if (!isId(m.to)) return 'to';
        if (!RTC_KINDS.includes(m.kind)) return 'kind';
        if (m.payload === undefined) return 'payload';
        if (JSON.stringify(m.payload).length > MAX_RTC_BYTES) return 'payload too large';
        return null;
      },
      /** mirror{tick,snap}: only the elected host may send it; the anchor applies last-writer-wins by tick */
      mirror(m) {
        if (!isTick(m.tick)) return 'tick';
        if (!isObj(m.snap)) return 'snap';
        if (m.snap.players !== undefined && !isObj(m.snap.players)) return 'snap.players';
        if (m.snap.agents !== undefined && !isObj(m.snap.agents)) return 'snap.agents';
        if (JSON.stringify(m.snap).length > MAX_SNAP_BYTES) return 'snap too large';
        return null;
      },
      /** lost{host}: a client reports its host is gone → the anchor answers repoint{host} */
      lost(m) { return m.host === undefined || m.host === null || isId(m.host) ? null : 'host'; },
    };

    /** Parse + validate an inbound client message. Returns { ok:true, msg } or { ok:false, code, message }. */
    function parseClient(raw) {
      let m;
      if (typeof raw === 'string') {
        if (raw.length > MAX_SNAP_BYTES + 1024) return { ok: false, code: 'too-large', message: 'message exceeds the frame limit' };
        try { m = JSON.parse(raw); } catch (e) { return { ok: false, code: 'bad-json', message: 'not JSON' }; }
      } else m = raw;
      if (!isObj(m) || !isStr(m.type, 16)) return { ok: false, code: 'bad-shape', message: 'object with type expected' };
      const g = guards[m.type];
      if (!g || !CLIENT_TYPES.includes(m.type)) return { ok: false, code: 'unknown-type', message: 'unknown type ' + m.type };
      const bad = g(m);
      if (bad) return { ok: false, code: 'invalid', message: m.type + ': ' + bad };
      return { ok: true, msg: m };
    }

    // ── encoders (server → client) ──
    const enc = {
      welcome: (o) => ({ type: 'welcome', v: VERSION, rate: RATE, ...o }),
      denied: (reason, minRole, rung) => ({ type: 'denied', reason, minRole, rung }),
      joined: (p) => ({ type: 'joined', sessionId: p.sessionId, name: p.name, avatar: p.avatar, rank: p.rank, rung: p.rung, role: p.role }),
      left: (sessionId, reason) => ({ type: 'left', sessionId, ...(reason ? { reason } : {}) }),
      snap: (tick, ts, players, agents, full) => ({ type: 'snap', tick, ts, players, agents, ...(full ? { full: true } : {}) }),
      ack: (tick, seq, checkpoint) => ({ type: 'ack', tick, seq, checkpoint }),
      msg: (from, data, to) => ({ type: 'msg', from, data, ...(to ? { to } : {}) }),
      voucher: (v) => ({ type: 'voucher', ...v }),
      say: (agent, text, emotion, to) => ({ type: 'say', agent, text, emotion, ...(to ? { to } : {}) }),
      pong: (t, serverT) => ({ type: 'pong', t, serverT }),
      error: (code, message, extra) => ({ type: 'error', code, message, ...(extra || {}) }),
      peers: (list) => ({ type: 'peers', list }),
      host: (sessionId, reason) => ({ type: 'host', sessionId, ...(reason ? { reason } : {}) }),
      repoint: (host, tick) => ({ type: 'repoint', host, ...(tick !== undefined ? { tick } : {}) }),
      rtc: (from, kind, payload) => ({ type: 'rtc', from, kind, payload }),
    };

    /** shape check for the outbound side (tests + selftest) */
    function isServerMessage(m) { return isObj(m) && SERVER_TYPES.includes(m.type); }

    __exports["VERSION"] = VERSION;
    __exports["INVALID_LIMIT"] = INVALID_LIMIT;
    __exports["RATE"] = RATE;
    __exports["STATE_HZ_MAX"] = STATE_HZ_MAX;
    __exports["MAX_TXT"] = MAX_TXT;
    __exports["MAX_NAME"] = MAX_NAME;
    __exports["MAX_MSG_BYTES"] = MAX_MSG_BYTES;
    __exports["MAX_RTC_BYTES"] = MAX_RTC_BYTES;
    __exports["MAX_SNAP_BYTES"] = MAX_SNAP_BYTES;
    __exports["CLIENT_TYPES"] = CLIENT_TYPES;
    __exports["SERVER_TYPES"] = SERVER_TYPES;
    __exports["EVENT_NAMES"] = EVENT_NAMES;
    __exports["GESTURES"] = GESTURES;
    __exports["AVATAR_KINDS"] = AVATAR_KINDS;
    __exports["ROLES"] = ROLES;
    __exports["RTC_KINDS"] = RTC_KINDS;
    __exports["is"] = is;
    __exports["guards"] = guards;
    __exports["parseClient"] = parseClient;
    __exports["enc"] = enc;
    __exports["isServerMessage"] = isServerMessage;
    return __exports;
  })();

  // ── core/riddle.mjs ──
  __mods["riddle"] = (function () {
    var __exports = {};
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
    const ATTEMPT_COOLDOWN_MS = 60_000;      // one attempt per 60 s per (player, agent)
    const MAX_SRAI_DEPTH = 8;

    function normalize(s) {
      return String(s ?? '').toUpperCase().replace(/[^\p{L}\p{N}\s*]/gu, ' ').replace(/\s+/g, ' ').trim();
    }
    function normalizeAnswer(s) { return String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''); }

    /** compile one pattern: `*` → (.+?) greedy-safe capture, `_` same, whole-line anchored */
    function compilePattern(pattern) {
      const n = normalize(pattern);
      const re = '^' + n.split(/\s+/).map((w) => (w === '*' || w === '_' ? '(.+?)' : w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('\\s+') + '$';
      return { pattern: n, re: new RegExp(re, 'u'), stars: (n.match(/[*_]/g) || []).length, words: n.split(/\s+/).filter((w) => w !== '*' && w !== '_').length };
    }

    class Matcher {
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

    const DEFAULT_CATEGORIES = [
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
    class Riddler {
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

    __exports["ATTEMPT_COOLDOWN_MS"] = ATTEMPT_COOLDOWN_MS;
    __exports["MAX_SRAI_DEPTH"] = MAX_SRAI_DEPTH;
    __exports["normalize"] = normalize;
    __exports["normalizeAnswer"] = normalizeAnswer;
    __exports["compilePattern"] = compilePattern;
    __exports["Matcher"] = Matcher;
    __exports["DEFAULT_CATEGORIES"] = DEFAULT_CATEGORIES;
    __exports["Riddler"] = Riddler;
    return __exports;
  })();

  // ── core/seed.mjs ──
  __mods["seed"] = (function () {
    var __exports = {};
    /*! cyborgd — seed · (c) 2026 BANKON / PYTHAI · MIT · upstream patterns © oncyberio (MIT) */
    // Deterministic randomness. PURE JS. Nothing in core/ may call Math.random: every "random" choice
    // (an aivatar's idle path, which greeting it picks) derives from a seed so the host, the anchor and
    // a replay all agree. mulberry32 (Tommy Ettinger, public domain) + a 32-bit FNV-1a string hash.
    function hashSeed(s) {
      if (typeof s === 'number') return s >>> 0;
      let h = 0x811c9dc5;
      const str = String(s ?? '');
      for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
      return h >>> 0;
    }

    /** a PRNG: next() ∈ [0,1) · int(n) ∈ [0,n) · pick(arr) · range(a,b) · fork(label) → an independent stream */
    function rng(seed) {
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
    function choose(arr, seed, index = 0) {
      if (!arr || !arr.length) return undefined;
      return arr[(hashSeed(seed) + (index >>> 0) * 2654435761) % arr.length >>> 0];
    }

    __exports["hashSeed"] = hashSeed;
    __exports["rng"] = rng;
    __exports["choose"] = choose;
    return __exports;
  })();

  // ── core/sim.mjs ──
  __mods["sim"] = (function () {
    var __exports = {};
    /*! cyborgd — sim · (c) 2026 BANKON / PYTHAI · MIT · upstream patterns © oncyberio (MIT) */
    // The authoritative lane. PURE JS, DETERMINISTIC: the same command sequence always yields the same
    // state, on the client (prediction) and on the server (authority) — the foundation of reconciliation.
    // Port of archive/awe/examples/auth-multiplayer/shared/net-platformer/shared/sim-step.ts with the
    // three.js Mover replaced by a flat kinematic body on a ground plane (no rapier, no scene):
    //   walk 3 m/s · sprint 6 m/s · jump 5 m/s · gravity 9.81 m/s² · ground y = 0 · yaw-relative movement
    //   forward = (sin yaw, 0, −cos yaw), right = (cos yaw, 0, sin yaw) — exactly getNetPlatformerYawDirections
    //   coyote time 0.1 s: a jump pressed within 0.1 s of walking off the ground still fires
    //   jump release while rising halves the vertical speed (the variable-height jump of the Mover)
    // InputQueue: commands are deduped by seq and dropped when older than MAX_CMD_AGE_TICKS (32) ticks
    // behind the authority; ack{tick,seq,checkpoint:{p,v,grounded}} is what the client rolls back to.
    const CFG = Object.freeze({ walk: 3, sprint: 6, jump: 5, gravity: 9.81, groundY: 0, coyote: 0.1, maxSpeed: 12 });
    const MAX_CMD_AGE_TICKS = 32;
    const SIM_RATE = 60;
    const SIM_DT = 1 / SIM_RATE;

    /** a fresh sim state at position p */
    function initialState(p = [0, 0, 0], yaw = 0) {
      return { tick: 0, seq: 0, p: [p[0], p[1], p[2]], v: [0, 0, 0], yaw, grounded: p[1] <= CFG.groundY, coyote: 0, jumping: false, sprint: false, moving: false };
    }

    /** the neutral command frame */
    function idleCmd(tick = 0, seq = 0, yaw = 0) { return { tick, seq, mx: 0, my: 0, sprint: false, jp: false, jr: false, jh: false, yaw }; }

    /** round to 1e-6 so float drift never differs across engines (all ops are IEEE-754 basic ops anyway) */
    const q = (n) => Math.round(n * 1e6) / 1e6;

    /** stepSim(prev, cmd, dt, cfg) → next (never mutates prev) */
    function stepSim(prev, cmd, dt = SIM_DT, cfg = CFG) {
      const yaw = cmd.yaw;
      const fx = Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = Math.sin(yaw);
      let mx = cmd.mx, my = cmd.my;
      const ml = Math.sqrt(mx * mx + my * my);
      if (ml > 1) { mx /= ml; my /= ml; }
      const speed = cmd.sprint ? cfg.sprint : cfg.walk;
      const vx = (fx * my + rx * mx) * speed, vz = (fz * my + rz * mx) * speed;
      let vy = prev.v[1];
      let grounded = prev.grounded, coyote = prev.coyote, jumping = prev.jumping;
      // jump edges
      if (cmd.jp && (grounded || coyote > 0)) { vy = cfg.jump; grounded = false; coyote = 0; jumping = true; }
      if (cmd.jr && jumping && vy > 0) vy *= 0.5;
      // gravity + integrate
      if (!grounded) vy -= cfg.gravity * dt;
      vy = Math.max(-cfg.maxSpeed * 4, vy);
      let px = prev.p[0] + vx * dt, py = prev.p[1] + vy * dt, pz = prev.p[2] + vz * dt;
      // ground contact
      if (py <= cfg.groundY && vy <= 0) { py = cfg.groundY; vy = 0; if (!grounded) { grounded = true; jumping = false; } coyote = cfg.coyote; }
      else if (grounded && py > cfg.groundY) { grounded = false; coyote = cfg.coyote; }   // walked off an edge (none on a plane, kept for cfg.groundY changes)
      if (!grounded && coyote > 0 && !jumping) coyote = Math.max(0, coyote - dt);
      return { tick: cmd.tick, seq: cmd.seq, p: [q(px), q(py), q(pz)], v: [q(vx), q(vy), q(vz)], yaw, grounded, coyote: q(coyote), jumping, sprint: !!cmd.sprint, moving: ml > 0 };
    }

    /** replay a command list from a state (client reconciliation; tests) */
    function replay(state, cmds, dt = SIM_DT, cfg = CFG) { let s = state; for (const c of cmds) s = stepSim(s, c, dt, cfg); return s; }

    function checkpointOf(s) { return { p: [...s.p], v: [...s.v], grounded: s.grounded }; }
    function ackOf(s) { return { tick: s.tick, seq: s.seq, checkpoint: checkpointOf(s) }; }

    /** per-player command queue with dedupe + age drop */
    class InputQueue {
      constructor({ maxAge = MAX_CMD_AGE_TICKS } = {}) { this.maxAge = maxAge; this.q = []; this.seen = new Set(); this.lastSeq = -1; this.dropped = 0; this.duped = 0; }
      /** push(cmd, authorityTick) → 'queued' | 'dup' | 'stale' */
      push(cmd, authorityTick = 0) {
        if (cmd.seq <= this.lastSeq && this.seen.has(cmd.seq)) { this.duped++; return 'dup'; }
        if (this.seen.has(cmd.seq)) { this.duped++; return 'dup'; }
        if (authorityTick - cmd.tick > this.maxAge) { this.dropped++; return 'stale'; }
        this.seen.add(cmd.seq);
        if (this.seen.size > 4096) { const it = this.seen.values(); for (let i = 0; i < 2048; i++) this.seen.delete(it.next().value); }
        let i = this.q.length; while (i > 0 && this.q[i - 1].seq > cmd.seq) i--;
        this.q.splice(i, 0, cmd);
        return 'queued';
      }
      /** take every queued command up to (and including) tick, in seq order */
      drain(tick = Infinity) {
        const out = [];
        while (this.q.length && this.q[0].tick <= tick) { const c = this.q.shift(); this.lastSeq = Math.max(this.lastSeq, c.seq); out.push(c); }
        return out;
      }
      get length() { return this.q.length; }
    }

    /**
     * Authority: one per player. feed(cmd) queues; update() runs one sim tick (repeating the last
     * command when the client sent none — the client is walking, not teleporting) and returns the ack.
     */
    class Authority {
      constructor({ p = [0, 0, 0], yaw = 0, dt = SIM_DT, cfg = CFG } = {}) {
        this.state = initialState(p, yaw); this.queue = new InputQueue(); this.dt = dt; this.cfg = cfg; this.tick = 0; this.last = idleCmd(0, 0, yaw);
      }
      feed(cmd) { return this.queue.push(cmd, this.tick); }
      update() {
        this.tick++;
        const cmds = this.queue.drain(this.tick);
        if (cmds.length === 0) { const c = { ...this.last, jp: false, jr: false, tick: this.tick }; this.state = stepSim(this.state, c, this.dt, this.cfg); }
        else for (const c of cmds) { this.last = c; this.state = stepSim(this.state, { ...c, tick: this.tick }, this.dt, this.cfg); }
        return ackOf(this.state);
      }
      teleport(p, yaw = this.state.yaw) { this.state = { ...initialState(p, yaw), tick: this.tick, seq: this.state.seq }; return this.state; }
    }

    __exports["CFG"] = CFG;
    __exports["MAX_CMD_AGE_TICKS"] = MAX_CMD_AGE_TICKS;
    __exports["SIM_RATE"] = SIM_RATE;
    __exports["SIM_DT"] = SIM_DT;
    __exports["initialState"] = initialState;
    __exports["idleCmd"] = idleCmd;
    __exports["stepSim"] = stepSim;
    __exports["replay"] = replay;
    __exports["checkpointOf"] = checkpointOf;
    __exports["ackOf"] = ackOf;
    __exports["InputQueue"] = InputQueue;
    __exports["Authority"] = Authority;
    return __exports;
  })();

  // ── core/snapshot.mjs ──
  __mods["snapshot"] = (function () {
    var __exports = {};
    /*! cyborgd — snapshot · (c) 2026 BANKON / PYTHAI · MIT · upstream patterns © oncyberio (MIT) */
    // Snapshots: the room's world at a tick — { tick, ts, players:{sid:{p,r,a,s,txt?,updatedAt}}, agents:{id:{p,r,a,arm?,say?}} }.
    // PURE JS. Three tools:
    //   delta(prev, next)         → only the entities that changed since prev (+ `gone` lists) — the wire form
    //   apply(base, deltaSnap)    → the reconstructed full snapshot (a late joiner or a mirror consumer)
    //   mergeLWW(base, incoming)  → last-writer-wins BY TICK per entity: the anchor's rule for mirrors
    // and a SnapshotBuffer, the server-side port of awe examples/multiplayer/shared/snapshot-interpolation.ts
    // (push ignores out-of-order times, same time replaces, sample() brackets renderTime, holds the last
    // state when renderTime runs past the buffer).
    const ENTITY_FIELDS = ['p', 'r', 'a', 's', 'txt', 'arm', 'say', 'v', 'grounded', 'tick', 'updatedAt', 'zone', 'name', 'rank', 'rung', 'role', 'kind', 'type', 'seq'];

    function sameVal(a, b) {
      if (a === b) return true;
      if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => sameVal(x, b[i]));
      if (a && b && typeof a === 'object' && typeof b === 'object') {
        const ka = Object.keys(a), kb = Object.keys(b);
        return ka.length === kb.length && ka.every((k) => sameVal(a[k], b[k]));
      }
      return false;
    }
    function sameEntity(a, b) {
      if (!a || !b) return a === b;
      for (const k of ENTITY_FIELDS) if (!sameVal(a[k], b[k])) return false;
      return true;
    }
    const copy = (o) => JSON.parse(JSON.stringify(o));

    function emptySnapshot(tick = 0, ts = 0) { return { tick, ts, players: {}, agents: {} }; }

    /** wire delta: entities that changed (or are new) + gone lists; `full:true` when prev is null */
    function delta(prev, next) {
      if (!prev) return { ...copy(next), full: true };
      const out = { tick: next.tick, ts: next.ts, players: {}, agents: {} };
      for (const lane of ['players', 'agents']) {
        const a = prev[lane] || {}, b = next[lane] || {};
        for (const id of Object.keys(b)) if (!sameEntity(a[id], b[id])) out[lane][id] = copy(b[id]);
        const gone = Object.keys(a).filter((id) => !(id in b));
        if (gone.length) out[lane + 'Gone'] = gone;
      }
      return out;
    }

    /** reconstruct: apply a delta (or a full snapshot) on top of base */
    function apply(base, d) {
      if (!d) return base ? copy(base) : emptySnapshot();
      if (d.full || !base) { const { full, playersGone, agentsGone, ...rest } = d; return { players: {}, agents: {}, ...copy(rest) }; }
      const out = { ...copy(base), tick: d.tick ?? base.tick, ts: d.ts ?? base.ts };
      for (const lane of ['players', 'agents']) {
        out[lane] = out[lane] || {};
        for (const [id, e] of Object.entries(d[lane] || {})) out[lane][id] = copy(e);
        for (const id of d[lane + 'Gone'] || []) delete out[lane][id];
      }
      return out;
    }

    /**
     * Last-writer-wins by tick. Per entity the higher `tick` wins (an entity without a tick inherits its
     * snapshot's tick); equal ticks → incoming wins (it is the later arrival). The result's tick is the
     * max of both. `gone` lists in the incoming are honoured only when its tick ≥ the base entity's tick.
     */
    function mergeLWW(base, incoming) {
      if (!base) return apply(null, incoming);
      if (!incoming) return copy(base);
      const out = { ...copy(base), tick: Math.max(base.tick || 0, incoming.tick || 0), ts: Math.max(base.ts || 0, incoming.ts || 0) };
      const tickOf = (e, snapTick) => (e && typeof e.tick === 'number' ? e.tick : snapTick || 0);
      for (const lane of ['players', 'agents']) {
        out[lane] = out[lane] || {};
        for (const [id, e] of Object.entries(incoming[lane] || {})) {
          const cur = out[lane][id];
          if (!cur || tickOf(e, incoming.tick) >= tickOf(cur, base.tick)) out[lane][id] = copy(e);
        }
        for (const id of incoming[lane + 'Gone'] || []) {
          const cur = out[lane][id];
          if (cur && (incoming.tick || 0) >= tickOf(cur, base.tick)) delete out[lane][id];
        }
      }
      return out;
    }

    /** the interpolation buffer (port of SnapshotBuffer<T>) */
    class SnapshotBuffer {
      constructor(maxSize = 60) { this.buffer = []; this.maxSize = maxSize; }
      push(state, serverTime) {
        const last = this.buffer[this.buffer.length - 1];
        if (last) {
          if (serverTime < last.time) return false;
          if (serverTime === last.time) { last.state = state; return true; }
        }
        this.buffer.push({ time: serverTime, state });
        if (this.buffer.length > this.maxSize) this.buffer.shift();
        return true;
      }
      sample(renderTime) {
        const buf = this.buffer;
        if (buf.length === 0) return null;
        for (let i = buf.length - 2; i >= 0; i--) {
          if (buf[i].time <= renderTime && renderTime < buf[i + 1].time) {
            const prev = buf[i], next = buf[i + 1], span = next.time - prev.time;
            const t = span > 0 ? (renderTime - prev.time) / span : 1;
            if (i > 0) this.buffer.splice(0, i);
            return { prev, next, t };
          }
        }
        if (renderTime >= buf[buf.length - 1].time) { const last = buf[buf.length - 1]; return { prev: last, next: last, t: 1 }; }
        return null;
      }
      latestPair() { return this.buffer.length < 2 ? null : { prev: this.buffer[this.buffer.length - 2], next: this.buffer[this.buffer.length - 1] }; }
      latest() { return this.buffer.length ? this.buffer[this.buffer.length - 1] : null; }
      clear() { this.buffer = []; }
      get length() { return this.buffer.length; }
    }

    /** lerp two entity states (p linear, r linear per axis, the rest from next) — the client's per-frame blend */
    function lerpEntity(a, b, t) {
      if (!a) return b; if (!b) return a;
      const L = (x, y) => x + (y - x) * t;
      return { ...b, p: a.p && b.p ? a.p.map((x, i) => L(x, b.p[i])) : b.p, r: a.r && b.r ? a.r.map((x, i) => L(x, b.r[i])) : b.r };
    }

    __exports["sameEntity"] = sameEntity;
    __exports["emptySnapshot"] = emptySnapshot;
    __exports["delta"] = delta;
    __exports["apply"] = apply;
    __exports["mergeLWW"] = mergeLWW;
    __exports["SnapshotBuffer"] = SnapshotBuffer;
    __exports["lerpEntity"] = lerpEntity;
    return __exports;
  })();

  // ── core/transport.mjs ──
  __mods["transport"] = (function () {
    var __exports = {};
    /*! cyborgd — transport · (c) 2026 BANKON / PYTHAI · MIT · upstream patterns © oncyberio (MIT) */
    // THE TRANSPORT INTERFACE. PURE JS. Everything in core/ that talks to a peer talks through this and
    // nothing else, so the same Room runs over a WebSocket (daemon/ws.mjs wraps WsSocket), over an
    // RTCDataChannel (dvengine's rtc transport, in the browser host) or over a LoopbackTransport pair
    // (tests, and a single-tab host talking to itself).
    //
    //   interface Transport {
    //     id: string                           stable per connection (the session id is assigned by the room)
    //     send(obj): boolean                   deliver one JSON-serialisable message; false when closed
    //     onMessage(fn(obj)): unsubscribe      fn receives the PARSED object (the transport owns JSON)
    //     onClose(fn(code, reason)): unsub     fired exactly once
    //     close(code?, reason?): void          idempotent
    //     readonly open: boolean
    //     meta?: { remoteAddress?, role?, … }  free-form, never trusted for identity (claims are)
    //   }
    //
    // Rules a transport MUST keep: messages arrive in order; onMessage never fires after onClose;
    // send() after close is a no-op returning false; the object handed to onMessage is owned by the
    // receiver (a loopback pair therefore deep-copies through JSON so no two sides share state).
    let _n = 0;
    function transportId(prefix = 't') { return prefix + (++_n).toString(36); }

    /** a base with the subscription plumbing; subclasses implement _send and _close */
    class BaseTransport {
      constructor(id, meta = {}) { this.id = id || transportId(); this.meta = meta; this._msg = new Set(); this._cls = new Set(); this.open = true; }
      onMessage(fn) { this._msg.add(fn); return () => this._msg.delete(fn); }
      onClose(fn) { this._cls.add(fn); return () => this._cls.delete(fn); }
      _deliver(obj) { if (!this.open) return; for (const fn of [...this._msg]) fn(obj); }
      _closed(code = 1000, reason = '') { if (!this.open) return; this.open = false; for (const fn of [...this._cls]) fn(code, reason); this._msg.clear(); this._cls.clear(); }
      send() { return false; }
      close() { this._closed(); }
    }

    /**
     * LoopbackTransport.pair() → [a, b]: a.send(x) arrives at b.onMessage (JSON-copied). Delivery is
     * queued and drained in order (no re-entrancy); with { sync:false } delivery happens on a microtask.
     * Closing one side closes the other with the same code/reason.
     */
    class LoopbackTransport extends BaseTransport {
      constructor(id, meta, { sync = true } = {}) { super(id, meta); this.peer = null; this.sync = sync; this._q = []; this._draining = false; this.sent = 0; this.received = 0; }
      static pair(opts = {}) {
        const a = new LoopbackTransport(opts.idA, opts.metaA, opts), b = new LoopbackTransport(opts.idB, opts.metaB, opts);
        a.peer = b; b.peer = a;
        return [a, b];
      }
      send(obj) {
        if (!this.open || !this.peer || !this.peer.open) return false;
        const copy = JSON.parse(JSON.stringify(obj));
        this.sent++;
        this.peer._enqueue(copy);
        return true;
      }
      _enqueue(obj) {
        this._q.push(obj);
        if (this.sync) this._drain(); else Promise.resolve().then(() => this._drain());
      }
      _drain() {
        if (this._draining) return;
        this._draining = true;
        try { while (this._q.length && this.open) { const m = this._q.shift(); this.received++; this._deliver(m); } }
        finally { this._draining = false; }
      }
      close(code = 1000, reason = '') {
        if (!this.open) return;
        this._q.length = 0;
        this._closed(code, reason);
        const p = this.peer; this.peer = null;
        if (p && p.open) p.close(code, reason);
      }
    }

    /** a recording sink for tests: collects everything sent to it */
    class RecordingTransport extends BaseTransport {
      constructor(id, meta) { super(id, meta); this.out = []; }
      send(obj) { if (!this.open) return false; this.out.push(JSON.parse(JSON.stringify(obj))); return true; }
      /** simulate an inbound message */
      push(obj) { this._deliver(JSON.parse(JSON.stringify(obj))); }
      ofType(t) { return this.out.filter((m) => m.type === t); }
      last(t) { const l = t ? this.ofType(t) : this.out; return l[l.length - 1]; }
      clear() { this.out.length = 0; }
    }

    /** wrap any object with send/onMessage/onClose/close into the interface (duck-typing check) */
    function isTransport(t) {
      return !!t && typeof t.send === 'function' && typeof t.onMessage === 'function' && typeof t.onClose === 'function' && typeof t.close === 'function';
    }

    __exports["transportId"] = transportId;
    __exports["BaseTransport"] = BaseTransport;
    __exports["LoopbackTransport"] = LoopbackTransport;
    __exports["RecordingTransport"] = RecordingTransport;
    __exports["isTransport"] = isTransport;
    return __exports;
  })();

  // ── core/triad.mjs ──
  __mods["triad"] = (function () {
    var __exports = {};
    var rankOf = __get("ladder").rankOf, HOST_MIN_RUNG = __get("ladder").HOST_MIN_RUNG;
    var mergeLWW = __get("snapshot").mergeLWW, emptySnapshot = __get("snapshot").emptySnapshot;
    var enc = __get("protocol").enc;
    /*! cyborgd — triad · (c) 2026 BANKON / PYTHAI · MIT · upstream patterns © oncyberio (MIT) */
    // THE TRIAD: participant ⟷ DeltaVerse ⟷ participant. Every participant is BOTH a client and a
    // server. Per space there are three roles:
    //   client  a participant in someone's space
    //   host    a participant serving their own space — the room core runs IN THEIR BROWSER, peers
    //           connect over RTCDataChannel
    //   anchor  this daemon: rendezvous + identity + faucet + the canonical snapshot + FAILOVER host
    // Rules (pure, all here): the space token owner, else the first participant with rung ≥ member, is
    // elected host; the anchor keeps the canonical snapshot and re-elects on disconnect (deterministic:
    // owner, then highest rank, then earliest join, then session id); hosts stream `snap` to peers AND
    // `mirror{tick,snap}` to the anchor; the anchor applies last-writer-wins by tick and serves late
    // joiners from it; a client that loses its host sends `lost` and gets `repoint{host}`.
    //
    //   triadStep(state, event) → { state, effects[] }      effects = [{ to:sessionId|'*', space, msg }]
    // events: join{space,sid,rung,owner?,t} · leave{space,sid,t} · mirror{space,sid,tick,snap} ·
    //         lost{space,sid,host?} · rtc{space,sid,to,kind,payload} · snapshot{space,sid} · reset{space}



    const ANCHOR = 'anchor';

    function emptyTriad() { return { spaces: {} }; }
    function emptySpace(id, t = 0) { return { id, host: ANCHOR, hostSince: t, peers: {}, tick: 0, snap: emptySnapshot(0, t), mirrors: 0, elections: 0 }; }

    function canHost(peer) { return !!peer && rankOf(peer.rung) >= rankOf(HOST_MIN_RUNG); }

    /** deterministic election: owner → highest rank → earliest join → sid; null when nobody can host (the anchor does) */
    function elect(space) {
      const c = Object.values(space.peers).filter(canHost);
      if (!c.length) return null;
      c.sort((a, b) => (b.owner ? 1 : 0) - (a.owner ? 1 : 0) || rankOf(b.rung) - rankOf(a.rung) || a.joinedAt - b.joinedAt || (a.sid < b.sid ? -1 : a.sid > b.sid ? 1 : 0));
      return c[0].sid;
    }

    function roster(space) {
      return Object.values(space.peers).sort((a, b) => a.joinedAt - b.joinedAt || (a.sid < b.sid ? -1 : 1))
        .map((p) => ({ sessionId: p.sid, role: p.sid === space.host ? 'host' : 'client', rung: p.rung, rank: rankOf(p.rung), ...(p.owner ? { owner: true } : {}) }));
    }
    function roleOf(space, sid) { return sid === ANCHOR ? 'anchor' : space.host === sid ? 'host' : 'client'; }

    const cloneSpace = (s) => ({ ...s, peers: { ...s.peers } });

    /** the pure step */
    function triadStep(state, ev) {
      const effects = [];
      const next = { spaces: { ...state.spaces } };
      const t = ev.t ?? 0;
      const spaceId = ev.space;
      if (!spaceId) return { state, effects: [{ to: ev.sid, space: null, msg: enc.error('invalid', 'triad event without space') }] };
      let space = cloneSpace(next.spaces[spaceId] || emptySpace(spaceId, t));
      next.spaces[spaceId] = space;
      const all = (msg) => { for (const sid of Object.keys(space.peers)) effects.push({ to: sid, space: spaceId, msg }); };
      const reelect = (reason) => {
        const winner = elect(space) || ANCHOR;
        const changed = winner !== space.host;
        space.host = winner; space.hostSince = t; space.elections++;
        if (changed) { all(enc.host(winner, reason)); for (const sid of Object.keys(space.peers)) if (sid !== winner) effects.push({ to: sid, space: spaceId, msg: enc.repoint(winner, space.tick) }); }
        return changed;
      };

      switch (ev.type) {
        case 'join': {
          if (!ev.sid) break;
          space.peers[ev.sid] = { sid: ev.sid, rung: rankOf(ev.rung ?? 0), owner: !!ev.owner, joinedAt: t, sub: ev.sub || null };
          const hostAlive = space.host !== ANCHOR && !!space.peers[space.host];
          // the owner takes the host on arrival; otherwise the anchor yields to the first eligible peer; an existing peer host keeps it
          // the joiner is ALWAYS told who hosts (a re-election that changed nothing still answers the newcomer)
          if (!((ev.owner || !hostAlive) && reelect(ev.owner ? 'owner' : 'first-eligible'))) effects.push({ to: ev.sid, space: spaceId, msg: enc.host(space.host) });
          // the late joiner is served from the anchor's canonical snapshot
          effects.push({ to: ev.sid, space: spaceId, msg: { ...enc.snap(space.snap.tick, space.snap.ts, space.snap.players || {}, space.snap.agents || {}, true), anchor: true } });
          all(enc.peers(roster(space)));
          break;
        }
        case 'leave': {
          if (!space.peers[ev.sid]) break;
          delete space.peers[ev.sid];
          if (space.snap.players && space.snap.players[ev.sid]) { space.snap = { ...space.snap, players: { ...space.snap.players } }; delete space.snap.players[ev.sid]; }
          if (space.host === ev.sid) reelect('host-left');
          if (Object.keys(space.peers).length === 0) { space.host = ANCHOR; space.hostSince = t; }
          else all(enc.peers(roster(space)));
          break;
        }
        case 'mirror': {
          if (ev.sid !== space.host) { effects.push({ to: ev.sid, space: spaceId, msg: enc.error('not-host', 'only the elected host mirrors', { host: space.host }) }); break; }
          const incoming = { tick: ev.tick, ts: t, players: ev.snap.players || {}, agents: ev.snap.agents || {}, ...(ev.snap.playersGone ? { playersGone: ev.snap.playersGone } : {}), ...(ev.snap.agentsGone ? { agentsGone: ev.snap.agentsGone } : {}) };
          const merged = mergeLWW(space.snap, incoming);
          space.snap = merged; space.tick = Math.max(space.tick, merged.tick); space.mirrors++;
          break;
        }
        case 'lost': {
          if (!space.peers[ev.sid]) { effects.push({ to: ev.sid, space: spaceId, msg: enc.error('not-in-space', 'join first') }); break; }
          const hostAlive = space.host !== ANCHOR && !!space.peers[space.host];
          if (!hostAlive || (ev.host && ev.host === space.host && space.host !== ev.sid && ev.force)) reelect('host-lost');
          effects.push({ to: ev.sid, space: spaceId, msg: enc.repoint(space.host, space.tick) });
          break;
        }
        case 'rtc': {
          if (!space.peers[ev.sid]) { effects.push({ to: ev.sid, space: spaceId, msg: enc.error('not-in-space', 'join first') }); break; }
          if (ev.to === ev.sid || !space.peers[ev.to]) { effects.push({ to: ev.sid, space: spaceId, msg: enc.error('no-peer', 'rtc target is not in this space', { to: ev.to }) }); break; }
          effects.push({ to: ev.to, space: spaceId, msg: enc.rtc(ev.sid, ev.kind, ev.payload) });
          break;
        }
        case 'snapshot': {
          effects.push({ to: ev.sid, space: spaceId, msg: { ...enc.snap(space.snap.tick, space.snap.ts, space.snap.players || {}, space.snap.agents || {}, true), anchor: true } });
          break;
        }
        case 'reset': { next.spaces[spaceId] = emptySpace(spaceId, t); break; }
        default: effects.push({ to: ev.sid, space: spaceId, msg: enc.error('unknown-type', 'triad: ' + ev.type) });
      }
      return { state: next, effects };
    }

    /** a stateful convenience around the pure step (the daemon uses it; tests use both) */
    class Triad {
      constructor({ now = () => 0 } = {}) { this.state = emptyTriad(); this.now = now; }
      step(ev) { const r = triadStep(this.state, { t: this.now(), ...ev }); this.state = r.state; return r.effects; }
      space(id) { return this.state.spaces[id] || null; }
      hostOf(id) { return this.space(id)?.host || ANCHOR; }
      roleOf(id, sid) { const s = this.space(id); return s ? roleOf(s, sid) : 'client'; }
      summary() {
        const spaces = Object.values(this.state.spaces).map((s) => ({ id: s.id, host: s.host, hostRole: s.host === ANCHOR ? 'anchor' : 'peer', peers: roster(s), tick: s.tick, mirrors: s.mirrors, elections: s.elections, hostSince: s.hostSince }));
        return { spaces: spaces.length, hosted: spaces.filter((s) => s.hostRole === 'peer').length, anchored: spaces.filter((s) => s.hostRole === 'anchor').length, list: spaces };
      }
    }

    __exports["ANCHOR"] = ANCHOR;
    __exports["emptyTriad"] = emptyTriad;
    __exports["emptySpace"] = emptySpace;
    __exports["canHost"] = canHost;
    __exports["elect"] = elect;
    __exports["roster"] = roster;
    __exports["roleOf"] = roleOf;
    __exports["triadStep"] = triadStep;
    __exports["Triad"] = Triad;
    return __exports;
  })();

  // ── core/zones.mjs ──
  __mods["zones"] = (function () {
    var __exports = {};
    /*! cyborgd — zones · (c) 2026 BANKON / PYTHAI · MIT · upstream patterns © oncyberio (MIT) */
    // Containment math for the room's zones. PURE JS. A zone is { id, minRole, bounds, portalTo? } where
    // bounds is a sphere { c:[x,y,z], r } or a box { min:[x,y,z], max:[x,y,z] }. Rooms gate movement with
    // `zoneAt(zones, p)`: a state that lands a player in a zone whose minRole outranks the player is
    // rejected (pushed back + error{code:"zone-locked"}). Portals: standing inside a zone with `portalTo`
    // and within `PORTAL_REACH` of its centre counts as reaching the portal.
    const PORTAL_REACH = 1.5;

    const v3 = {
      sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
      add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
      scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
      len: (a) => Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]),
      dist: (a, b) => v3.len(v3.sub(a, b)),
      norm: (a) => { const l = v3.len(a); return l > 0 ? v3.scale(a, 1 / l) : [0, 0, 0]; },
      lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
      clone: (a) => [a[0], a[1], a[2]],
    };

    function isSphere(b) { return !!b && Array.isArray(b.c) && typeof b.r === 'number'; }
    function isBox(b) { return !!b && Array.isArray(b.min) && Array.isArray(b.max); }

    function contains(bounds, p) {
      if (isSphere(bounds)) return v3.dist(bounds.c, p) <= bounds.r;
      if (isBox(bounds)) return p[0] >= bounds.min[0] && p[0] <= bounds.max[0] && p[1] >= bounds.min[1] && p[1] <= bounds.max[1] && p[2] >= bounds.min[2] && p[2] <= bounds.max[2];
      return false;
    }

    function centreOf(bounds) {
      if (isSphere(bounds)) return v3.clone(bounds.c);
      if (isBox(bounds)) return v3.scale(v3.add(bounds.min, bounds.max), 0.5);
      return [0, 0, 0];
    }

    function radiusOf(bounds) {
      if (isSphere(bounds)) return bounds.r;
      if (isBox(bounds)) return v3.dist(bounds.min, bounds.max) / 2;
      return 0;
    }

    /** the innermost (smallest) zone containing p, or null */
    function zoneAt(zones, p) {
      let best = null, bestR = Infinity;
      for (const z of zones || []) {
        if (!contains(z.bounds, p)) continue;
        const r = radiusOf(z.bounds);
        if (r < bestR) { best = z; bestR = r; }
      }
      return best;
    }

    /** every zone containing p (outermost first) */
    function zonesAt(zones, p) {
      return (zones || []).filter((z) => contains(z.bounds, p)).sort((a, b) => radiusOf(b.bounds) - radiusOf(a.bounds));
    }

    /** the nearest point on/inside bounds to p (a push-back target when a locked zone is entered) */
    function clampTo(bounds, p) {
      if (isSphere(bounds)) {
        const d = v3.sub(p, bounds.c), l = v3.len(d);
        return l <= bounds.r ? v3.clone(p) : v3.add(bounds.c, v3.scale(d, bounds.r / l));
      }
      if (isBox(bounds)) return [0, 1, 2].map((i) => Math.min(bounds.max[i], Math.max(bounds.min[i], p[i])));
      return v3.clone(p);
    }

    /** push p just OUTSIDE bounds (the rejection: the player stays where they were allowed) */
    function pushOut(bounds, p, margin = 0.25) {
      const c = centreOf(bounds);
      let d = v3.sub(p, c);
      if (v3.len(d) === 0) d = [1, 0, 0];
      const r = radiusOf(bounds) + margin;
      return v3.add(c, v3.scale(v3.norm(d), r));
    }

    /** a zone with a portal within reach of p → { zone, to } or null */
    function portalReach(zones, p, reach = PORTAL_REACH) {
      for (const z of zonesAt(zones, p)) if (z.portalTo && v3.dist(centreOf(z.bounds), p) <= reach) return { zone: z.id, to: z.portalTo };
      return null;
    }

    /** validate a zone list shape; returns [] of problems */
    function validateZones(zones) {
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

    __exports["PORTAL_REACH"] = PORTAL_REACH;
    __exports["v3"] = v3;
    __exports["isSphere"] = isSphere;
    __exports["isBox"] = isBox;
    __exports["contains"] = contains;
    __exports["centreOf"] = centreOf;
    __exports["radiusOf"] = radiusOf;
    __exports["zoneAt"] = zoneAt;
    __exports["zonesAt"] = zonesAt;
    __exports["clampTo"] = clampTo;
    __exports["pushOut"] = pushOut;
    __exports["portalReach"] = portalReach;
    __exports["validateZones"] = validateZones;
    return __exports;
  })();

  // ── core/aivatar.mjs ──
  __mods["aivatar"] = (function () {
    var __exports = {};
    var rng = __get("seed").rng, choose = __get("seed").choose, hashSeed = __get("seed").hashSeed;
    var v3 = __get("zones").v3, contains = __get("zones").contains, centreOf = __get("zones").centreOf, radiusOf = __get("zones").radiusOf;
    var arcball = __get("arcball").arcball;
    var Riddler = __get("riddle").Riddler;
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




    const GREET_RANGE = 3;
    const REACH_RANGE = 1.5;
    const WANDER_SPEED = 1.2;
    const EMOTIONS = ['joy', 'curious', 'calm', 'wary'];
    const GESTURE_LINES = {
      smile: 'A smile — I mirror it back to you.', jawOpen: 'Oh! What surprised you?', browsUp: 'Raised brows. Curious, are we?', nod: 'I nod with you. Agreed.',
    };
    const GESTURE_ANIM = { smile: 'smile', jawOpen: 'jawOpen', browsUp: 'browsUp', nod: 'nod' };
    const DEFAULT_SAY = ['Welcome, participant.', 'I have a riddle, if you have a minute.', 'The fabric sees you.', 'Ask me who I am.'];

    const yawTo = (from, to) => Math.atan2(to[0] - from[0], -(to[2] - from[2]));
    const playerKeyOf = (p) => p.sub || p.sessionId;

    class Agent {
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

    const BEHAVIOURS = {
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
            const d = v3.dist(ag.p, pl.p), was = ag.near.get(pl.sessionId) || false, now = d <= GREET_RANGE;
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
    function createAgents(defs = [], { now, riddles = [], categories, llm, zones = [], seed = 'cyborgd' } = {}) {
      const riddler = new Riddler({ riddles, categories, llm, now, seed });
      const agents = new Map();
      for (const d of defs) agents.set(d.id, new Agent(d, { now, riddler, zones }));
      return { agents, riddler };
    }


    __exports["Riddler"] = Riddler;
    __exports["playerKeyOf"] = playerKeyOf;
    __exports["GREET_RANGE"] = GREET_RANGE;
    __exports["REACH_RANGE"] = REACH_RANGE;
    __exports["WANDER_SPEED"] = WANDER_SPEED;
    __exports["EMOTIONS"] = EMOTIONS;
    __exports["GESTURE_LINES"] = GESTURE_LINES;
    __exports["GESTURE_ANIM"] = GESTURE_ANIM;
    __exports["DEFAULT_SAY"] = DEFAULT_SAY;
    __exports["Agent"] = Agent;
    __exports["BEHAVIOURS"] = BEHAVIOURS;
    __exports["createAgents"] = createAgents;
    return __exports;
  })();

  // ── core/rooms.mjs ──
  __mods["rooms"] = (function () {
    var __exports = {};
    var parseClient = __get("protocol").parseClient, enc = __get("protocol").enc, INVALID_LIMIT = __get("protocol").INVALID_LIMIT, STATE_HZ_MAX = __get("protocol").STATE_HZ_MAX, GESTURES = __get("protocol").GESTURES;
    var rankOf = __get("ladder").rankOf, rungName = __get("ladder").rungName, atLeast = __get("ladder").atLeast;
    var zoneAt = __get("zones").zoneAt, portalReach = __get("zones").portalReach, validateZones = __get("zones").validateZones, v3 = __get("zones").v3;
    var delta = __get("snapshot").delta, emptySnapshot = __get("snapshot").emptySnapshot;
    var Authority = __get("sim").Authority, SIM_DT = __get("sim").SIM_DT;
    var createAgents = __get("aivatar").createAgents;
    var isTransport = __get("transport").isTransport;
    /*! cyborgd — rooms · (c) 2026 BANKON / PYTHAI · MIT · upstream patterns © oncyberio (MIT) */
    // The room core. PURE JS: runs in the browser (a participant HOSTING their own space) and in the
    // daemon (the anchor hosting as failover). Upstream shape: oo-game-server-starter GameRoom hooks
    // (onJoin/onLeave/onMessage/onUpdate, broadcast/send) + game-server-v2 GameSession semantics
    // (tick vs sim rates, snapshot broadcast) — with rungs, zones, aivatars and the authoritative lane.
    //
    //   const room = createRoom(def, { now, authoritative, riddles, llm, hooks })
    //   room.join(transport, identity, hello) → { ok, player } | { ok:false, reason }
    //   room.handle(sessionId, rawOrObject)   every inbound message (guarded by core/protocol.mjs)
    //   room.update(dt)                       sim + agents (call at simRate)
    //   room.tick()                           broadcast a delta snapshot (call at tickRate)
    //   room.snapshot(changedOnly)            the world
    //   room.broadcast(obj, except[]) · room.send(obj, sid) · room.leave(sid, reason)
    // Player: { sessionId, sub, rung, rank, name, avatar, role, p, r, a, s, txt, updatedAt, latency, jitter, invalid, zone, joinedAt, index }
    // Zone gating: a state moving a player into a zone whose minRole outranks the player's rung is
    // rejected — the player is pushed back to their last accepted position and answered
    // error{code:"zone-locked", zone, minRole, p}.







    const DEFAULTS = Object.freeze({ tickRate: 20, simRate: 60, maxPlayers: 64, minRole: 'participant', spawn: [0, 0, 0], spawnRadius: 2 });

    /** EWMA latency + jitter (pure; jitter = smoothed |delta| between consecutive half-RTT samples) */
    class Latency {
      constructor(alpha = 0.2) { this.alpha = alpha; this.latency = 0; this.jitter = 0; this.samples = 0; this._prev = null; }
      sample(rttMs) {
        const half = rttMs / 2;
        if (this.samples === 0) { this.latency = half; this.jitter = 0; }
        else { this.latency += this.alpha * (half - this.latency); this.jitter += this.alpha * (Math.abs(half - this._prev) - this.jitter); }
        this._prev = half; this.samples++;
        return { latency: this.latency, jitter: this.jitter };
      }
    }

    let _sess = 0;
    function sessionIdFor(transport, seed = '') { return transport?.id ? String(transport.id) : 'p' + (++_sess).toString(36) + seed; }

    class Room {
      constructor(def, { now = () => Date.now(), authoritative = false, riddles = [], categories, llm = null, hooks = {}, log = null, insecure = false, seed } = {}) {
        if (!def || typeof def.id !== 'string') throw new Error('room def needs an id');
        const zoneProblems = validateZones(def.zones || []);
        if (zoneProblems.length) throw new Error('room ' + def.id + ' zones: ' + zoneProblems.join('; '));
        this.def = { ...DEFAULTS, ...def, zones: def.zones || [], agents: def.agents || [] };
        this.id = this.def.id; this.name = this.def.name || this.def.id; this.minRole = this.def.minRole; this.preset = this.def.preset || null; this.tone = this.def.tone || null;
        this.tickRate = this.def.tickRate; this.simRate = this.def.simRate; this.maxPlayers = this.def.maxPlayers; this.zones = this.def.zones;
        this.now = now; this.authoritative = authoritative; this.hooks = hooks; this.log = log; this.insecure = insecure;
        this.players = new Map(); this.sessions = new Map(); this.tick_ = 0; this.simTick = 0; this.lastSnap = null; this.joined = 0; this.createdAt = now();
        const built = createAgents(this.def.agents, { now, riddles, categories, llm, zones: this.zones, seed: seed || this.id });
        this.agents = built.agents; this.riddler = built.riddler;
      }
      get tick() { return this.tick_; }
      get size() { return this.players.size; }

      // ── join / leave ──
      spawnFor(index) {
        const s = this.def.spawn, r = this.def.spawnRadius, a = (index * 2.399963) % (Math.PI * 2);   // golden-angle ring, no randomness
        return [s[0] + Math.cos(a) * r * Math.min(1, index / 8 + 0.25), s[1], s[2] + Math.sin(a) * r * Math.min(1, index / 8 + 0.25)];
      }
      join(transport, identity = {}, hello = {}) {
        if (!isTransport(transport)) throw new Error('join needs a Transport');
        const rung = rankOf(identity.rung ?? 0);
        if (!atLeast(rung, this.minRole)) { transport.send(enc.denied('rung too low', this.minRole, rungName(rung))); return { ok: false, reason: 'rung', minRole: this.minRole }; }
        if (this.players.size >= this.maxPlayers) { transport.send(enc.denied('room full', this.minRole, rungName(rung))); return { ok: false, reason: 'full' }; }
        const sessionId = sessionIdFor(transport);
        if (this.players.has(sessionId)) { transport.send(enc.denied('duplicate session', this.minRole, rungName(rung))); return { ok: false, reason: 'duplicate' }; }
        const index = this.joined++;
        const p = { sessionId, sub: identity.sub || null, rung, rank: rungName(rung), name: (hello.name || identity.name || 'participant').slice(0, 32), avatar: hello.avatar || { kind: 'primitive' }, vrm: hello.vrm || null,
          role: hello.role === 'host' ? 'host' : 'client', p: this.spawnFor(index), r: [0, 0, 0], a: 'idle', s: 1, txt: '', updatedAt: this.now(), latency: 0, jitter: 0, invalid: 0, zone: null, joinedAt: this.now(), index, tick: 0 };
        p.zone = zoneAt(this.zones, p.p)?.id || null;
        const sess = { transport, player: p, latency: new Latency(), lastState: 0, stateCount: 0, stateWindow: this.now(), authority: this.authoritative ? new Authority({ p: p.p, dt: 1 / this.simRate }) : null, unsub: [] };
        this.players.set(sessionId, p); this.sessions.set(sessionId, sess);
        sess.unsub.push(transport.onMessage((m) => this.handle(sessionId, m)));
        sess.unsub.push(transport.onClose((code, reason) => this.leave(sessionId, reason || ('close ' + code))));
        transport.send(enc.welcome({ sessionId, space: this.id, room: { id: this.id, name: this.name, preset: this.preset, tone: this.tone, minRole: this.minRole, skin: this.def.skin || null, theme: this.def.theme || null },
          rung: p.rank, rank: rung, role: p.role, tick: this.tick_, authoritative: this.authoritative, zones: this.zones, spawn: p.p, insecure: this.insecure || undefined,
          snap: this.snapshot(false) }));
        this.broadcast(enc.joined(p), [sessionId]);
        this.hooks.onJoin?.(p, this);
        return { ok: true, player: p, sessionId };
      }
      leave(sessionId, reason = 'left') {
        const sess = this.sessions.get(sessionId); if (!sess) return false;
        for (const u of sess.unsub) try { u(); } catch (e) { /* gone */ }
        this.sessions.delete(sessionId); this.players.delete(sessionId);
        for (const ag of this.agents.values()) if (ag.focus === sessionId) { ag.focus = null; ag.arm = null; }
        this.broadcast(enc.left(sessionId, reason));
        this.hooks.onLeave?.(sess.player, reason, this);
        return true;
      }
      close(reason = 'room closed') { for (const [sid, s] of [...this.sessions]) { this.leave(sid, reason); try { s.transport.close(1001, reason); } catch (e) { /* gone */ } } }

      // ── wire ──
      send(obj, sessionId) { const s = this.sessions.get(sessionId); return s ? s.transport.send(obj) : false; }
      broadcast(obj, except = []) { let n = 0; for (const [sid, s] of this.sessions) if (!except.includes(sid)) { if (s.transport.send(obj)) n++; } return n; }
      strike(sessionId, code, message, extra) {
        const s = this.sessions.get(sessionId); if (!s) return;
        s.player.invalid++;
        s.transport.send(enc.error(code, message, extra));
        if (s.player.invalid >= INVALID_LIMIT) { this.leave(sessionId, 'too many invalid messages'); try { s.transport.close(1008, 'invalid'); } catch (e) { /* gone */ } }
      }
      handle(sessionId, raw) {
        const s = this.sessions.get(sessionId); if (!s) return { ok: false, code: 'no-session' };
        const r = parseClient(raw);
        if (!r.ok) { this.strike(sessionId, r.code, r.message); return r; }
        const m = r.msg, p = s.player, t = this.now();
        switch (m.type) {
          case 'hello': this.strike(sessionId, 'invalid', 'already joined'); break;
          case 'ping': s.transport.send(enc.pong(m.t, t)); if (t - m.t >= 0 && t - m.t < 60_000) { const l = s.latency.sample(t - m.t); p.latency = Math.round(l.latency); p.jitter = Math.round(l.jitter); } break;
          case 'state': return this.onState(s, m, t);
          case 'cmd': return this.onCmd(s, m);
          case 'msg': return this.onMsg(s, m);
          case 'event': return this.onEvent(s, m);
          case 'rtc': case 'mirror': case 'lost': this.hooks.onRelay?.(sessionId, m, this); return { ok: true, relayed: true };   // the anchor's, not the room's
        }
        this.hooks.onMessage?.(p, m, this);
        return { ok: true };
      }
      onState(s, m, t) {
        const p = s.player;
        if (this.authoritative) { this.strike(p.sessionId, 'invalid', 'state is ignored on an authoritative room; send cmd'); return { ok: false, code: 'authoritative' }; }
        if (t - s.stateWindow >= 1000) { s.stateWindow = t; s.stateCount = 0; }
        if (++s.stateCount > STATE_HZ_MAX * 2) return { ok: false, code: 'rate' };            // silently dropped: the wire is the limit, not the player
        const z = zoneAt(this.zones, m.p);
        if (z && !atLeast(p.rung, z.minRole)) {
          this.strike(p.sessionId, 'zone-locked', 'zone ' + z.id + ' requires ' + z.minRole, { zone: z.id, minRole: z.minRole, p: p.p });
          return { ok: false, code: 'zone-locked', zone: z.id };
        }
        p.p = m.p; p.r = m.r; p.a = m.a; p.s = m.s; if (m.txt !== undefined) p.txt = m.txt; p.updatedAt = t; p.tick = this.tick_;
        const prevZone = p.zone; p.zone = z?.id || null;
        if (p.zone !== prevZone) this.hooks.onZone?.(p, p.zone, prevZone, this);
        const portal = portalReach(this.zones, p.p);
        if (portal && s.lastPortal !== portal.zone) { s.lastPortal = portal.zone; s.transport.send(enc.msg('room', { portal: portal.zone, to: portal.to })); this.hooks.onPortal?.(p, portal, this); }
        else if (!portal) s.lastPortal = null;
        this.hooks.onMessage?.(p, m, this);
        return { ok: true };
      }
      onCmd(s, m) {
        if (!s.authority) { this.strike(s.player.sessionId, 'invalid', 'cmd needs an authoritative room; send state'); return { ok: false, code: 'not-authoritative' }; }
        const res = s.authority.feed(m);
        if (res === 'stale') return { ok: false, code: 'stale' };
        this.hooks.onMessage?.(s.player, m, this);
        return { ok: true, queued: res === 'queued' };
      }
      onMsg(s, m) {
        const p = s.player;
        if (m.to && this.agents.has(m.to)) {
          const ag = this.agents.get(m.to), text = typeof m.data === 'string' ? m.data : m.data?.text;
          const day = new Date(this.now()).toISOString().slice(0, 10);
          const pr = ag.onMsg(p, text, { day }).then((effects) => this.applyEffects(effects, ag, p)).catch((e) => this.log?.('aivatar msg error', e?.message || e));
          this.hooks.onMessage?.(p, m, this);
          return { ok: true, pending: pr };
        }
        if (m.to) { if (!this.sessions.has(m.to)) { this.strike(p.sessionId, 'invalid', 'unknown recipient'); return { ok: false, code: 'unknown-to' }; } this.send(enc.msg(p.sessionId, m.data, m.to), m.to); }
        else this.broadcast(enc.msg(p.sessionId, m.data), [p.sessionId]);
        this.hooks.onMessage?.(p, m, this);
        return { ok: true };
      }
      onEvent(s, m) {
        const p = s.player, effects = [];
        if (m.name === 'portal') {
          const z = this.zones.find((x) => x.id === m.data.to) || this.zones.find((x) => x.portalTo === m.data.to);
          if (!z) { this.strike(p.sessionId, 'invalid', 'unknown portal'); return { ok: false, code: 'unknown-portal' }; }
          if (!atLeast(p.rung, z.minRole)) { this.strike(p.sessionId, 'zone-locked', 'portal to ' + z.id + ' requires ' + z.minRole, { zone: z.id, minRole: z.minRole, p: p.p }); return { ok: false, code: 'zone-locked' }; }
        }
        for (const ag of this.agents.values()) effects.push(...ag.onEvent(p, m));
        this.applyEffects(effects, null, p);
        this.hooks.onMessage?.(p, m, this);
        return { ok: true, effects };
      }
      applyEffects(effects, agent, player) {
        for (const e of effects || []) {
          if (e.type === 'say') { if (e.to) this.send(enc.say(e.agent, e.text, e.emotion, e.to), e.to); else this.broadcast(enc.say(e.agent, e.text, e.emotion)); }
          else if (e.type === 'voucher') this.hooks.onVoucher?.(e, player, this);
          this.hooks.onEffect?.(e, player, this);
        }
        return effects;
      }

      // ── time ──
      /** one sim step: agents move, authorities advance + ack */
      update(dt = SIM_DT) {
        this.simTick++;
        const effects = [];
        for (const ag of this.agents.values()) effects.push(...ag.update(dt, this.players));
        this.applyEffects(effects, null, null);
        if (this.authoritative) for (const [sid, s] of this.sessions) {
          const ack = s.authority.update();
          const p = s.player; p.p = ack.checkpoint.p; p.a = s.authority.state.moving ? (s.authority.state.sprint ? 'run' : 'walk') : (s.authority.state.grounded ? 'idle' : 'jump');
          p.r = [0, s.authority.state.yaw, 0]; p.updatedAt = this.now(); p.tick = ack.tick;
          const z = zoneAt(this.zones, p.p);
          if (z && !atLeast(p.rung, z.minRole)) { s.authority.teleport(s.lastGood || this.spawnFor(p.index)); p.p = s.authority.state.p; s.transport.send(enc.error('zone-locked', 'zone ' + z.id + ' requires ' + z.minRole, { zone: z.id, minRole: z.minRole, p: p.p })); }
          else s.lastGood = p.p;
          p.zone = zoneAt(this.zones, p.p)?.id || null;
          s.transport.send(enc.ack(ack.tick, ack.seq, ack.checkpoint));
        }
        this.hooks.onUpdate?.(dt, this);
        return effects;
      }
      /** one network tick: broadcast the delta snapshot */
      tick() {
        this.tick_++;
        const snap = this.snapshot(false), d = delta(this.lastSnap, snap);
        this.lastSnap = snap;
        const wire = enc.snap(d.tick, d.ts, d.players, d.agents, d.full);
        if (d.playersGone) wire.playersGone = d.playersGone; if (d.agentsGone) wire.agentsGone = d.agentsGone;
        this.broadcast(wire);
        return wire;
      }
      /** apply a snapshot from elsewhere (an anchor seeding a new host, a host restoring after repoint) */
      restore(snap) { if (!snap) return; for (const [id, a] of Object.entries(snap.agents || {})) { const ag = this.agents.get(id); if (ag) { ag.p = [...a.p]; ag.r = [...a.r]; ag.a = a.a; } } this.tick_ = Math.max(this.tick_, snap.tick || 0); }
      snapshot(changedOnly = false) {
        const players = {}, agents = {};
        for (const p of this.players.values()) players[p.sessionId] = { p: p.p, r: p.r, a: p.a, s: p.s, txt: p.txt, name: p.name, rank: p.rank, role: p.role, zone: p.zone, tick: p.tick, updatedAt: p.updatedAt, latency: p.latency, jitter: p.jitter, ...(p.avatar ? { avatar: p.avatar } : {}) };
        for (const ag of this.agents.values()) agents[ag.id] = ag.snapshot();
        const snap = { ...emptySnapshot(this.tick_, this.now()), players, agents };
        return changedOnly ? delta(this.lastSnap, snap) : snap;
      }
      stats() { return { id: this.id, name: this.name, minRole: this.minRole, preset: this.preset, tone: this.tone, players: this.players.size, agents: this.agents.size, tick: this.tick_, authoritative: this.authoritative, maxPlayers: this.maxPlayers, zones: this.zones.map((z) => ({ id: z.id, minRole: z.minRole, portalTo: z.portalTo || null })) }; }
    }

    function createRoom(def, opts = {}) { return new Room(def, opts); }

    __exports["GESTURES"] = GESTURES;
    __exports["v3"] = v3;
    __exports["DEFAULTS"] = DEFAULTS;
    __exports["Latency"] = Latency;
    __exports["sessionIdFor"] = sessionIdFor;
    __exports["Room"] = Room;
    __exports["createRoom"] = createRoom;
    return __exports;
  })();

  // ── core/index.mjs ──
  __mods["index"] = (function () {
    var __exports = {};
    __exports["protocol"] = __get("protocol");
    __exports["ladder"] = __get("ladder");
    __exports["zones"] = __get("zones");
    __exports["arcball"] = __get("arcball");
    __exports["snapshot"] = __get("snapshot");
    __exports["sim"] = __get("sim");
    __exports["seed"] = __get("seed");
    __exports["riddle"] = __get("riddle");
    __exports["aivatar"] = __get("aivatar");
    __exports["rooms"] = __get("rooms");
    __exports["triad"] = __get("triad");
    __exports["transport"] = __get("transport");
    /*! cyborgd — core index · (c) 2026 BANKON / PYTHAI · MIT · upstream patterns © oncyberio (MIT) */
    // The isomorphic core: PURE JS, no node-only imports, no Buffer/fs/process. Time is injected via now(),
    // randomness only from seeds. Runs unchanged in a browser (dist/cyborgd-core.js → window.CyborgdCore)
    // where a participant HOSTS their own space, and in the daemon where the anchor hosts as failover.























    const CORE_VERSION = '0.0.1-alpha';

    __exports["VERSION"] = __get("protocol").VERSION;
    __exports["parseClient"] = __get("protocol").parseClient;
    __exports["enc"] = __get("protocol").enc;
    __exports["guards"] = __get("protocol").guards;
    __exports["isServerMessage"] = __get("protocol").isServerMessage;
    __exports["INVALID_LIMIT"] = __get("protocol").INVALID_LIMIT;
    __exports["CLIENT_TYPES"] = __get("protocol").CLIENT_TYPES;
    __exports["SERVER_TYPES"] = __get("protocol").SERVER_TYPES;
    __exports["LADDER"] = __get("ladder").LADDER;
    __exports["rankOf"] = __get("ladder").rankOf;
    __exports["rungName"] = __get("ladder").rungName;
    __exports["atLeast"] = __get("ladder").atLeast;
    __exports["rungOfClaim"] = __get("ladder").rungOfClaim;
    __exports["Room"] = __get("rooms").Room;
    __exports["createRoom"] = __get("rooms").createRoom;
    __exports["Latency"] = __get("rooms").Latency;
    __exports["Agent"] = __get("aivatar").Agent;
    __exports["createAgents"] = __get("aivatar").createAgents;
    __exports["BEHAVIOURS"] = __get("aivatar").BEHAVIOURS;
    __exports["Riddler"] = __get("riddle").Riddler;
    __exports["Matcher"] = __get("riddle").Matcher;
    __exports["triadStep"] = __get("triad").triadStep;
    __exports["Triad"] = __get("triad").Triad;
    __exports["elect"] = __get("triad").elect;
    __exports["emptyTriad"] = __get("triad").emptyTriad;
    __exports["ANCHOR"] = __get("triad").ANCHOR;
    __exports["stepSim"] = __get("sim").stepSim;
    __exports["InputQueue"] = __get("sim").InputQueue;
    __exports["Authority"] = __get("sim").Authority;
    __exports["initialState"] = __get("sim").initialState;
    __exports["idleCmd"] = __get("sim").idleCmd;
    __exports["CFG"] = __get("sim").CFG;
    __exports["delta"] = __get("snapshot").delta;
    __exports["apply"] = __get("snapshot").apply;
    __exports["mergeLWW"] = __get("snapshot").mergeLWW;
    __exports["SnapshotBuffer"] = __get("snapshot").SnapshotBuffer;
    __exports["project"] = __get("arcball").project;
    __exports["reach"] = __get("arcball").reach;
    __exports["shoulderOf"] = __get("arcball").shoulderOf;
    __exports["orbit"] = __get("arcball").orbit;
    __exports["LoopbackTransport"] = __get("transport").LoopbackTransport;
    __exports["RecordingTransport"] = __get("transport").RecordingTransport;
    __exports["BaseTransport"] = __get("transport").BaseTransport;
    __exports["isTransport"] = __get("transport").isTransport;
    __exports["rng"] = __get("seed").rng;
    __exports["hashSeed"] = __get("seed").hashSeed;
    __exports["choose"] = __get("seed").choose;
    __exports["CORE_VERSION"] = CORE_VERSION;
    return __exports;
  })();

  var core = __mods.index; core.modules = __mods; core.BUILD = {"version":"0.0.1-alpha","files":["arcball.mjs","ladder.mjs","protocol.mjs","riddle.mjs","seed.mjs","sim.mjs","snapshot.mjs","transport.mjs","triad.mjs","zones.mjs","aivatar.mjs","rooms.mjs","index.mjs"]};
  if (typeof module !== 'undefined' && module.exports) module.exports = core;
  root.CyborgdCore = core;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
