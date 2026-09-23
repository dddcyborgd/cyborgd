# cyborgd — the three-d cyborg daemon (0.0.1-alpha)

cyborgd is the network half of the DeltaVerse's cyborg experience: a single Node 24 process with
**zero npm dependencies** that is the *anchor* of a triad in which every participant is both a client
and a server. It hands out rooms, verifies who is in them (login333 claims → the privilege ladder),
runs the AI avatars ("aivatars") that greet, mirror, reach for and riddle the participants, signs the
EIP-712 vouchers the faucet contracts redeem, keeps the canonical snapshot of every space, and — when
no participant can host — hosts the space itself. The same room core runs unchanged in a browser
(`dist/cyborgd-core.js` → `window.CyborgdCore`), so a participant's machine can be the server of their
own space while cyborgd stays the rendezvous, the identity and the failover.

- Home: https://github.com/dddcyborgd/cyborgd · License: MIT (`LICENSE`) · Status: **0.0.1-alpha**
- Siblings: [dvengine](https://github.com/dddcyborgd/dvengine) (the browser engine + the peer/host lanes) ·
  [cyborg-contracts](https://github.com/dddcyborgd/cyborg-contracts) (CyborgSpace · CyborgDrop · CyborgFaucet)
- Consumer: the DeltaVerse (`~/DeltaVerse`, suite E13) — never the source of truth; edit here, then gather.

## Inspiration

The room and voucher patterns are ports of the oncyber game servers (MIT © oncyberio), vendored by
pinned sha under `archive/` and catalogued in `UPSTREAM.md` / `LIBRARY.md`:

- https://github.com/oncyberio — the org · https://oncyber.io — the product · https://docs.oncyber.io — the docs
- [oo-game-server-starter](https://github.com/oncyberio/oo-game-server-starter) — the GameRoom hooks + `player-state` tuple
- [game-server-v2](https://github.com/oncyberio/game-server-v2) — the authoritative headless ServerSpace, the matchmaker, and `template.md`'s riddle → reward flow
- [onchain-cc-server](https://github.com/oncyberio/onchain-cc-server) — the *mint-opportunity*: play, earn a signed permission, redeem it yourself
- [awe](https://github.com/oncyberio/awe) `examples/multiplayer` + `examples/auth-multiplayer` — snapshot interpolation, the net-platformer authority, prediction/reconciliation
- [Colyseus](https://colyseus.io) — the room server those examples run on (cyborgd keeps the room *shape*, not the framework)
- AIML by Dr. Richard S. Wallace (A.L.I.C.E., 1999) — the riddler keeps its two ideas: `*` wildcard patterns and `<srai>` reduction
- three.js [ArcballControls](https://threejs.org/examples/#misc_controls_arcball) — the sphere + hyperbolic-sheet surface the aivatar's arm reaches along

## THE TRIAD

```
        participant-HOST                          participant-CLIENT
   ┌────────────────────────┐                ┌────────────────────────┐
   │ window.CyborgdCore     │   RTCDataChannel (the peer lane)        │
   │ createRoom(doc)        │◄══════════════════════════════════════►│ state / cmd / event / msg
   │ update() · tick()      │   state · snap · say · ack             │ snap → interpolate
   └───────────┬────────────┘                └────────────┬───────────┘
               │ hello · mirror{tick,snap} · rtc          │ hello · rtc · lost
               │ ▲ peers · host · rtc                     │ ▲ peers · host · repoint · snap(anchor) · voucher
               ▼ │              wss://…/cyborg/ws         ▼ │
   ┌──────────────────────────────────────────────────────────────────┐
   │                        cyborgd — THE ANCHOR                      │
   │  rendezvous · identity (login333) · election · canonical snapshot│
   │  (last-writer-wins by tick) · faucet + EIP-712 vouchers          │
   │  · FAILOVER HOST (its own Room when nobody can host)             │
   └──────────────────────────────────────────────────────────────────┘
```

**Why every participant is both client and server.** A space belongs to the person who owns it, not
to a server. The host runs the very same simulation core the daemon runs (same file, same seeds, same
tick), so the world a participant sees is the world the host computes, and the anchor only has to
remember it. When the host closes the tab the anchor already holds the last mirrored snapshot, elects
the next eligible peer, and repoints everyone — the space never dies with a browser. When nobody
eligible remains, the anchor's own Room takes the space over; a client cannot tell the difference
except for `snap.anchor: true`.

**The state machine** (`core/triad.mjs`, pure: `triadStep(state, event) → { state, effects[] }`):

| role | who | how it is earned | what it sends | what it receives |
|---|---|---|---|---|
| `client` | any participant in a space | joining | `hello` `state`/`cmd` `event` `msg` `ping` `rtc` `lost` | `welcome` `peers` `host` `snap` `say` `ack` `voucher` `repoint` `rtc` |
| `host` | one peer per space, rung ≥ **member** | elected: owner → highest rank → earliest join → sid | everything a client sends, plus `mirror{tick,snap}` to the anchor and `snap` to peers | `peers`, `rtc` offers from joiners |
| `anchor` | cyborgd | always | `peers` `host` `repoint` `snap{anchor:true}` `error` | `mirror` (host only) `lost` `rtc` |

| event | transition | effects |
|---|---|---|
| `join{sid,rung,owner}` | owner arrives → owner hosts; no live host → first eligible peer hosts, else the anchor | `host{sessionId,reason}` to all on change · `repoint{host,tick}` to every non-winner · the joiner always gets `host{…}` + `snap{full,anchor:true}` from the canonical snapshot · `peers{list}` to all |
| `leave{sid}` | host left → re-election (`host-left`); last peer left → anchor hosts | `host` + `repoint` on change · `peers` to the rest · the leaver is dropped from the snapshot |
| `mirror{sid,tick,snap}` | host only; merged **last-writer-wins by tick per entity** | `error{not-host}` to a non-host |
| `lost{sid,host}` | the reported host is gone → re-election (`host-lost`) | `repoint{host,tick}` to the reporter |
| `rtc{sid,to,kind,payload}` | relayed **only** if `to` is in the same space (never to self) | `rtc{from,kind,payload}` to `to`, else `error{no-peer}` |
| `snapshot{sid}` | — | `snap{full,anchor:true}` |
| `reset` | the space forgets everything (a dynamic room emptied) | — |

## Architecture in one screen

```
core/       THE ISOMORPHIC CORE — pure JS, no node imports, no Math.random, time via now()
  protocol.mjs   cyborg/1 guards + encoders          ladder.mjs   the 8+1 privilege rungs
  rooms.mjs      Room: join/handle/update/tick        zones.mjs    sphere/box containment, portals, gating
  triad.mjs      the election + mirror state machine  snapshot.mjs delta / apply / mergeLWW / SnapshotBuffer
  aivatar.mjs    agents + BEHAVIOURS registry         arcball.mjs  Shoemake/Holroyd surface → arm reach, orbit
  riddle.mjs     AIML-like Matcher + Riddler          sim.mjs      deterministic platformer step, InputQueue, Authority
  transport.mjs  the Transport interface + Loopback   seed.mjs     mulberry32 + FNV-1a · index.mjs = the public API
daemon/     THE NODE ANCHOR
  cyborgd.mjs    entry: config from env, createDaemon(), --selftest, llms.txt
  ws.mjs         RFC 6455 server on node:http (no ws package)      http.mjs   router, JSON bodies, CORS
  signaling.mjs  Anchor: WsTransport, hello → room, triad effects   spaces.mjs cyborg-space/1 docs: store + tokenURI
  claim.mjs      login333 claim verify (exact port)                 runspace.mjs headless server components (vm scripts)
  faucet.mjs     the ladder: claim → rung → PoW → cooldown → sign   voucher.mjs EIP-712 Drip / SpaceInit / Claim
  pow.mjs        hashcash challenges                                rate.mjs   DripLimiter, Bucket
  state.mjs      JSONL ledgers + counters                           vault.mjs  bankon-vault/1 read side
  ethers.mjs     the ONE dependency: vendored ethers v6.16.0 UMD    protocol.mjs re-export of core/protocol.mjs
registries/ rooms.json · faucet-tokens.json · chains.json · riddles.json        dist/   cyborgd-core.js + MANIFEST.json
scripts/    build-core · seal-signer · library · doc-js · fetch-upstream          ops/    unit · env · apache · README
```

Two independent clocks per room: `update()` at `simRate` (60 Hz: agents move, authorities advance)
and `tick()` at `tickRate` (20 Hz: one delta `snap` broadcast). Both stop while a room is empty.

## The `cyborg/1` protocol

JSON text frames over WebSocket (or an RTCDataChannel — the core never sees the transport). Every
inbound message passes a guard in `core/protocol.mjs`; an invalid one answers `error` and counts a
strike (20 strikes → close 1008). Limits: `state` ≤ 40/s, `msg`/`event` data ≤ 4 KB, `rtc` payload ≤
16 KB, `mirror` snap ≤ 256 KB, `txt` ≤ 140 chars, name ≤ 32.

**client → server**

| type | example | notes |
|---|---|---|
| `hello` | `{"type":"hello","v":"cyborg/1","space":"agora","claim":"<login333 token>","name":"alice","avatar":{"kind":"aivatar","seed":"alice","tint":"#7ad7ff"},"role":"host","owner":true}` | first message, within 10 s; `claim` optional (participant, rung 0); `role`/`owner` are requests, the triad decides |
| `state` | `{"type":"state","p":[1,0,-2.5],"r":[0,1.57,0],"a":"walk","s":1,"txt":"hi"}` | the trusted lane; `p` within ±1e5; a zone the rung cannot enter → `error{zone-locked}` + push-back |
| `cmd` | `{"type":"cmd","tick":120,"seq":120,"mx":0,"my":1,"sprint":false,"jp":true,"jr":false,"jh":true,"yaw":0}` | the authoritative lane (`CYBORGD_AUTHORITATIVE=1`); answered by `ack` |
| `msg` | `{"type":"msg","to":"herald","data":{"text":"riddle please"}}` | `to` = a session (direct), an agent id (dialogue) or absent (broadcast) |
| `event` | `{"type":"event","name":"gesture","data":{"name":"smile"}}` | names: `portal{to}` `riddle{agent}` `reach{zone}` `gesture{name}` `focus{agent|null}` `item{name,action}` (action: use · raise · lower · select — items on the participant's field of influence: sceptre, orb…) `field{r,max,at?,mode?,links?}` (the participant's resizable FIELD OF INFLUENCE — mode `open` · `connected` (links) · `private` (signer only, needs a signed claim); `max` = the space extent − 1 — a thing must stay separate from infinity to be recognised; `at:"bound"` when the field reaches it) |
| `ping` | `{"type":"ping","t":1758600000000}` | feeds the EWMA latency/jitter |
| `rtc` | `{"type":"rtc","to":"p3a","kind":"offer","payload":{"sdp":"v=0…"}}` | kinds `offer` `answer` `ice`; relayed within the space, never inspected |
| `mirror` | `{"type":"mirror","tick":420,"snap":{"players":{"p1":{"p":[0,0,1],"r":[0,0,0],"a":"idle","s":1,"tick":420}},"agents":{"herald":{"p":[0,0,-4],"r":[0,3.14,0],"a":"greet"}}}}` | host only, 20 Hz; merged LWW by tick |
| `lost` | `{"type":"lost","host":"p2b"}` | "my host vanished" → `repoint` |

**server → client**

| type | example |
|---|---|
| `welcome` | `{"type":"welcome","v":"cyborg/1","rate":{"sim":60,"net":20},"sessionId":"p1","space":"agora","room":{"id":"agora","name":"The Agora","preset":"ARENA","tone":"open","minRole":"participant","skin":"fabric","theme":"#7ad7ff"},"rung":"member","rank":2,"role":"client","tick":0,"authoritative":false,"zones":[…],"spawn":[0.5,0,6.4],"snap":{…}}` (+ `"insecure":true` when claims are unverified) |
| `denied` | `{"type":"denied","reason":"rung too low","minRole":"member","rung":"participant"}` |
| `joined` | `{"type":"joined","sessionId":"p2","name":"bob","avatar":{"kind":"primitive"},"rank":"participant","rung":0,"role":"client"}` |
| `left` | `{"type":"left","sessionId":"p2","reason":"close 1000"}` |
| `snap` | `{"type":"snap","tick":421,"ts":1758600000123,"players":{"p1":{…}},"agents":{"herald":{…}},"playersGone":["p2"]}` — deltas after the first; `"full":true` on the first, `"anchor":true` when served from the canonical snapshot |
| `ack` | `{"type":"ack","tick":121,"seq":120,"checkpoint":{"p":[0,0,-0.05],"v":[0,0,-3],"grounded":true}}` |
| `msg` | `{"type":"msg","from":"p1","data":{"text":"hello all"}}` · from the room: `{"type":"msg","from":"room","data":{"portal":"members-gate","to":"journal:hall"}}` |
| `say` | `{"type":"say","agent":"herald","text":"Welcome to the Agora, participant.","emotion":"joy","to":"p1"}` |
| `voucher` | `{"type":"voucher","kind":"drip","faucet":"shambaluv-airdrop","chainId":1,"contract":"0xdf2C…1DEf3","to":"0xAl…ce","amount":"1000000000000000000000000000000","nonce":"8123…","deadline":1758603600,"primaryType":"Claim","domain":{…},"typeHash":"0x…","message":{…},"digest":"0x…","signature":"0x…","signer":"0x…","redeem":{"contract":"0xdf2C…","method":"claim(address recipient,uint256 amount,uint256 nonce,uint256 deadline,bytes signature)","args":[…]},"tokenId":"luv-welcome","symbol":"LUV","decimals":18,"rpc":["https://…"],"explorer":"https://etherscan.io","agent":"herald","riddle":"echo"}` |
| `pong` | `{"type":"pong","t":1758600000000,"serverT":1758600000042}` |
| `error` | `{"type":"error","code":"zone-locked","message":"zone vip requires overseer","zone":"vip","minRole":"overseer","p":[1,0,1]}` — codes: `invalid` `bad-json` `bad-shape` `unknown-type` `too-large` `zone-locked` `not-host` `no-peer` `not-in-space` `hello-timeout` `expected-hello` `no-faucet` + the faucet's |
| `peers` | `{"type":"peers","list":[{"sessionId":"p1","role":"host","rung":2,"rank":2,"owner":true},{"sessionId":"p2","role":"client","rung":0,"rank":0}]}` |
| `host` | `{"type":"host","sessionId":"p1","reason":"first-eligible"}` — reasons `owner` `first-eligible` `host-left` `host-lost`; `"sessionId":"anchor"` when the daemon hosts |
| `repoint` | `{"type":"repoint","host":"p1","tick":420}` |
| `rtc` | `{"type":"rtc","from":"p1","kind":"answer","payload":{…}}` |

## The aivatars

An agent definition (`registries/rooms.json` → `agents[]`, or a space doc): `{ id, kind:"aivatar",
type: iNFT|THOT|dNFT|aNFT, name, seed, spawn, zone, say[], riddle:{ids,reward}, behaviours[] }`.
Behaviours are a registry (`BEHAVIOURS` in `core/aivatar.mjs`); an agent runs all of them unless
`behaviours` lists a subset. All motion is seeded (`core/seed.mjs`), so host, anchor and replay agree.

| behaviour | trigger | motion | response |
|---|---|---|---|
| `wander` | idle, no player within 3 m, not focused | a seeded path inside its zone, ≤ 1.2 m/s, pauses 2–7 s at each target | animation `walk` / `idle` |
| `greet` | a player enters 3 m (edge-triggered; again on re-entry) | faces the player | animation `greet` 2.5 s · `say{text,emotion}` chosen by seed + player index, to that player |
| `mirror` | `event{gesture}` from a player within 6 m (`smile` `jawOpen` `browsUp` `nod` `greet` `wave` `point` `raise` `bow`) | faces the player | mirrors the gesture as its animation + a line (`jawOpen` → emotion `curious`) |
| `field` | `event{field}` — the participant's field changed (the DeltaVerse ALWAYS recognises it: degree = r/max × the hierarchy's `outflow` dial from `registries/field-policy.json`, `GET/POST /field-policy`, OVERSEER-editable); at the bound (extent − 1) | faces the participant, raises its arm | "the DeltaVerse recognises you"; greet range widens to the field radius |
| `item` | `event{item}` — the participant raised / used / selected an item on their **sphere of influence** (dvengine `DVSphere`: sceptre, orb) | `raise` → the aivatar raises its own arm · `use` → bows | a line naming the item (`use` → emotion `joy`) |
| `reach` | the **focused** player within 1.5 m | faces the player; the arm extends: `arm{extend,yaw,pitch}` from `arcball.reach(shoulderOf(p,yaw), chest)` — the player's chest projected onto the sphere/hyperbolic sheet around the right shoulder; `extend = dist/1.5` | animation `reach`; `arm` rides in the snapshot; cleared beyond 1.5 m or on unfocus |
| `focus` | `event{focus,{agent}}` | faces the player | dialogue mode ("I am listening."); `focus{agent:null}` ends it and resets the riddle session |
| `riddle` | `event{riddle,{agent}}` or the words *riddle* / *yes* / *ok* in `msg{to:agent}` | faces the player | offer → the answer (one attempt per 60 s, hint on request) → **correct once per player per agent per UTC day** ⇒ effect `{type:"voucher",kind:"drip",token,amount,to}` → the anchor's faucet issues the voucher (no PoW: identity was proven at join) |

Non-riddle chat that no AIML category matches goes to `CYBORGD_LLM_URL` when set (one short sentence),
else "Say "riddle" and I will offer you one."

## The faucet

The ladder, one function per rung (`daemon/faucet.mjs`):

1. `GET /faucet/tokens` → the registry (`registries/faucet-tokens.json`, `enabled` entries, signer address)
2. `GET /faucet/challenge` → `{ challenge, bits:21, ttl:300 }` — 32 random bytes, single use, ledgered
3. `POST /faucet/drip` `{ token, address, claim, pow:{challenge,nonce} }` →
   login333 `claimVerify` → `rung ≥ token.minRung` → hashcash `sha256(challenge+":"+nonce)` with ≥ `bits`
   leading zero bits → cooldown + daily cap per **address and per claim sub** (`state/faucet.jsonl`, replayed at boot)
   → deterministic nonce `keccak256(sub|token|day|counter)` with a persisted counter → EIP-712 sign → `{ voucher }`
4. `GET /faucet/status?address=` → cooldowns, today's count, the last drips

Errors: `unknown-token` 404 · `bad-address` 400 · `bad-claim`/`no-claim` 401 · `rung` 403 · `pow` 403 ·
`cooldown`/`daily-cap` 429 (`retryAfterSec`) · `no-signer` 503.

**Token registry** (`registries/faucet-tokens.json`): `luv-welcome` (1e12 LUV, once per wallet ever, via
ShambaLuvAirdrop) · `scientific` (1 SCIEN·TIFIC/day, member) · `luv` (1000 LUV, 6/day, player) · `0g-galileo`
(0.1 0G testnet gas) · `0g-aristotle` (0.01 0G, trader) · `arc-testnet` (disabled until `RPC_5042002`).

**EIP-712 domains + typehashes** (verbatim from cyborg-contracts / ShambaLuvAirdrop; `test/voucher.test.mjs` pins them):

| faucet kind | domain | primary type string |
|---|---|---|
| `cyborg-faucet` | `{name:"CyborgFaucet",version:"1",chainId,verifyingContract}` | `Drip(address token,address to,uint256 amount,uint256 nonce,uint256 deadline)` |
| `cyborg-space` | `{name:"CyborgSpace",version:"1",chainId,verifyingContract}` | `SpaceInit(address to,uint256 roomId,uint256 inftTokenId,bytes32 thotRoot,string sceneURI,bytes32 sceneHash,uint256 nonce,uint256 deadline)` |
| `shambaluv-airdrop` | `{name:"ShambaLuvAirdrop",version:"1",chainId,verifyingContract}` | `Claim(address recipient,uint256 amount,uint256 nonce,uint256 deadline)` |

**Redemption** is by the participant, from their own wallet, with the `voucher.redeem` tuple:
`CyborgFaucet.drip(token,to,amount,nonce,deadline,sig)` (`token = address(0)` for native gas) or
`ShambaLuvAirdrop.claim(recipient,amount,nonce,deadline,signature)`. The daemon never holds funds and
never sends a transaction. Vouchers expire after 3600 s.

**The LUV one-shot welcome**: the Herald in the Agora offers three riddles; the first correct answer
yields a `luv-welcome` voucher — 1e12 LUV, cooldown 365 days, cap 1/day — redeemed on
`ShambaLuvAirdrop` `0xdf2C1836550c5711EF9c021cB0de86241dc1DEf3` (chain 1), whose signer must be set to
cyborgd's signer address (`ShambaLuvAirdrop.setSigner`, an OVERLORD act) and which must be funded.

## Authoritative vs trusted lanes

| | trusted (default) | authoritative (`CYBORGD_AUTHORITATIVE=1`) |
|---|---|---|
| the client sends | `state{p,r,a,s,txt}` — its own position | `cmd{tick,seq,mx,my,sprint,jp,jr,jh,yaw}` — its intent |
| the server does | rate-limits (40/s), gates zones by rung (push-back), records | runs `core/sim.mjs` (walk 3 · sprint 6 · jump 5 · g 9.81, coyote 0.1 s) per player and answers `ack{tick,seq,checkpoint}` |
| cheating | position is trusted; only zones are enforced | the client predicts, rolls back to the checkpoint on mismatch (dvengine `net/interp.js`) |
| cost | ~free | 60 Hz per player, deterministic to 1e-6 |

Both lanes share zones, aivatars, snapshots and the triad; a host in the browser runs whichever the
space doc asks for.

## Registries — and how to extend each

| file | one entry | add one by |
|---|---|---|
| `registries/rooms.json` | `{ id, name, preset, tone, minRole, skin, theme, spawn, zones[], agents[], tickRate, simRate, maxPlayers }` | **a room**: append an object; `id` is the space id; zones are `{id,minRole,bounds:{c,r}|{min,max},portalTo?}`; restart |
| `rooms.json` → `agents[]` | `{ id, kind:"aivatar", type, name, seed, spawn, zone, say[], riddle:{ids,reward}, behaviours[] }` | **an agent**: append to a room's `agents`; `seed` fixes its personality |
| `core/aivatar.mjs` → `BEHAVIOURS` | `name: { update(agent, dt, players, ctx) → effects[], event(agent, player, ev) → effects[] }` | **a behaviour**: add a key; name it in an agent's `behaviours`; effects are `say` / `animation` / `voucher`; rebuild `dist/` |
| `registries/faucet-tokens.json` | `{ id, chainId, symbol, decimals, contract, token, faucet, amount, cooldownSec, capPerDay, minRung, enabled }` | **a token**: append; `faucet` ∈ `cyborg-faucet` / `shambaluv-airdrop`; `contract` = the verifying contract |
| `registries/chains.json` | `{ chainId, name, symbol, decimals, explorer, rpc[], testnet, verified }` | **a chain**: append under its id; `RPC_<id>` in the env overrides `rpc` |
| `registries/riddles.json` | `{ id, q, a[], hint, reward:{token,amount} }` | **a riddle**: append; answers compare case/space/punctuation-insensitively; reference it from an agent's `riddle.ids` |
| `core/riddle.mjs` → `DEFAULT_CATEGORIES` | `{ pattern:"HELLO *", template:"…{0}" }` / `{ pattern:"HI *", srai:"HELLO" }` | **a chat category**: AIML-style; `*` captures, `{0}` fills, `srai` rewrites and rematches |
| a space document (`POST /space/:id`, member+) | `{ v:"cyborg-space/1", id, name, minRole, zones, agents, spawn, components:{…} }` | **a space at runtime**: no restart; `components` of type `spawn` / `zones` / `script` run headless (`daemon/runspace.mjs`), everything else is for dvengine |

## Configuration — every environment variable

| variable | default | meaning |
|---|---|---|
| `CYBORGD_HOST` / `CYBORGD_PORT` | `127.0.0.1` / `8790` | listen address (`--host` / `--port` override) |
| `LOGIN333_ISSUER` | unset → **insecure** | the login333 issuer address claims must be signed by |
| `CYBORGD_SIGNER_KEY` | — | the voucher signing key in hex (dev only) |
| `CYBORGD_VAULT` + `CYBORGD_VAULT_PASSPHRASE` [+ `CYBORGD_VAULT_ENTRY`] | — | a bankon-vault/1 file holding the key (production; `scripts/seal-signer.mjs` writes one) |
| `RPC_<chainId>` | `registries/chains.json` | RPC url per chain; also enables a token with `enabled:false` |
| `CYBORG_FAUCET_<chainId>` | the predicted create3d address | CyborgFaucet per chain |
| `LUV_AIRDROP` | `0xdf2C…1DEf3` | ShambaLuvAirdrop on chain 1 |
| `CYBORG_SPACE_<chainId>` | — | CyborgSpace (ERC-721) per chain for `tokenURI` reads of `"<chainId>:<tokenId>"` spaces |
| `IPFS_GATEWAY` | `https://ipfs.io/ipfs/` | for `ipfs://` tokenURIs |
| `CYBORGD_STATE_DIR` | `./state` | ledgers, counters, space docs |
| `CYBORGD_AUTHORITATIVE` | `0` | `1` → the authoritative lane |
| `CYBORGD_POW_BITS` | `21` | faucet hashcash difficulty |
| `CYBORGD_LLM_URL` | — | OpenAI-compatible chat completions for non-riddle aivatar chat |
| `CYBORGD_ETHERS` | `vendor/ethers/ethers.umd.min.js` | an explicit ethers UMD path (then the DeltaVerse's copy as fallback) |

## Run it

```sh
node daemon/cyborgd.mjs                                  # dev: 127.0.0.1:8790, claims UNVERIFIED (logged loudly), no faucet signer
CYBORGD_SIGNER_KEY=0x… LOGIN333_ISSUER=0x… node daemon/cyborgd.mjs
node daemon/cyborgd.mjs --selftest                       # 10 in-process checks, no listen
node --test test/*.test.mjs                              # 55 tests (npm test)
node scripts/build-core.mjs                              # dist/cyborgd-core.js + dist/MANIFEST.json, verified in a vm with only `window`
node scripts/build-core.mjs --check                      # exit 1 if dist/ would change
curl -s localhost:8790/health | jq · /rooms · /triad · /space/agora · /faucet/tokens · /llms.txt
```

A first client, in a browser console on any page (or Node 24, which has `WebSocket`):

```js
const ws = new WebSocket('ws://127.0.0.1:8790/ws');
ws.onmessage = (e) => console.log(JSON.parse(e.data));
ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', v: 'cyborg/1', space: 'agora', name: 'me' }));
// then: ws.send(JSON.stringify({ type: 'state', p: [0, 0, -3], r: [0, 0, 0], a: 'idle', s: 1 }))  → the Herald greets you
```

## Include cyborgd in any project

- **As a daemon**: copy the repo (or `git clone`), `node daemon/cyborgd.mjs`. Nothing to install.
  Put your rooms in `registries/rooms.json`, your tokens in `registries/faucet-tokens.json`.
- **As a local host in a page**: `<script src="dist/cyborgd-core.js"></script>` →
  `const room = window.CyborgdCore.createRoom(doc, { now: () => performance.now() })`; wrap each
  RTCDataChannel in the `Transport` interface (`core/transport.mjs`: `id · send · onMessage · onClose ·
  close · open`), `room.join(transport, identity, hello)`, call `room.update(1/60)` and `room.tick()` on
  timers, and `mirror` `room.snapshot()` to an anchor at 20 Hz. `LoopbackTransport.pair()` gives a
  single-tab host talking to itself.
- **As a library in Node**: `import { createRoom, triadStep, reach } from 'cyborgd/core/index.mjs'`.

## Production deployment

See [`ops/README.md`](ops/README.md): clone as the tenant, `/etc/cyborgd.env`, the sealed signer
(`scripts/seal-signer.mjs` → `daemon/vault.mjs`), the hardened systemd unit, the Apache snippet
(`/cyborg/ws` + `/cyborg/api`, CSP `connect-src wss://deltaverse.pythai.net`), the firewall (8790 on
loopback only), `curl /cyborg/api/health`, the ledgers, log rotation, upgrade = `git pull` + restart.

## How the DeltaVerse consumes it

- `scripts/gather-cyborg.mjs` (in the DeltaVerse) copies `dist/cyborgd-core.js` → `cyborg/core/cyborgd-core.js`
  and `skills/cyborgd/SKILL.md` → `cyborg/skills/cyborgd/SKILL.md`, stamping the source shas into
  `cyborg/dist/MANIFEST.json`. `deploy/web2/deploy-deltaverse.sh` clones/pulls the three siblings and
  installs `ops/cyborgd.service`.
- dvengine's `net/` lane is the browser side of the triad: **DVNet** (the socket to `/cyborg/ws`,
  `hello` with the login333 claim, reconnect), **DVPeer** (RTCDataChannels negotiated through `rtc`),
  **DVHost** (on `host{sessionId:me}` runs `window.CyborgdCore.createRoom(doc)`, feeds peers' messages
  in, broadcasts `snap`, mirrors the anchor at 20 Hz; on `repoint` forwards to the new host).
- the login333 claim flow: the participant signs in at `deltaverse.pythai.net/verify` (login333 issues
  `base64url(claim).signature` with `rung`), the page keeps the token, sends it in `hello.claim` and as
  `Authorization: Bearer` to `/cyborg/api/faucet/drip`; cyborgd verifies it against `LOGIN333_ISSUER`
  with the exact `claimVerify` port in `daemon/claim.mjs`.
- suite **E13** (`deploy/suites/cyborg.xml`, `deploy/artifacts/cyborg/`, `deploy/cyborg/OVERLORD_HANDOFF.md`)
  is the on-chain side: CyborgSpace · CyborgDrop · CyborgFaucet at create3d salts.

## Security + limitations

- Identity is a login333 claim; without `LOGIN333_ISSUER` the daemon is **insecure** on purpose and
  says so in every response — never expose that mode.
- The signer key is the only secret; it signs vouchers, nothing else. A leaked key drains the faucet
  contracts' balances up to their own on-chain limits; rotate = re-seal + redeploy the faucet /
  `setSigner` on the airdrop. Vouchers are bounded by deadline (1 h), nonce (never reused; ledgered) and
  the contracts' own replay protection.
- `rtc` payloads are relayed blind within a space (≤ 16 KB); the anchor never inspects SDP.
- The trusted lane trusts positions; the authoritative lane costs 60 Hz per player. Neither has
  collision geometry — the sim is a ground plane (rapier stays in the browser).
- Space-doc `script` components run in `node:vm` with a 50 ms limit per callback and a tiny API;
  `vm` is not a security boundary against a hostile member — only members (rung ≥ 2) may POST spaces.
- One process, in-memory rooms: horizontal scale is by space (a space lives on one anchor).
- `CyborgFaucet` at `0xfa0C…f199` is a **predicted** create3d address (not yet deployed); the LUV welcome
  needs `ShambaLuvAirdrop.setSigner` + funding first.
- Hashcash at 21 bits is a nuisance for a farm, not a wall.

## License

MIT — `LICENSE`. Upstream patterns © oncyberio (MIT), vendored under `archive/` with their licenses;
ethers © Richard Moore (MIT) under `vendor/ethers/`. Every source file carries its banner.
