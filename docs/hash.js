// 承诺哈希：keccak256(abi.encode(address(this), chainid, batchId, owner, isBuy, qty, tick, salt))
// 传入 viem 的 encodeAbiParameters / keccak256，便于浏览器与 node 共用
const TYPES = ['address', 'uint256', 'uint256', 'address', 'bool', 'uint128', 'uint8', 'bytes32']
  .map((type) => ({ type }));

export function commitHash(viem, { sealBatch, chainId, batchId, owner, isBuy, qty, tick, salt }) {
  const enc = viem.encodeAbiParameters(TYPES, [
    sealBatch, BigInt(chainId), BigInt(batchId), owner, !!isBuy, BigInt(qty), Number(tick), salt,
  ]);
  return viem.keccak256(enc);
}

export function randomSalt() {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return '0x' + Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}
