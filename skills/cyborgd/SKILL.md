---
name: cyborgd
description: The operator skill for the three-d cyborg daemon and its two siblings (github.com/dddcyborgd — cyborgd · dvengine · cyborg-contracts) as consumed by the DeltaVerse — THE TRIAD (participant ⟷ anchor ⟷ participant; every participant is both client and server), the isomorphic room core (dist/cyborgd-core.js → window.CyborgdCore), the cyborg/1 protocol, rooms + zones + the privilege ladder, the aivatar behaviours with the arcball arm-reach, the AIML riddler, the faucet (login333 claim → rung → hashcash → cooldown → EIP-712 Drip/SpaceInit/Claim vouchers; the LUV one-shot welcome), the cyborg-space/1 scene format, the registries and how to extend each, ops (sealed bankon-vault signer, systemd, Apache /cyborg/ws + /cyborg/api), the E13 deploy + handoff with the create3d salts and one-way doors, and which sibling skill owns what. Use when working in ~/dddcyborgd/{cyborgd,dvengine,cyborg-contracts} or the DeltaVerse's cyborg/ consumer lane, or when the user says "cyborg", "cyborgd", "cyborgddd", "dvengine", "DVEngine", "DVScene", "DVTransform", "triad", "aivatar", "cyborg space", "CyborgFaucet", "faucet", "drip", "room server", "legacy mode", "oncyber", "awe", "gltf-transform", "studio", "dddcyborgd".
---

# cyborgd — the three-d cyborg daemon (0.0.1-alpha)

## 0. The model in one paragraph

A space belongs to the participant who owns it, not to a server. **THE TRIAD** makes every
participant both client and server: the elected **host** runs the daemon's own isomorphic room core
in their browser (`window.CyborgdCore.createRoom(doc)`), serves peers over RTCDataChannels and
mirrors its snapshot to the **anchor** (cyborgd, one Node 24 process, zero npm deps, `127.0.0.1:8790`
behind Apache); the anchor is rendezvous, identity (login333 claims → the 8+1 rung ladder), the
canonical snapshot (last-writer-wins by tick), the faucet (EIP-712 vouchers the participant redeems
on chain themselves) and the **failover host** when nobody eligible remains. dvengine is the browser
side (DVEngine / DVScene / DVNet / DVPeer / DVHost / DVVerse); cyborg-contracts is the chain side
(CyborgSpace · CyborgDrop · CyborgFaucet immutable, CyborgSpaceUpgradeable OVERSEER-owned). The
DeltaVerse *consumes* all three through `scripts/gather-cyborg.mjs` and is never the source of truth.

## 1. Where it lives

| what | where |
|---|---|
| the three homes | github.com/dddcyborgd/{dvengine,cyborgd,cyborg-contracts} — clones at `~/dddcyborgd/<repo>` (VPS: `/home/deltaverse/dddcyborgd/`) |
| cyborgd | `core/` (13 isomorphic modules) · `daemon/` (16) · `registries/` (rooms, faucet-tokens, chains, riddles) · `dist/cyborgd-core.js` (tracked) · `ops/` · `test/` (55) · `scripts/` · `archive/` (4 oncyber repos by sha) · `vendor/ethers/` (v6.16.0) · `skills/cyborgd/SKILL.md` (this file, mirrored into the DeltaVerse) |
| dvengine | `engine/` `components/` (48, folder-is-module) `net/{index,peer,host,interp}.js` `verse/` `xr/` `edit/` `editors/` `transform/` `studio/` `legacy/` `dist/` · 9 test files |
| cyborg-contracts | `src/{CyborgSpace,CyborgDrop,CyborgMultiSender,CyborgFaucet}.sol` · `src/upgradeable/` (UUPS) · 45 forge tests / 5 suites · `docs/AUDIT.md` · `UPSTREAM.md` |
| the DeltaVerse consumer | `cyborg/` (`core/cyborgd-core.js`, `dist/**`, `index.html`, `verse.html`, `legacy.html`, `live/`, `skills/cyborgd/SKILL.md`) · `deploy/artifacts/cyborg/*.json` · `deploy/suites/cyborg.xml` (suite **E13**) · `deploy/cyborg/` (README, AUDIT, OVERLORD_HANDOFF, rehearsal.json, TXIDS.jsonl) · `deploy/cyborg-{space,drop,faucet}-salt.json` · `scripts/gather-cyborg.mjs` · `scripts/deploy-cyborg-anvil.mjs` · `scripts/cyborg-smoke.mjs` · `docs/CYBORG.md` · `deploy/web2/deploy-deltaverse.sh` (clones the siblings, installs the unit) · `deploy/web2/deltaverse.pythai.net.conf` (the `/cyborg/ws` + `/cyborg/api` proxy) |

## 2. Non-negotiables

1. **MIT + credit oncyberio** in every banner and README (https://github.com/oncyberio · oncyber.io · docs.oncyber.io). The DeltaVerse's own `oncyber/` folder is **untouched** — cyborg is a separate, refined lane.
2. **Clean-room**: upstream vendored by **pinned sha** under `archive/` (`archive/SOURCES.json`, tarball sha256), ports are rewrites; **no CDN**, **zero npm** (ethers is the one library, vendored UMD; three.js/rapier only in dvengine's vendor/).
3. **DV\* globals** in the browser (`DVEngine`, `DVScene`, `DVNet`, `DVPeer`, `DVHost`, `DVVerse`, …; the core is `window.CyborgdCore`) — UMD files, importmaps only for dev.
4. **Folder-is-module**: `components/<type>/index.js`; registries are JSON and the code reads them; `library.mjs` generates `registry.json` + `LIBRARY.md`, never hand-edited.
5. **Immutable value contracts** (`owner() == address(0)` after `renounceOwnership`), one **OVERSEER-owned upgradeable** Space lane (CP2048-OVL), constructors take the owner explicitly and reject zero (create3d rule).
6. **Every mint / deploy / upgrade records a txid** (`deploy/cyborg/TXIDS.jsonl`, `implementationHistory()` on chain).
7. **The forbidden b-word** (the one that means a spending allowance) is never written anywhere in these repos — code, docs, commits.
8. **The DeltaVerse is never the source of truth**: edit in `~/dddcyborgd/<repo>`, commit there, then `npm run gather:cyborg` in the DeltaVerse. `cyborg/**` in the DeltaVerse is generated.
9. **The core stays isomorphic**: nothing under `core/` may name `process`, `Buffer`, `require`, `node:`, `Math.random`, timers or `fetch` (`test/core-isomorphic.test.mjs` enforces it; time is injected via `now()`, randomness from seeds).
10. **Keys**: the faucet signer lives in a sealed bankon-vault/1 file (`scripts/seal-signer.mjs` → `daemon/vault.mjs`), never in the repo or in an env var on a VPS. `LOGIN333_ISSUER` unset = insecure mode, loud, never public.

## 3. The triad in one screen

```
participant-HOST (CyborgdCore.createRoom) ◄══ RTCDataChannel ══► participant-CLIENT
        │ hello · mirror{tick,snap} · rtc                 │ hello · rtc · lost
        ▼ peers · host · rtc               wss /cyborg/ws  ▼ peers · host · repoint · snap{anchor} · voucher
   cyborgd — THE ANCHOR: rendezvous · identity · election · canonical snapshot (LWW by tick) · faucet · FAILOVER host
```

`core/triad.mjs` — `triadStep(state, ev) → { state, effects[] }`, pure. Election: **owner → highest
rank → earliest join → sid**, host needs rung ≥ member; the anchor hosts when nobody can. Events
`join · leave · mirror · lost · rtc · snapshot · reset`; effects are `{to, space, msg}`. The joiner is
always told `host{}` and served `snap{full,anchor:true}`. Host left → `host{reason:"host-left"}` to all
+ `repoint{host,tick}` to every non-winner. `mirror` from a non-host → `error{not-host}`. `rtc` only
within the same space, never to self, payload never inspected (≤ 16 KB).

## 4. Commands

```sh
# cyborgd (~/dddcyborgd/cyborgd)
node --test test/*.test.mjs             # 55 tests (npm test) — NOT `node --test test/` on Node 24
node daemon/cyborgd.mjs --selftest      # 10 checks in-process
node daemon/cyborgd.mjs                 # dev anchor on 127.0.0.1:8790 (insecure mode without LOGIN333_ISSUER)
node scripts/build-core.mjs [--check]   # dist/cyborgd-core.js + MANIFEST.json (vm-verified with only `window`)
node scripts/library.mjs [--check]      # registry.json + LIBRARY.md · node scripts/doc-js.mjs [--check]  # .mjs.xml sidecars
node scripts/fetch-upstream.mjs --check # the pinned archive
CYBORGD_VAULT_PASSPHRASE=… node scripts/seal-signer.mjs state/signer.vault.json   # seal the faucet signer
# dvengine (~/dddcyborgd/dvengine)
node scripts/build.mjs · node --test test/*.test.mjs · node scripts/library.mjs
# cyborg-contracts (~/dddcyborgd/cyborg-contracts)
forge build · forge test -vv            # 45 tests / 5 suites
# the DeltaVerse (~/DeltaVerse) — npm scripts
npm run gather:cyborg                   # pull dist + core + skill + artifacts into cyborg/ (--check: stale?)
npm run build:cyborg                    # forge build + dvengine build + gather
npm run test:cyborg                     # forge test + dvengine tests + cyborgd tests
npm run serve:cyborg                    # node ~/dddcyborgd/cyborgd/daemon/cyborgd.mjs
npm run faucet:selftest                 # cyborgd --selftest
npm run deploy:cyborg                   # scripts/deploy-cyborg-anvil.mjs (the anvil rehearsal)
npm run tauri:dev                       # the dapp shell (src-tauri/tauri.dapp.conf.json)
```

## 5. Registries and how to extend each

| registry | add … | how |
|---|---|---|
| `registries/rooms.json` | a room | append `{id,name,preset,tone,minRole,skin,theme,spawn,zones[],agents[]}`; zones `{id,minRole,bounds:{c,r}|{min,max},portalTo?}`; restart the daemon |
| `rooms.json` → `agents[]` | an agent | `{id,kind:"aivatar",type:iNFT|THOT|dNFT|aNFT,name,seed,spawn,zone,say[],riddle:{ids,reward},behaviours[]}` |
| `core/aivatar.mjs` → `BEHAVIOURS` | a behaviour | `name:{update(ag,dt,players,ctx)→effects[], event(ag,player,ev)→effects[]}`; effects `say`/`animation`/`voucher`; `node scripts/build-core.mjs` |
| `registries/faucet-tokens.json` | a token | `{id,chainId,symbol,decimals,contract,token,faucet:"cyborg-faucet"|"shambaluv-airdrop",amount(wei),cooldownSec,capPerDay,minRung,enabled}` |
| `registries/chains.json` | a chain | `{chainId,name,symbol,decimals,explorer,rpc[],testnet,verified}`; `RPC_<id>` overrides |
| `registries/riddles.json` | a riddle | `{id,q,a[],hint,reward:{token,amount}}`; reference from an agent's `riddle.ids` |
| `core/riddle.mjs` → `DEFAULT_CATEGORIES` | a chat category | AIML-style `{pattern:"HELLO *",template}` / `{pattern:"HI *",srai:"HELLO"}` |
| dvengine `components/<type>/index.js` | a client component | folder-is-module; `node scripts/library.mjs` regenerates `components/registry.json` |
| a space at runtime | `POST /cyborg/api/space/:id` (member+) | a cyborg-space/1 document; no restart |

## 6. Scene format (cyborg-space/1) + protocol

`{ v:"cyborg-space/1", id, name, minRole?, preset?, tone?, skin?, theme?, spawn?, zones?[], agents?[],
components:{ <id>: { type, parent?, …props } } }` — the scene document **is** the tokenURI of a
CyborgSpace (read via `CYBORG_SPACE_<chainId>` + `RPC_<chainId>`, `"<chainId>:<tokenId>"` as the space
id; `data:`/`ipfs://`/`ar://`/https resolved). The daemon runs only `group` / `spawn` / `zones` /
`script` components headless (`daemon/runspace.mjs`, `node:vm`, 50 ms per callback); every other type
(gltf, light, audio, …) is dvengine's.

`cyborg/1` (`core/protocol.mjs`): client → `hello state cmd msg event ping rtc mirror lost`; server →
`welcome denied joined left snap ack msg voucher say pong error peers host repoint rtc`. Trusted lane =
`state{p,r,a,s,txt}` (≤ 40/s, zones gate by rung with push-back); authoritative lane
(`CYBORGD_AUTHORITATIVE=1`) = `cmd{tick,seq,mx,my,sprint,jp,jr,jh,yaw}` → `ack{tick,seq,checkpoint}`
from `core/sim.mjs` (walk 3 · sprint 6 · jump 5 · g 9.81 · coyote 0.1 s, deterministic to 1e-6).
Full JSON examples: `README.md` § The cyborg/1 protocol.

## 7. Deploy + handoff (suite E13)

Artifacts `deploy/artifacts/cyborg/*.json`, salts `deploy/cyborg-{space,drop,faucet}-salt.json`
(`deltaverse.cyborg.<n>.v1`), manual `deploy/cyborg/OVERLORD_HANDOFF.md`, rehearsal on anvil
`npm run deploy:cyborg` → `deploy/cyborg/rehearsal.json`. **create3d addresses, the same on every EVM chain,
valid ONLY when bankon.eth deploys through factory `0xa5A2581d564248801cc5e06DbB764c99c170320A`:**

| contract | address |
|---|---|
| CyborgSpace | `0x5ace4baEc5b9F80cDe517Ed42D51F360Eb52595e` |
| CyborgDrop | `0xd0D0D1c6D250db2DD97368Da8CE1E70c46E993cc` |
| CyborgFaucet | `0xfa0C63b5BD49a5eE2e725379D1728F0E966Ef199` (predicted; `registries/faucet-tokens.json` uses it; `CYBORG_FAUCET_<chainId>` overrides) |

Order: bootstrap → deploy Faucet → MultiSender → Drop → Space → **configure + fund** (faucet limits,
`ShambaLuvAirdrop.setSigner(<cyborgd signer>)`, LUV funding) → **then** renounce. Grant first,
renounce second; never renounce before the faucet is funded. Every txid → `deploy/cyborg/TXIDS.jsonl`.

**One-way doors** (no undo): the create3d bootstrap on 0G 16661 · `renounceOwnership()` ×3 (Faucet,
Drop, Space) · `ShambaLuvAirdrop.setSigner` · `CyborgSpace.freeze(id)` · a faucet sunset (sweep to
treasury). The upgradeable Space lane is frozen only by upgrading to an implementation whose
`_authorizeUpgrade` reverts — deliberate, recorded.

EIP-712 (verbatim, pinned by `test/voucher.test.mjs`): `CyborgFaucet/1` `Drip(address token,address to,uint256 amount,uint256 nonce,uint256 deadline)` ·
`CyborgSpace/1` `SpaceInit(address to,uint256 roomId,uint256 inftTokenId,bytes32 thotRoot,string sceneURI,bytes32 sceneHash,uint256 nonce,uint256 deadline)` ·
`ShambaLuvAirdrop/1` `Claim(address recipient,uint256 amount,uint256 nonce,uint256 deadline)`.

Production: `ops/README.md` (tenant clone, `/etc/cyborgd.env`, sealed vault, unit, Apache, firewall,
health `curl /cyborg/api/health`, ledgers, upgrade = pull + restart; `deploy-deltaverse.sh update` does the pull/gather/restart).

## 8. Live numbers (2026-09-23)

- cyborgd: 13 core modules · 16 daemon modules · 4 registries (7 rooms · 6 tokens · 4 chains · 11 riddles) · **55 tests** in 14 files + 10 selftest checks · `dist/cyborgd-core.js` ≈ 96.8 KB, 62 exports · 4 archived upstream repos (114 files) · 1 vendored library.
- dvengine 0.0.2-alpha: 47 components · 92 tests · 205 files (input lane: DVJoystick/DVChords/DVMouseStick/DVSenseStick/DVControls; the field of influence DVField with sceptre + orb) · net lane 4 files (DVNet/DVPeer/DVHost/interp).
- cyborg-contracts: 4 immutable + 1 upgradeable (+ proxy) · **45 forge tests / 5 suites** · rehearsed on anvil, **not deployed**, not externally audited.
- DeltaVerse: suite E13 · `cyborg/` gathered · unit + Apache snippet wired in `deploy/web2/`.

## 9. Open findings

1. `CyborgFaucet` `0xfa0C…f199` is predicted, not deployed; `luv-welcome` needs `ShambaLuvAirdrop.setSigner` + funding — until then vouchers sign but cannot be redeemed.
2. The DeltaVerse's `test:cyborg` script still runs `node --test test/` for dvengine and cyborgd; on Node 24 that fails as "1 test / 1 fail" — change to `node --test test/*.test.mjs` (cyborgd's own `npm test` already does).
3. Insecure mode (no `LOGIN333_ISSUER`) is the dev default; a `/etc/cyborgd.env` copied from the example without editing runs insecure behind Apache — the health check shows `insecure:true`, watch it.
4. The trusted lane trusts positions; only zones are enforced. The authoritative sim is a ground plane (no rapier server-side).
5. `runspace` scripts in `node:vm` are a fence, not a sandbox against a hostile member.
6. One anchor process per space set; no clustering (spaces would shard by id if ever needed).
7. Chain 16661 RPC is unverified in `rpc-map.json`; Arc testnet (5042002) is permissioned and disabled.
8. The `legacy mode` page and the studio live in dvengine; cyborgd only serves the rooms they join.

## 10. Which skill owns what

| concern | skill |
|---|---|
| the 512 substrates, senses, DVDirector, themes (the *world* dvengine's DVVerse renders) | **substrate** |
| signatures, deploy + confirm multichain, create3d, renounce, OVERSEER hierarchy, the handoff | **overlord** |
| Tauri 2 handheld / desktop shells, Parsec Connect, the dapp lane | **parsec** |
| tokenURI / scene permanence on Arweave (`ar://` scene docs), the ~/permanence dapp | **arweave** (+ **ario** for ArNS/gateways) |
| the LUV rail: ShambaLuvAirdrop, `setSigner`, funding, luv.pythai.net | **luv** |
| this daemon, the triad, dvengine's net lane, the faucet ladder, the contracts as code, the registries, ops | **cyborgd** (this) |

## 11. Done means

- `node --test test/*.test.mjs` green in cyborgd (and dvengine), `forge test` green in cyborg-contracts, `node daemon/cyborgd.mjs --selftest` 10/10.
- `node scripts/build-core.mjs --check`, `node scripts/library.mjs --check`, `node scripts/doc-js.mjs --check` all exit 0; `dist/` committed.
- `npm run gather:cyborg` in the DeltaVerse copied the new core + skill (`cyborg/dist/MANIFEST.json` carries the new shas); `cyborg/**` never hand-edited.
- Every new file carries the MIT banner with the oncyberio credit; `UPSTREAM.md` / `CHANGELOG.md` updated; the forbidden b-word appears nowhere.
- On a VPS: `curl -s https://deltaverse.pythai.net/cyborg/api/health` → `ok:true`, `insecure:false`, `signer` = the address the contracts trust.
- Anything on chain: the txid is in `deploy/cyborg/TXIDS.jsonl` and the one-way doors were walked in the documented order.
