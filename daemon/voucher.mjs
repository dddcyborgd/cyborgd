/*! cyborgd — voucher · (c) 2026 BANKON / PYTHAI · MIT · upstream patterns © oncyberio (MIT) */
// EIP-712 vouchers, signed by the daemon's key and redeemed on chain by the participant. The three
// structs are copied VERBATIM from the contracts (grep TYPEHASH in each):
//   cyborg-contracts/src/CyborgFaucet.sol   EIP712("CyborgFaucet","1")
//     Drip(address token,address to,uint256 amount,uint256 nonce,uint256 deadline)
//   cyborg-contracts/src/CyborgSpace.sol    EIP712("CyborgSpace","1")
//     SpaceInit(address to,uint256 roomId,uint256 inftTokenId,bytes32 thotRoot,string sceneURI,bytes32 sceneHash,uint256 nonce,uint256 deadline)
//   DeltaVerse/shambaluv/contracts/ShambaLuvAirdrop.sol   domain name "ShambaLuvAirdrop", version "1"
//     Claim(address recipient,uint256 amount,uint256 nonce,uint256 deadline)
// All three domains are EIP712Domain(string name,string version,uint256 chainId,address verifyingContract).
// Upstream precedent: onchain-cc-server's mint-opportunity (oncyberio, MIT) — play, earn a signed
// permission, redeem it yourself; the server never holds the participant's funds.
// Nonces are deterministic: keccak256(sub|token|day|counter) with a persisted counter (state/counters.json)
// so a replayed request cannot mint a second valid voucher and a crash never reuses a value.
import { Wallet, TypedDataEncoder, verifyTypedData, keccak256, toUtf8Bytes, getAddress, isAddress } from './ethers.mjs';

export const DOMAINS = Object.freeze({
  'cyborg-faucet': { name: 'CyborgFaucet', version: '1' },
  'cyborg-space': { name: 'CyborgSpace', version: '1' },
  'shambaluv-airdrop': { name: 'ShambaLuvAirdrop', version: '1' },
});
export const TYPES = Object.freeze({
  Drip: [{ name: 'token', type: 'address' }, { name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }],
  SpaceInit: [{ name: 'to', type: 'address' }, { name: 'roomId', type: 'uint256' }, { name: 'inftTokenId', type: 'uint256' }, { name: 'thotRoot', type: 'bytes32' }, { name: 'sceneURI', type: 'string' }, { name: 'sceneHash', type: 'bytes32' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }],
  Claim: [{ name: 'recipient', type: 'address' }, { name: 'amount', type: 'uint256' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }],
});
export const PRIMARY = Object.freeze({ 'cyborg-faucet': 'Drip', 'cyborg-space': 'SpaceInit', 'shambaluv-airdrop': 'Claim' });
export const REDEEM = Object.freeze({
  'cyborg-faucet': { method: 'drip(address token,address to,uint256 amount,uint256 nonce,uint256 deadline,bytes sig)', args: ['token', 'to', 'amount', 'nonce', 'deadline', 'signature'] },
  'cyborg-space': { method: 'mintSpace((address to,uint256 roomId,uint256 inftTokenId,bytes32 thotRoot,string sceneURI,bytes32 sceneHash,uint256 nonce,uint256 deadline) init,bytes sig)', args: ['init', 'signature'] },
  'shambaluv-airdrop': { method: 'claim(address recipient,uint256 amount,uint256 nonce,uint256 deadline,bytes signature)', args: ['recipient', 'amount', 'nonce', 'deadline', 'signature'] },
});

export function typeString(primary) { return primary + '(' + TYPES[primary].map((f) => f.type + ' ' + f.name).join(',') + ')'; }
export function typeHash(primary) { return keccak256(toUtf8Bytes(typeString(primary))); }
export function domainOf(faucet, chainId, verifyingContract) { return { ...DOMAINS[faucet], chainId: Number(chainId), verifyingContract: getAddress(verifyingContract) }; }
export function digestOf(faucet, chainId, verifyingContract, message) { const p = PRIMARY[faucet]; return TypedDataEncoder.hash(domainOf(faucet, chainId, verifyingContract), { [p]: TYPES[p] }, message); }
export function domainSeparator(faucet, chainId, verifyingContract) { return TypedDataEncoder.hashDomain(domainOf(faucet, chainId, verifyingContract)); }
/** recover the signer of a voucher → checksummed address */
export function recover(faucet, chainId, verifyingContract, message, signature) { const p = PRIMARY[faucet]; return verifyTypedData(domainOf(faucet, chainId, verifyingContract), { [p]: TYPES[p] }, message, signature); }

/** deterministic nonce: keccak256("sub|token|day|counter") as a decimal uint256 string */
export function nonceFor(sub, token, day, counter) { return BigInt(keccak256(toUtf8Bytes(`${String(sub).toLowerCase()}|${token}|${day}|${counter}`))).toString(); }

export class VoucherSigner {
  constructor(privateKey) { this.wallet = new Wallet(privateKey); this.address = this.wallet.address; }
  static random() { return new VoucherSigner(Wallet.createRandom().privateKey); }
  async sign(faucet, chainId, verifyingContract, message) {
    const p = PRIMARY[faucet]; if (!p) throw new Error('unknown faucet kind ' + faucet);
    const domain = domainOf(faucet, chainId, verifyingContract);
    const signature = await this.wallet.signTypedData(domain, { [p]: TYPES[p] }, message);
    const digest = TypedDataEncoder.hash(domain, { [p]: TYPES[p] }, message);
    return { primaryType: p, domain, typeHash: typeHash(p), message, digest, signature, signer: this.address };
  }
  /** a faucet drip → the voucher the client redeems */
  async drip({ faucet = 'cyborg-faucet', chainId, contract, token, to, amount, nonce, deadline }) {
    if (!isAddress(to)) throw new Error('bad recipient');
    let message, redeem;
    if (faucet === 'shambaluv-airdrop') { message = { recipient: getAddress(to), amount: String(amount), nonce: String(nonce), deadline: Number(deadline) }; }
    else { message = { token: getAddress(token), to: getAddress(to), amount: String(amount), nonce: String(nonce), deadline: Number(deadline) }; }
    const s = await this.sign(faucet, chainId, contract, message);
    redeem = { contract: getAddress(contract), method: REDEEM[faucet].method, args: REDEEM[faucet].args.map((a) => (a === 'signature' ? s.signature : message[a])) };
    return { kind: 'drip', faucet, chainId: Number(chainId), contract: getAddress(contract), token: getAddress(token || '0x0000000000000000000000000000000000000000'), to: getAddress(to), amount: String(amount), nonce: String(nonce), deadline: Number(deadline), ...s, redeem };
  }
  /** a CyborgSpace mint permission */
  async spaceInit({ chainId, contract, to, roomId, inftTokenId = 0, thotRoot = '0x' + '00'.repeat(32), sceneURI = '', sceneHash = '0x' + '00'.repeat(32), nonce, deadline }) {
    const message = { to: getAddress(to), roomId: String(roomId), inftTokenId: String(inftTokenId), thotRoot, sceneURI, sceneHash, nonce: String(nonce), deadline: Number(deadline) };
    const s = await this.sign('cyborg-space', chainId, contract, message);
    return { kind: 'space-init', faucet: 'cyborg-space', chainId: Number(chainId), contract: getAddress(contract), ...s, redeem: { contract: getAddress(contract), method: REDEEM['cyborg-space'].method, args: [message, s.signature] } };
  }
}

/** verify a voucher object end to end: recovers to `signer` and is not past its deadline */
export function verifyVoucher(v, signer, nowSec = Math.floor(Date.now() / 1000)) {
  const rec = recover(v.faucet, v.chainId, v.contract, v.message, v.signature);
  return { ok: rec.toLowerCase() === String(signer).toLowerCase() && Number(v.deadline) > nowSec, recovered: rec, expired: Number(v.deadline) <= nowSec };
}
