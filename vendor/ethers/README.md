# vendor/ethers — the one third-party library

| File | Library | Version | Format | Provenance |
|---|---|---|---|---|
| `ethers.umd.min.js` | **ethers** (EVM: EIP-191 / EIP-712 signing, `ecrecover`) | **6.16.0** | UMD (minified) | copied byte-for-byte from `DeltaVerse/vendor/ethers.umd.min.js` (npm `ethers` UMD dist) |

ethers is © Richard Moore and contributors, released under the **MIT License** —
https://github.com/ethers-io/ethers.js · https://docs.ethers.org/v6/

cyborgd loads it through `daemon/ethers.mjs` (a `createRequire` shim, since the file is UMD and
the daemon is ESM). No other third-party code exists in this repository; everything else is
Node 24 built-ins. Do not upgrade in place without recording the new version here and re-running
`node --test test/` (the voucher and claim tests pin the signature semantics).
