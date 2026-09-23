#!/usr/bin/env node
/*! cyborgd — daemon entry · (c) 2026 BANKON / PYTHAI · MIT · upstream patterns © oncyberio (MIT) */
// cyborgd — the three-d cyborg daemon. One process, one port: HTTP (health · rooms · triad · space
// docs · faucet) and the cyborg/1 WebSocket on /ws. It is THE ANCHOR of the triad: rendezvous,
// identity (login333 claims), faucet vouchers, the canonical snapshot, and failover host.
//
//   node daemon/cyborgd.mjs [--port 8790] [--host 127.0.0.1] [--selftest]
//
// Environment (every variable):
//   CYBORGD_PORT / CYBORGD_HOST       listen address (default 8790 / 127.0.0.1)
//   LOGIN333_ISSUER                   the login333 issuer address; UNSET → claims accepted UNVERIFIED,
//                                     responses carry insecure:true and the log says so loudly
//   CYBORGD_SIGNER_KEY                the voucher signing key (hex), OR
//   CYBORGD_VAULT + CYBORGD_VAULT_PASSPHRASE [+ CYBORGD_VAULT_ENTRY]   a bankon-vault file holding it
//   CYBORG_FAUCET_<chainId>           override the CyborgFaucet address per chain
//   LUV_AIRDROP                       override the ShambaLuvAirdrop address (chain 1)
//   RPC_<chainId>                     RPC url per chain (spaces reader, voucher hints)
//   CYBORG_SPACE_<chainId>            CyborgSpace (ERC-721) address per chain for tokenURI reads
//   CYBORGD_STATE_DIR                 ledgers + counters + space docs (default ./state)
//   CYBORGD_AUTHORITATIVE=0|1         rooms run the deterministic sim lane (cmd/ack) instead of trusted state
//   CYBORGD_LLM_URL                   an OpenAI-compatible /v1/chat/completions for non-riddle aivatar chat
//   CYBORGD_POW_BITS                  faucet hashcash difficulty (default 21)
//   IPFS_GATEWAY                      for ipfs:// tokenURIs (default https://ipfs.io/ipfs/)
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router, HttpError, VERSION } from './http.mjs';
import { setFieldPolicy } from '../core/index.mjs';
import { attach } from './ws.mjs';
import { State } from './state.mjs';
import { Faucet, FaucetError } from './faucet.mjs';
import { VoucherSigner } from './voucher.mjs';
import { openVaultFile, signerKeyFrom } from './vault.mjs';
import { SpaceReader, validateSpaceDoc } from './spaces.mjs';
import { Anchor } from './signaling.mjs';
import { identify, atLeast } from './claim.mjs';
import { isAddress } from './ethers.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

export function loadRegistries(root = ROOT) {
  const r = (n) => readJson(join(root, 'registries', n));
  return { rooms: r('rooms.json').rooms, tokens: r('faucet-tokens.json').tokens, chains: r('chains.json').chains, riddles: r('riddles.json').riddles, fieldPolicy: r('field-policy.json') };
}

export function configFromEnv(env = process.env, argv = process.argv.slice(2)) {
  const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const cfg = {
    port: Number(arg('--port') || env.CYBORGD_PORT || 8790), host: arg('--host') || env.CYBORGD_HOST || '127.0.0.1',
    issuer: env.LOGIN333_ISSUER && isAddress(env.LOGIN333_ISSUER) ? env.LOGIN333_ISSUER : null,
    signerKey: env.CYBORGD_SIGNER_KEY || null, vault: env.CYBORGD_VAULT || null, vaultPassphrase: env.CYBORGD_VAULT_PASSPHRASE || null, vaultEntry: env.CYBORGD_VAULT_ENTRY || null,
    stateDir: resolve(env.CYBORGD_STATE_DIR || join(ROOT, 'state')), authoritative: env.CYBORGD_AUTHORITATIVE === '1', llmUrl: env.CYBORGD_LLM_URL || null,
    powBits: env.CYBORGD_POW_BITS ? Number(env.CYBORGD_POW_BITS) : undefined, ipfsGateway: env.IPFS_GATEWAY || undefined,
    rpc: {}, faucets: {}, spaceContracts: {}, luvAirdrop: env.LUV_AIRDROP || null, selftest: argv.includes('--selftest'),
  };
  for (const [k, v] of Object.entries(env)) {
    let m;
    if ((m = /^RPC_(\d+)$/.exec(k)) && v) cfg.rpc[m[1]] = v;
    if ((m = /^CYBORG_FAUCET_(\d+)$/.exec(k)) && v && isAddress(v)) cfg.faucets[m[1]] = v;
    if ((m = /^CYBORG_SPACE_(\d+)$/.exec(k)) && v && isAddress(v)) cfg.spaceContracts[m[1]] = v;
  }
  return cfg;
}

export function signerFromConfig(cfg, log) {
  if (cfg.signerKey) return new VoucherSigner(cfg.signerKey);
  if (cfg.vault) {
    if (!cfg.vaultPassphrase) throw new Error('CYBORGD_VAULT set without CYBORGD_VAULT_PASSPHRASE');
    const v = openVaultFile(cfg.vault, cfg.vaultPassphrase);
    log?.('vault unlocked: ' + v.list().map((e) => e.id).join(', '));
    return new VoucherSigner(signerKeyFrom(v, cfg.vaultEntry));
  }
  return null;
}

/** an OpenAI-compatible chat seam for the aivatars (only when CYBORGD_LLM_URL is set) */
export function llmFromUrl(url, { fetchFn = globalThis.fetch, model = 'default', timeoutMs = 8000 } = {}) {
  if (!url) return null;
  return async (prompt, ctx = {}) => {
    const r = await fetchFn(url, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({ model, messages: [{ role: 'system', content: 'You are ' + (ctx.agent || 'an aivatar') + ', a cyborg AI avatar in the DeltaVerse. Answer in one short sentence.' }, { role: 'user', content: String(prompt).slice(0, 500) }], max_tokens: 80 }) });
    if (!r.ok) throw new Error('llm ' + r.status);
    const j = await r.json();
    return j.choices?.[0]?.message?.content || null;
  };
}

/** build the whole daemon (no listen) — tests and --selftest construct it in-process */
export function createDaemon(cfg, { log = (...a) => console.log('[cyborgd]', ...a), registries = loadRegistries(), now = Date.now } = {}) {
  if (registries.fieldPolicy) setFieldPolicy(registries.fieldPolicy);
  const state = new State(cfg.stateDir);
  const tokens = registries.tokens.map((t) => {
    const o = { ...t };
    if (t.faucet === 'cyborg-faucet' && cfg.faucets[String(t.chainId)]) o.contract = cfg.faucets[String(t.chainId)];
    if (t.faucet === 'shambaluv-airdrop' && cfg.luvAirdrop && isAddress(cfg.luvAirdrop)) o.contract = cfg.luvAirdrop;
    if (t.enabled === false && cfg.rpc[String(t.chainId)]) o.enabled = true;
    return o;
  });
  const chains = {}; for (const [id, c] of Object.entries(registries.chains)) chains[id] = { ...c, rpc: cfg.rpc[id] ? [cfg.rpc[id]] : c.rpc };
  const signer = signerFromConfig(cfg, log);
  const faucet = new Faucet({ tokens, chains, signer, state, issuer: cfg.issuer, now, bits: cfg.powBits });
  const spaces = new SpaceReader({ state, rpc: cfg.rpc, contracts: cfg.spaceContracts, ipfsGateway: cfg.ipfsGateway, now, log });
  const anchor = new Anchor({ registry: registries.rooms, spaces, state, issuer: cfg.issuer, faucet, riddles: registries.riddles, llm: llmFromUrl(cfg.llmUrl), authoritative: cfg.authoritative, now, log });
  for (const def of registries.rooms) anchor.makeRoom(def);
  const startedAt = now();

  const router = new Router({ log });
  const health = () => ({ ok: true, version: VERSION, name: 'cyborgd', ...anchor.stats(), insecure: anchor.insecure, signer: signer?.address || null, faucet: faucet.stats(), authoritative: cfg.authoritative, uptimeSec: Math.floor((now() - startedAt) / 1000), spaces: { store: spaces.list().length, chains: spaces.chainReady } });
  router.get('/health', health).get('/', health);
  router.get('/rooms', () => ({ rooms: [...anchor.rooms.values()].map((r) => r.stats()) }));
  router.get('/triad', () => anchor.summary());
  router.get('/space/:id', async ({ params }) => {
    const reg = registries.rooms.find((r) => r.id === params.id);
    if (reg) return { id: params.id, source: 'registry', doc: reg, room: anchor.rooms.get(params.id)?.stats() || null };
    const found = await spaces.get(params.id);
    if (!found) throw new HttpError(404, 'not-found', 'no space ' + params.id);
    return { id: params.id, source: found.source, doc: found.doc, room: anchor.rooms.get(params.id)?.stats() || null };
  });
  router.post('/space/:id', ({ params, body, claimToken }) => {
    let id; try { id = identify(claimToken, cfg.issuer); } catch (e) { throw new HttpError(401, 'bad-claim', String(e.message || e)); }
    if (!atLeast(id.rung, 'member')) throw new HttpError(403, 'rung', 'posting a space requires member', { rung: id.rank });
    if (registries.rooms.some((r) => r.id === params.id)) throw new HttpError(409, 'reserved', 'registry room ids are reserved');
    const doc = { ...(body || {}), id: params.id };
    const bad = validateSpaceDoc(doc); if (bad.length) throw new HttpError(400, 'invalid', 'cyborg-space/1: ' + bad.join('; '));
    const existing = spaces.local(params.id);
    if (existing && existing.owner && existing.owner.toLowerCase() !== String(id.sub).toLowerCase() && !atLeast(id.rung, 'overseer')) throw new HttpError(403, 'owner', 'this space belongs to another member');
    const path = spaces.save(params.id, { ...doc, owner: existing?.owner || id.sub, postedBy: id.sub });
    if (anchor.rooms.get(params.id)?.def.dynamic && anchor.rooms.get(params.id).size === 0) anchor.rooms.delete(params.id);
    state.rooms.append({ kind: 'space', space: params.id, sub: id.sub });
    return { ok: true, id: params.id, stored: path.replace(cfg.stateDir, 'state'), insecure: anchor.insecure || undefined };
  });
  // the field of influence policy — the OVERLORD hierarchy's two dials per rung; readable by all, editable by an OVERSEER+ claim
  router.get('/field-policy', () => ({ policy: registries.fieldPolicy, source: 'registries/field-policy.json' }));
  router.post('/field-policy', ({ body, claimToken }) => {
    let id; try { id = identify(claimToken, cfg.issuer); } catch (e) { throw new HttpError(401, 'bad-claim', String(e.message || e)); }
    if (!atLeast(id.rung, 'overseer')) throw new HttpError(403, 'rung', 'field-policy needs an OVERSEER or OVERLORD claim', { rung: id.rank });
    if (!body || typeof body.rungs !== 'object') throw new HttpError(400, 'shape', 'body.rungs required');
    for (const [k, v] of Object.entries(body.rungs)) { if (!v || typeof v.outflow !== 'number' || typeof v.inflow !== 'number') throw new HttpError(400, 'shape', 'rung ' + k + ' needs outflow+inflow'); registries.fieldPolicy.rungs[k] = { outflow: Math.max(0, Math.min(1, v.outflow)), inflow: Math.max(0, Math.min(1, v.inflow)) }; }
    setFieldPolicy(registries.fieldPolicy); log('field-policy updated by', id.sub, JSON.stringify(body.rungs));
    return { ok: true, policy: registries.fieldPolicy };
  });
  router.get('/faucet/tokens', () => ({ tokens: faucet.tokensPublic(), chains, insecure: anchor.insecure }));
  router.get('/faucet/challenge', () => faucet.challenge());
  router.post('/faucet/drip', async ({ body }) => { try { return await faucet.drip(body || {}); } catch (e) { if (e instanceof FaucetError) throw new HttpError(e.status, e.code, e.message, e.extra); throw e; } });
  router.get('/faucet/status', ({ query }) => { try { return faucet.status(query.address); } catch (e) { if (e instanceof FaucetError) throw new HttpError(e.status, e.code, e.message, e.extra); throw e; } });
  router.get('/llms.txt', () => ({ status: 200, body: llmsTxt(cfg, anchor), headers: { 'content-type': 'text/plain; charset=utf-8' } }));

  const timers = [];
  function startClocks() {
    for (const room of anchor.rooms.values()) armRoom(room);
  }
  function armRoom(room) {
    if (room._clocks) return;
    const sim = setInterval(() => { if (room.size) room.update(1 / room.simRate); }, 1000 / room.simRate);
    const net = setInterval(() => { if (room.size) room.tick(); }, 1000 / room.tickRate);
    sim.unref?.(); net.unref?.();
    room._clocks = [sim, net]; timers.push(sim, net);
  }
  const origMake = anchor.makeRoom.bind(anchor);
  anchor.makeRoom = (def, extra) => { const r = origMake(def, extra); if (daemon.running) armRoom(r); return r; };

  const daemon = {
    cfg, state, faucet, spaces, anchor, router, signer, registries, running: false, server: null, ws: null,
    async listen(port = cfg.port, host = cfg.host) {
      this.server = await router.listen(port, host);
      this.ws = attach(this.server, { path: '/ws', onConnection: (ws) => anchor.onConnection(ws) });
      this.running = true; startClocks();
      const a = this.server.address();
      log(`listening http://${a.address}:${a.port}  ws://${a.address}:${a.port}/ws  rooms=${anchor.rooms.size} signer=${signer?.address || 'NONE'} issuer=${cfg.issuer || 'NONE'}`);
      if (!cfg.issuer) log('WARNING: LOGIN333_ISSUER is unset — claims are accepted UNVERIFIED; every response carries insecure:true. Do not expose this to the internet.');
      if (!signer) log('faucet disabled: no CYBORGD_SIGNER_KEY / CYBORGD_VAULT');
      return this;
    },
    async close() {
      this.running = false;
      for (const t of timers) clearInterval(t);
      for (const r of anchor.rooms.values()) { r.close('shutdown'); r._clocks = null; }
      this.ws?.closeAll();
      await new Promise((res) => (this.server ? this.server.close(() => res()) : res()));
    },
  };
  return daemon;
}

export function llmsTxt(cfg, anchor) {
  return `# cyborgd ${VERSION} — the three-d cyborg daemon
> The anchor of THE TRIAD (participant ⟷ DeltaVerse ⟷ participant): rendezvous, identity (login333 claims),
> faucet vouchers (EIP-712), the canonical snapshot, and failover host. github.com/dddcyborgd/cyborgd (MIT).

## Endpoints
- GET /health · GET /rooms · GET /triad · GET /space/:id · POST /space/:id (member; cyborg-space/1)
- GET /faucet/tokens · GET /faucet/challenge · POST /faucet/drip {token,address,claim,pow:{challenge,nonce}} · GET /faucet/status?address=
- WS /ws — cyborg/1: hello · state · cmd · msg · event · ping · rtc · mirror · lost  ⇄  welcome · denied · joined · left · snap · ack · msg · voucher · say · pong · error · peers · host · repoint · rtc

## Rooms
${[...anchor.rooms.values()].map((r) => `- ${r.id} (${r.minRole}) — ${r.name}`).join('\n')}

## Mode
- claims: ${cfg.issuer ? 'verified against ' + cfg.issuer : 'UNVERIFIED (insecure)'} · authoritative: ${cfg.authoritative ? 'yes (cmd/ack)' : 'no (trusted state)'}
`;
}

// ── selftest: a subset of test/ run in-process, no listen ──
export async function selftest(log = console.log) {
  const { encodeFrame, decodeFrames, acceptKey } = await import('./ws.mjs');
  const { Wallet } = await import('./ethers.mjs');
  const { claimSign, claimVerify } = await import('./claim.mjs');
  const { solvePow, verifyPow } = await import('./pow.mjs');
  const { recover } = await import('./voucher.mjs');
  const core = await import('../core/index.mjs');
  const checks = [];
  const ok = (name, cond) => { checks.push({ name, ok: !!cond }); log((cond ? '  ok   ' : '  FAIL ') + name); };
  ok('ws accept key (RFC 6455 §4.2.2 example)', acceptKey('dGhlIHNhbXBsZSBub25jZQ==') === 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
  const f = decodeFrames(encodeFrame(1, 'x'.repeat(70000), { mask: true })); ok('ws 64-bit frame round trip', f.frames.length === 1 && f.frames[0].payload.length === 70000);
  const w = Wallet.createRandom(); const iat = Math.floor(Date.now() / 1000);
  const tok = await claimSign(w, { iss: w.address, clientID: 'ov', sub: '0x0000000000000000000000000000000000000001', tier: 'member', rung: 'player', name: null, iat, exp: iat + 60 });
  ok('login333 claim verifies', claimVerify(tok, w.address).rung === 'player');
  let tamper = false; try { claimVerify(tok, Wallet.createRandom().address); tamper = true; } catch (e) { /* expected */ } ok('untrusted issuer rejected', !tamper);
  const ch = '0'.repeat(64); const nonce = solvePow(ch, 8); ok('pow solve/verify', verifyPow(ch, nonce, 8));
  const signer = new VoucherSigner(w.privateKey);
  const v = await signer.drip({ chainId: 1, contract: '0x447aE1ACafec942210b8545218a3a5c5C24b3952', token: '0x99999923fAb5D50Df0F3b2F89a49d18EC82Bea79', to: w.address, amount: '1', nonce: '7', deadline: iat + 60 });
  ok('voucher recovers to signer', recover('cyborg-faucet', 1, v.contract, v.message, v.signature) === w.address);
  const tri = new core.Triad({ now: () => 1 });
  tri.step({ type: 'join', space: 's', sid: 'a', rung: 2 }); tri.step({ type: 'join', space: 's', sid: 'b', rung: 5 });
  ok('triad: first eligible hosts', tri.hostOf('s') === 'a');
  const eff = tri.step({ type: 'leave', space: 's', sid: 'a' }); ok('triad: failover + repoint', tri.hostOf('s') === 'b' && eff.some((e) => e.msg.type === 'host'));
  const room = core.createRoom({ id: 'r', zones: [{ id: 'z', minRole: 'overlord', bounds: { c: [5, 0, 0], r: 1 } }] }, { now: () => 0 });
  const [a, b] = core.LoopbackTransport.pair(); const got = []; b.onMessage((m) => got.push(m)); room.join(a, { rung: 2 }, {});
  b.send({ type: 'state', p: [5, 0, 0], r: [0, 0, 0], a: 'idle', s: 1 }); ok('room: zone-locked', got.some((m) => m.code === 'zone-locked'));
  ok('arcball: inside sphere', Math.abs(core.project([0, 0], 1.5)[2] - 1.5) < 1e-9);
  const failed = checks.filter((c) => !c.ok).length;
  log(`selftest: ${checks.length - failed}/${checks.length} ok`);
  return failed === 0;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const cfg = configFromEnv();
  if (cfg.selftest) { selftest().then((ok) => process.exit(ok ? 0 : 1)); }
  else {
    const d = createDaemon(cfg);
    d.listen().catch((e) => { console.error('[cyborgd] failed to start:', e.message || e); process.exit(1); });
    const stop = () => d.close().then(() => process.exit(0));
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
  }
}
