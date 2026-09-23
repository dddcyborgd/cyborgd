/*! cyborgd — state · (c) 2026 BANKON / PYTHAI · MIT · upstream patterns © oncyberio (MIT) */
// Durable state: append-only JSONL ledgers replayed at boot + a small counters JSON. No database;
// every fact the daemon must remember across a restart is one appended line.
//
//   state/faucet.jsonl     drips: {t, kind:'drip', token, address, sub, amount, nonce, reason, chain}
//                          challenges: {t, kind:'challenge', challenge, bits, exp} / {kind:'consumed', challenge}
//   state/rooms.jsonl      join/leave/voucher audit
//   state/counters.json    { nonce: <n>, ... } — the voucher nonce counter (never reused)
//   state/spaces/<id>.json cyborg-space/1 documents POSTed by members
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export class Ledger {
  constructor(file) { this.file = file; this.count = 0; mkdirSync(join(file, '..'), { recursive: true }); }
  append(entry) {
    const line = JSON.stringify({ t: entry.t ?? Date.now(), ...entry });
    appendFileSync(this.file, line + '\n');
    this.count++;
    return entry;
  }
  /** replay every well-formed line through fn (bad lines are skipped, counted in .skipped) */
  replay(fn) {
    this.skipped = 0; this.count = 0;
    if (!existsSync(this.file)) return 0;
    const lines = readFileSync(this.file, 'utf8').split('\n');
    for (const l of lines) {
      if (!l.trim()) continue;
      let e; try { e = JSON.parse(l); } catch (err) { this.skipped++; continue; }
      this.count++;
      try { fn(e); } catch (err) { this.skipped++; }
    }
    return this.count;
  }
  read() { const out = []; this.replay((e) => out.push(e)); return out; }
}

export class Counters {
  constructor(file) { this.file = file; this.data = {}; mkdirSync(join(file, '..'), { recursive: true }); this.load(); }
  load() { if (existsSync(this.file)) { try { this.data = JSON.parse(readFileSync(this.file, 'utf8')) || {}; } catch (e) { this.data = {}; } } return this.data; }
  get(k, def = 0) { return this.data[k] ?? def; }
  set(k, v) { this.data[k] = v; this.save(); return v; }
  /** atomic increment, persisted before returning (a crash between the two never reuses a value) */
  next(k) { const v = (this.data[k] ?? 0) + 1; this.data[k] = v; this.save(); return v; }
  save() {
    const tmp = this.file + '.tmp';
    writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    renameSync(tmp, this.file);
  }
}

/** the state directory: one object holding every ledger + the counters */
export class State {
  constructor(dir) {
    this.dir = dir;
    mkdirSync(join(dir, 'spaces'), { recursive: true });
    this.faucet = new Ledger(join(dir, 'faucet.jsonl'));
    this.rooms = new Ledger(join(dir, 'rooms.jsonl'));
    this.counters = new Counters(join(dir, 'counters.json'));
  }
  spacePath(id) { return join(this.dir, 'spaces', String(id).replace(/[^A-Za-z0-9._-]/g, '_') + '.json'); }
  saveSpace(id, doc) { const p = this.spacePath(id); const tmp = p + '.tmp'; writeFileSync(tmp, JSON.stringify(doc, null, 2)); renameSync(tmp, p); return p; }
  listSpaces() { const d = join(this.dir, 'spaces'); return existsSync(d) ? readdirSync(d).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)) : []; }
  loadSpace(id) { const p = this.spacePath(id); if (!existsSync(p)) return null; try { return JSON.parse(readFileSync(p, 'utf8')); } catch (e) { return null; } }
}

export function dayKey(t = Date.now()) { return new Date(t).toISOString().slice(0, 10); }   // UTC day
