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
export const CFG = Object.freeze({ walk: 3, sprint: 6, jump: 5, gravity: 9.81, groundY: 0, coyote: 0.1, maxSpeed: 12 });
export const MAX_CMD_AGE_TICKS = 32;
export const SIM_RATE = 60;
export const SIM_DT = 1 / SIM_RATE;

/** a fresh sim state at position p */
export function initialState(p = [0, 0, 0], yaw = 0) {
  return { tick: 0, seq: 0, p: [p[0], p[1], p[2]], v: [0, 0, 0], yaw, grounded: p[1] <= CFG.groundY, coyote: 0, jumping: false, sprint: false, moving: false };
}

/** the neutral command frame */
export function idleCmd(tick = 0, seq = 0, yaw = 0) { return { tick, seq, mx: 0, my: 0, sprint: false, jp: false, jr: false, jh: false, yaw }; }

/** round to 1e-6 so float drift never differs across engines (all ops are IEEE-754 basic ops anyway) */
const q = (n) => Math.round(n * 1e6) / 1e6;

/** stepSim(prev, cmd, dt, cfg) → next (never mutates prev) */
export function stepSim(prev, cmd, dt = SIM_DT, cfg = CFG) {
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
export function replay(state, cmds, dt = SIM_DT, cfg = CFG) { let s = state; for (const c of cmds) s = stepSim(s, c, dt, cfg); return s; }

export function checkpointOf(s) { return { p: [...s.p], v: [...s.v], grounded: s.grounded }; }
export function ackOf(s) { return { tick: s.tick, seq: s.seq, checkpoint: checkpointOf(s) }; }

/** per-player command queue with dedupe + age drop */
export class InputQueue {
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
export class Authority {
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
