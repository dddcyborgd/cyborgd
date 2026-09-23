/*! cyborgd — ethers loader · (c) 2026 BANKON / PYTHAI · MIT · upstream patterns © oncyberio (MIT) */
// The ONE third-party library: ethers v6.16.0 (MIT), vendored as a UMD build at vendor/ethers/ethers.umd.min.js.
// The daemon is ESM; UMD wants CommonJS — a createRequire shim bridges the two without a bundler.
// Resolution order: the local vendored copy first; CYBORGD_ETHERS (an explicit path) second; the
// DeltaVerse's own vendored copy last (the same bytes — a dev box that has not cloned the vendor dir).
import { createRequire } from 'node:module';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const CANDIDATES = [
  join(ROOT, 'vendor', 'ethers', 'ethers.umd.min.js'),
  process.env.CYBORGD_ETHERS ? resolve(process.env.CYBORGD_ETHERS) : null,
  resolve(process.env.HOME || '/home/hacker', 'DeltaVerse', 'vendor', 'ethers.umd.min.js'),
  '/home/hacker/DeltaVerse/vendor/ethers.umd.min.js',
].filter(Boolean);
export const ETHERS_PATH = CANDIDATES.find((p) => existsSync(p));
if (!ETHERS_PATH) throw new Error('cyborgd: ethers.umd.min.js not found — looked in ' + CANDIDATES.join(', '));
const ethers = require(ETHERS_PATH);

export default ethers;
export const {
  Wallet, HDNodeWallet, verifyMessage, verifyTypedData, hashMessage, TypedDataEncoder,
  keccak256, solidityPackedKeccak256, toUtf8Bytes, getAddress, isAddress, hexlify, getBytes,
  AbiCoder, JsonRpcProvider, Contract, Signature, toBeHex, zeroPadValue,
} = ethers;
