# UPSTREAM — provenance of archive/ and where each piece went

Every upstream repository is vendored **by pinned sha** under `archive/<repo>/` (fetched by
`scripts/fetch-upstream.mjs`, tarball sha256 recorded in `archive/SOURCES.json`) and never edited.
Ports are clean-room rewrites in plain ESM; the verdicts are computed by `scripts/library.mjs` from
`scripts/ports.json` into `LIBRARY.md` / `registry.json`. All upstream code is MIT © oncyberio.

| archive folder | repo @ sha | license | what it is | ported to |
|---|---|---|---|---|
| `archive/oo-game-server-starter/` | [oncyberio/oo-game-server-starter](https://github.com/oncyberio/oo-game-server-starter/tree/d9a11ed8ae16a5f385547cb4ed206c131635b713) `d9a11ed` | MIT (org licence; no LICENSE file in the repo) | the PartyKit room starter: `GameRoom<RoomState>` hooks (`onJoin/onLeave/onMessage/onUpdate`), `broadcast/send`, the `player-state` tuple `[px,py,pz,rx,ry,rz,animation,scale,vrmUrl,text]` | `core/rooms.mjs` (hooks, broadcast/send, join/leave) · `core/protocol.mjs` (`state{p,r,a,s,txt}`) |
| `archive/game-server-v2/` | [oncyberio/game-server-v2](https://github.com/oncyberio/game-server-v2/tree/e1b0fe16075bda3d4d7d1a2da1fadf01e2cec39f) `e1b0fe1` | MIT | Colyseus server: `src/cyber/abstract/` GameSession (tick vs sim rates, snapshot broadcast) · `src/cyber/ServerSpace/` headless space runner (rapier physics, scripts) · `src/express/` matchmaker · `template.md` the Ai riddle → reward tool | `core/rooms.mjs` (GameSession semantics) · `daemon/runspace.mjs` (partial: server components + vm scripts, **no rapier**) · `daemon/http.mjs` (`/rooms`, `/triad`) · `core/riddle.mjs` + `core/aivatar.mjs` (invite → present → capture → reward only on a correct answer) |
| `archive/onchain-cc-server/` | [oncyberio/onchain-cc-server](https://github.com/oncyberio/onchain-cc-server/tree/cc5c1de1f44e7fcf73e459ac52ec75aa449151e2) `cc5c1de` | MIT | the coin-collector server: `src/rooms/` **mint-opportunity** — play, earn a server-signed permission, redeem it yourself on chain | `daemon/faucet.mjs` · `daemon/voucher.mjs` (EIP-712 Drip / SpaceInit / Claim vouchers; the server never holds funds) |
| `archive/awe/` | [oncyberio/awe](https://github.com/oncyberio/awe/tree/04a07c8d75c114d8ea217d0870eeef2c6a65635a) `04a07c8` | MIT | `examples/multiplayer/shared/` snapshot-interpolation buffer · `examples/auth-multiplayer/shared/net-platformer/` the deterministic sim step, command frame, input queue, ack/reconciliation · `examples/*/server/` the Colyseus rooms | `core/snapshot.mjs` (`SnapshotBuffer`, `lerpEntity`; dvengine `net/interp.js`) · `core/sim.mjs` (`stepSim`, `InputQueue`, `Authority`, `cmd{tick,seq,mx,my,sprint,jp,jr,jh,yaw}` — the three.js Mover replaced by a flat kinematic body) · `core/rooms.mjs` + `daemon/ws.mjs` |

Other inspiration, not vendored: Colyseus (https://colyseus.io — the room shape those servers run on;
cyborgd re-implements the WebSocket server on `node:http`, RFC 6455 by hand) · AIML, Dr. Richard S.
Wallace / A.L.I.C.E. 1999 (`core/riddle.mjs` keeps `*` patterns and `srai`) · three.js
ArcballControls `unprojectOnTbSurface` after Shoemake 1992 / Holroyd (`core/arcball.mjs`) ·
mulberry32 (Tommy Ettinger, public domain) + FNV-1a (`core/seed.mjs`) · DeltaVerse
`server/login333.mjs` (`daemon/claim.mjs` is an exact port) and `engine/bankon-vault.js`
(`daemon/vault.mjs` read side, `scripts/seal-signer.mjs` write side) · ethers v6.16.0 (MIT,
`vendor/ethers/`).

Original to cyborgd: the triad (`core/triad.mjs`), the transport interface (`core/transport.mjs`),
the privilege ladder gating (`core/ladder.mjs`, `core/zones.mjs`), the aivatar behaviours and the
arcball arm reach (`core/aivatar.mjs`), hashcash + cooldown ledgers (`daemon/pow.mjs`, `daemon/rate.mjs`,
`daemon/state.mjs`), the space reader (`daemon/spaces.mjs`), the no-bundler core build (`scripts/build-core.mjs`).

Refresh the archive: `node scripts/fetch-upstream.mjs --check` (verifies the pinned tarballs) ·
`node scripts/fetch-upstream.mjs` (re-fetches at the pinned shas). Bumping a sha is a deliberate act
recorded in `archive/SOURCES.json` and `CHANGELOG.md`.
