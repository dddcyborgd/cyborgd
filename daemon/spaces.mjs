/*! cyborgd — spaces · (c) 2026 BANKON / PYTHAI · MIT · upstream patterns © oncyberio (MIT) */
// Space documents (cyborg-space/1): where a room's scene comes from.
//   1. state/spaces/<id>.json — POSTed by a member through /space/:id (the daemon's own store)
//   2. a CyborgSpace token: tokenURI(id) read over RPC when CYBORG_SPACE_<chainId> + RPC_<chainId>
//      are configured (data: URIs decoded inline, ipfs:// through IPFS_GATEWAY, http(s) fetched) — 60 s cache
// A document: { v:"cyborg-space/1", id, name, minRole?, preset?, tone?, zones?[], agents?[], spawn?,
//               components:{ <id>: { type, parent?, props… } } }  — only server-side component types
// (script · group · spawn · zones) are ever run by the daemon (see runspace.mjs); everything else is
// for dvengine in the browser.
import { JsonRpcProvider, Contract } from './ethers.mjs';
import { validateZones } from '../core/zones.mjs';
import { isRung } from '../core/ladder.mjs';

export const DOC_VERSION = 'cyborg-space/1';
export const CACHE_MS = 60_000;
const ERC721_URI_ABI = ['function tokenURI(uint256 tokenId) view returns (string)'];

export function validateSpaceDoc(doc) {
  const bad = [];
  if (!doc || typeof doc !== 'object') return ['document must be an object'];
  if (doc.v !== DOC_VERSION) bad.push('v must be ' + DOC_VERSION);
  if (typeof doc.id !== 'string' || !/^[A-Za-z0-9._:-]{1,64}$/.test(doc.id)) bad.push('id');
  if (doc.name !== undefined && typeof doc.name !== 'string') bad.push('name');
  if (doc.minRole !== undefined && !isRung(doc.minRole)) bad.push('minRole');
  if (doc.zones !== undefined) bad.push(...validateZones(doc.zones));
  if (doc.agents !== undefined && !Array.isArray(doc.agents)) bad.push('agents');
  if (doc.spawn !== undefined && !(Array.isArray(doc.spawn) && doc.spawn.length === 3)) bad.push('spawn');
  if (doc.components !== undefined && (typeof doc.components !== 'object' || Array.isArray(doc.components))) bad.push('components');
  for (const [id, c] of Object.entries(doc.components || {})) if (!c || typeof c.type !== 'string') bad.push('component ' + id + ' type');
  return bad;
}

/** the room definition a space doc yields (registry rooms take precedence for their ids) */
export function roomDefOf(doc) {
  return { id: doc.id, name: doc.name || doc.id, minRole: doc.minRole || 'participant', preset: doc.preset || 'SPACE', tone: doc.tone || 'open', skin: doc.skin || null, theme: doc.theme || null,
    zones: doc.zones || [], agents: doc.agents || [], spawn: doc.spawn || [0, 0, 0], maxPlayers: doc.maxPlayers || 64, tickRate: doc.tickRate || 20, simRate: doc.simRate || 60, source: doc.source || 'store' };
}

export class SpaceReader {
  constructor({ state = null, rpc = {}, contracts = {}, ipfsGateway = 'https://ipfs.io/ipfs/', now = Date.now, fetchFn = globalThis.fetch, log = null } = {}) {
    this.state = state; this.rpc = rpc; this.contracts = contracts; this.ipfsGateway = ipfsGateway; this.now = now; this.fetchFn = fetchFn; this.log = log;
    this.cache = new Map(); this.providers = new Map();
  }
  provider(chainId) {
    const url = this.rpc[String(chainId)]; if (!url) return null;
    if (!this.providers.has(chainId)) this.providers.set(chainId, new JsonRpcProvider(url, Number(chainId), { staticNetwork: true }));
    return this.providers.get(chainId);
  }
  get chainReady() { return Object.keys(this.contracts).filter((c) => this.rpc[c]); }
  /** local store first */
  local(id) { return this.state ? this.state.loadSpace(id) : null; }
  save(id, doc) { if (!this.state) throw new Error('no state dir'); this.cache.delete(String(id)); return this.state.saveSpace(id, { ...doc, id, savedAt: this.now() }); }
  async fromChain(chainId, tokenId) {
    const p = this.provider(chainId), addr = this.contracts[String(chainId)];
    if (!p || !addr) return null;
    const c = new Contract(addr, ERC721_URI_ABI, p);
    const uri = await c.tokenURI(BigInt(tokenId));
    return this.resolveURI(uri);
  }
  async resolveURI(uri) {
    if (!uri) return null;
    if (uri.startsWith('data:')) {
      const comma = uri.indexOf(','), meta = uri.slice(5, comma), payload = uri.slice(comma + 1);
      const text = /;base64/i.test(meta) ? Buffer.from(payload, 'base64').toString('utf8') : decodeURIComponent(payload);
      return JSON.parse(text);
    }
    let url = uri;
    if (uri.startsWith('ipfs://')) url = this.ipfsGateway + uri.slice(7).replace(/^ipfs\//, '');
    if (uri.startsWith('ar://')) url = 'https://arweave.net/' + uri.slice(5);
    if (!/^https?:\/\//.test(url)) throw new Error('unsupported tokenURI scheme');
    if (!this.fetchFn) throw new Error('fetch unavailable');
    const r = await this.fetchFn(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error('tokenURI fetch ' + r.status);
    return r.json();
  }
  /** get(id) — id = "<name>" (store) or "<chainId>:<tokenId>" (chain); { doc, source } | null */
  async get(id) {
    const key = String(id), hit = this.cache.get(key);
    if (hit && this.now() - hit.t < CACHE_MS) return hit.v;
    let v = null;
    const local = this.local(key);
    if (local) v = { doc: local, source: 'store' };
    else {
      const m = /^(\d+):(\d+)$/.exec(key);
      if (m) { try { const doc = await this.fromChain(m[1], m[2]); if (doc) v = { doc: { ...doc, id: key }, source: 'chain:' + m[1] }; } catch (e) { this.log?.('space read failed', key, e.message || e); } }
    }
    this.cache.set(key, { t: this.now(), v });
    return v;
  }
  list() { return this.state ? this.state.listSpaces() : []; }
}
