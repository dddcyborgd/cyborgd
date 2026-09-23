# Changelog — cyborgd

## 0.0.1-alpha — 2026-09-23

The first release. One daemon, zero npm dependencies, Node 24.

- **THE TRIAD** — `core/triad.mjs`: participant ⟷ anchor ⟷ participant. Deterministic host election
  (owner → highest rank → earliest join → sid), failover + `repoint`, `mirror{tick,snap}` merged
  last-writer-wins by tick, late joiners served from the anchor's canonical snapshot, `rtc` relayed
  only within a space. The joiner is always told who hosts.
- **The isomorphic core** — `core/` (13 modules, pure JS, no node imports, no `Math.random`) and its
  no-bundler build `scripts/build-core.mjs` → `dist/cyborgd-core.js` (`window.CyborgdCore`) +
  `dist/MANIFEST.json`, verified in a `vm` context that has only `window`. `dist/` is tracked so the
  DeltaVerse's `gather-cyborg.mjs` finds it after a plain `git pull`.
- **Rooms** — `core/rooms.mjs`: join/leave, zone gating by rung with push-back, portals, strikes,
  two clocks (sim 60 Hz / net 20 Hz), delta snapshots; trusted `state` and authoritative `cmd/ack`
  lanes (`core/sim.mjs`, deterministic to 1e-6).
- **Aivatars** — `core/aivatar.mjs`: `wander · greet · mirror · reach · focus · riddle` as a registry;
  the arm reach from the arcball surface (`core/arcball.mjs`, Shoemake/Holroyd); AIML-like riddler with
  `srai` (`core/riddle.mjs`) and an optional LLM seam; reward once per player per agent per day.
- **The faucet** — claim → rung → hashcash → cooldown/daily cap (per address AND sub, JSONL-replayed)
  → deterministic nonce → EIP-712 voucher (`Drip` / `SpaceInit` / `Claim`, typehashes verbatim from
  cyborg-contracts and ShambaLuvAirdrop). The LUV one-shot welcome. Redemption by the participant.
- **The anchor** — hand-rolled RFC 6455 server on `node:http`, a JSON router, login333 `claimVerify`
  (exact port), space docs (`cyborg-space/1`: store + `tokenURI`), headless server components in
  `node:vm`, bankon-vault/1 read side + `scripts/seal-signer.mjs` write side.
- **Registries** — rooms (7, from bubblerooms), faucet tokens (6), chains (4), riddles (11).
- **ops/** — hardened systemd unit, env example, Apache snippet, the deployment manual.
- **Tests** — 55 (`node --test test/*.test.mjs`) + `--selftest` (10). Fixed while finishing: the reach
  frame rotation sign (a target straight ahead read as "behind"), `INVALID_LIMIT` missing from the core
  index, relayed messages no longer also fire `onMessage`, `HEY *`/`HI *` chat reductions.
- Home created at github.com/dddcyborgd/cyborgd (MIT). Upstream vendored by pinned sha (`archive/SOURCES.json`, `UPSTREAM.md`).

## 0.0.1-alpha.1 — 2026-09-23

- Protocol: `event{name:"item",data:{name,action}}` — the participant's sphere of influence (dvengine `DVSphere`: sceptre, orb) reaches the aivatar; gestures gain `greet` `wave` `point` `raise` `bow`.
- Aivatar: new `item` behaviour (raise → raises its own arm; use → bows; a line naming the item).
- Protocol: `event{name:"field",data:{r,max,at?}}` — the participant's resizable field of influence (max = space extent − 1: infinity − 1). Aivatar `field` behaviour: greet range widens to the field; at the bound it recognises the participant.
