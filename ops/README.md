# ops — running cyborgd in production

cyborgd is one Node 24 process on one port, bound to **127.0.0.1:8790 only**. Apache (the
deltaverse.pythai.net vhost) terminates TLS and proxies `/cyborg/ws` (WebSocket) and `/cyborg/api`
(HTTP) to it. No npm install, no build step for the daemon itself (`dist/` is tracked), no database:
every durable fact is one appended line under `state/`.

Files here:

| file | what |
|---|---|
| `cyborgd.service` | the systemd unit (User=deltaverse, hardened, MemoryMax=512M, CPUQuota=50%, writes only to `state/`) |
| `cyborgd.env.example` | every environment variable the daemon reads — copy to `/etc/cyborgd.env` |
| `apache-cyborgd.conf` | the vhost snippet: the ws rewrite, the api ProxyPass, the CSP `connect-src` addition |

## Step by step

### 1. Node 24 + the tenant

```sh
node --version                       # v24.x — the daemon uses node:test, WebSocket client, hkdfSync, AbortSignal.timeout
id deltaverse                        # the tenant user the DeltaVerse VPS already has (deploy/web2/deploy-deltaverse.sh)
```

### 2. Clone (as the tenant)

```sh
sudo -u deltaverse -H bash -c 'mkdir -p ~/dddcyborgd && cd ~/dddcyborgd && git clone https://github.com/dddcyborgd/cyborgd'
cd /home/deltaverse/dddcyborgd/cyborgd
node --test test/*.test.mjs          # 55 tests, ~2 s, no network
node daemon/cyborgd.mjs --selftest   # 10 in-process checks (ws frames, claim, pow, voucher, triad, room, arcball)
```

The DeltaVerse's `deploy/web2/deploy-deltaverse.sh install|update` does this clone for you (all three
siblings — cyborgd, dvengine, cyborg-contracts — under `/home/$TENANT/dddcyborgd`), runs
`scripts/gather-cyborg.mjs` in the DeltaVerse (which copies `dist/cyborgd-core.js` and this repo's
skill into `cyborg/`), sed-rewrites the tenant path into `ops/cyborgd.service`, installs it to
`/etc/systemd/system/cyborgd.service`, seeds `/etc/cyborgd.env` from the example when absent, enables
the unit, and restarts cyborgd on every `update`. Steps 3–5 below are what that script does not do for
you: the env values, the sealed signer, and the Apache vhost.

### 3. The environment file

```sh
sudo cp ops/cyborgd.env.example /etc/cyborgd.env
sudo chown root:deltaverse /etc/cyborgd.env && sudo chmod 0640 /etc/cyborgd.env
sudoedit /etc/cyborgd.env
```

Set at least:

- `LOGIN333_ISSUER` — the address of the DeltaVerse doorway's `LOGIN333_SIGNER_KEY`. Without it the
  daemon accepts claims **unverified**, marks every response `insecure:true` and logs a warning at boot.
- `CYBORGD_VAULT` + `CYBORGD_VAULT_PASSPHRASE` — the sealed signer (step 4).
- `RPC_1`, `RPC_16661` — the RPC urls handed to clients with each voucher (and used for CyborgSpace
  `tokenURI` reads when `CYBORG_SPACE_<chainId>` is set).
- `CYBORG_FAUCET_<chainId>` once the CyborgFaucet is deployed at an address other than the predicted
  create3d one (`0xfa0C63b5BD49a5eE2e725379D1728F0E966Ef199`).

### 4. The vault — a sealed signer, never a clear-text key

The faucet signs EIP-712 vouchers with one private key. In production that key lives in a
**bankon-vault/1** file sealed under a passphrase; only the passphrase is in `/etc/cyborgd.env`.

Seal it (the passphrase comes from the environment, the key is printed as an address only):

```sh
cd /home/deltaverse/dddcyborgd/cyborgd
sudo -u deltaverse mkdir -p state
sudo -u deltaverse env CYBORGD_VAULT_PASSPHRASE='…' CYBORGD_SIGNER_KEY=0x… \
  node scripts/seal-signer.mjs state/signer.vault.json
# → sealed state/signer.vault.json · entry cyborgd-signer · signer address 0x…
```

(omit `CYBORGD_SIGNER_KEY` to mint a fresh random signer.) `*.vault.json` is git-ignored.

How `daemon/vault.mjs` reads it at boot (`signerFromConfig` in `daemon/cyborgd.mjs`):

1. `openVaultFile(CYBORGD_VAULT, CYBORGD_VAULT_PASSPHRASE)` parses the JSON, checks `version ==
   "bankon-vault/1"`, derives `master = PBKDF2-SHA256(passphrase, salt, 210000, 32)`.
2. The reserved `__check__` entry is decrypted with `HKDF-SHA512(master, salt, "bankon-vault-entry:__check__", 32)`
   as an AES-256-GCM key (iv = the entry's nonce, aad = the id, tag = the last 16 bytes of `ct`); it must
   read `bankon-vault-ok`, otherwise the passphrase is wrong and the daemon refuses to start.
3. `signerKeyFrom(vault, CYBORGD_VAULT_ENTRY)` returns the named entry, or the first entry whose
   `meta.format == "privateKey"`, decrypted the same way. The daemon logs the entry ids it saw (never the
   key) and `GET /health` reports the signer **address**.

The same file format is what `DeltaVerse/engine/bankon-vault.js` writes in the browser
(`fromPassphrase`), so a vault sealed in the OVERLORD console opens here unchanged.

The signer address must match what the contracts trust: `CyborgFaucet`'s immutable `signer` and
`ShambaLuvAirdrop.setSigner(<this address>)` (see `deploy/cyborg/OVERLORD_HANDOFF.md` in the DeltaVerse).
Rotating the signer = re-sealing the vault **and** redeploying the faucet at a new salt / calling `setSigner`.

### 5. The unit

```sh
sudo cp ops/cyborgd.service /etc/systemd/system/cyborgd.service   # or let deploy-deltaverse.sh do it
sudo systemctl daemon-reload
sudo systemctl enable --now cyborgd
systemctl status cyborgd
journalctl -u cyborgd -f
```

The unit is `ProtectSystem=strict` + `ProtectHome=read-only` with exactly one writable path,
`ReadWritePaths=/home/deltaverse/dddcyborgd/cyborgd/state`. If you move `CYBORGD_STATE_DIR`, move that
line with it or the daemon dies at boot with `EROFS`. `MemoryMax=512M` and `CPUQuota=50%` are
generous for the daemon's actual footprint (tens of MB idle; a room ticks at 20 Hz only while it has players).

### 6. Apache

```sh
sudo a2enmod proxy proxy_http proxy_wstunnel rewrite headers
```

Paste `ops/apache-cyborgd.conf` into the `deltaverse.pythai.net` `<VirtualHost *:443>` (the DeltaVerse's
`deploy/web2/deltaverse.pythai.net.conf` already carries it) and add `wss://deltaverse.pythai.net` to the
vhost's `Content-Security-Policy` `connect-src`. Then `sudo apachectl configtest && sudo systemctl reload apache2`.

### 7. Firewall — 8790 never leaves the box

The daemon binds `CYBORGD_HOST=127.0.0.1`; Apache is the only public face. Belt and braces:

```sh
sudo ufw deny in 8790/tcp                    # or nftables: drop tcp dport 8790 on the public interface
ss -ltnp | grep 8790                         # must show 127.0.0.1:8790, never 0.0.0.0 / [::]
```

### 8. Health

```sh
curl -s http://127.0.0.1:8790/health | jq          # on the box
curl -s https://deltaverse.pythai.net/cyborg/api/health | jq
```

```json
{ "ok": true, "version": "0.0.1-alpha", "name": "cyborgd", "rooms": 7, "players": 0, "connections": 0,
  "triad": { "spaces": 0, "hosted": 0, "anchored": 0 }, "insecure": false, "signer": "0x…",
  "faucet": { "tokens": 5, "drips": 0, "challenges": 0, "signer": "0x…", "insecure": false },
  "authoritative": false, "uptimeSec": 12, "spaces": { "store": 0, "chains": ["16661"] } }
```

`insecure: true` in production means `LOGIN333_ISSUER` is missing. `signer: null` means no vault opened
(the faucet answers 503 `no-signer`). Also: `/cyborg/api/rooms`, `/cyborg/api/triad`, `/cyborg/api/llms.txt`.

### 9. Ledgers under state/

| file | what | grows by |
|---|---|---|
| `state/faucet.jsonl` | every drip `{t,kind:"drip",token,address,sub,amount,nonce,chain,reason}`, every challenge issued/consumed | ~200 B per faucet event |
| `state/rooms.jsonl` | join / leave / voucher / space audit | ~120 B per event |
| `state/counters.json` | `{ "nonce": n }` — the voucher nonce counter, persisted before a nonce is handed out, never reused | rewritten atomically |
| `state/spaces/<id>.json` | cyborg-space/1 documents POSTed by members | one file per space |
| `state/signer.vault.json` | the sealed signer (step 4) | never |

Both ledgers are replayed at boot (cooldowns, daily caps and consumed challenges survive a restart —
`test/state.test.mjs` proves it). Back up `state/` with the DeltaVerse's regular tenant backup; it is
small. Never edit `counters.json` downward.

### 10. Log rotation

The daemon logs to stdout → journald; let journald bound it (`SystemMaxUse=` in
`/etc/systemd/journald.conf`). The JSONL ledgers are **not** logs: do not logrotate them. If
`faucet.jsonl` ever matters in size (it will not for years at human faucet rates), archive lines older
than the longest cooldown (the LUV welcome's 365 days) — the replay only needs entries newer than that
plus every `consumed` challenge younger than 300 s.

### 11. Upgrade

```sh
cd /home/deltaverse/dddcyborgd/cyborgd && sudo -u deltaverse git pull --ff-only
node --test test/*.test.mjs && sudo systemctl restart cyborgd
cd /home/deltaverse/DeltaVerse && node scripts/gather-cyborg.mjs        # refresh cyborg/core/cyborgd-core.js in the consumer
```

or simply `sudo deploy/web2/deploy-deltaverse.sh update` in the DeltaVerse, which pulls all three
siblings, gathers, re-installs the unit and restarts cyborgd. A restart drops every WebSocket; the
browser side (dvengine `DVNet`) reconnects and re-sends `hello`; hosts re-mirror; the anchor re-elects.
Nothing on chain is touched by an upgrade.

## What is NOT here

- No TLS in the daemon (Apache), no auth of its own (login333 claims are the identity), no private
  key in any file that is not a sealed vault, no outbound calls except RPC reads (`tokenURI`),
  `IPFS_GATEWAY`/`arweave.net` for space docs and `CYBORGD_LLM_URL` when you set it.
