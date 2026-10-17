// Deterministic bot keys: key_i = keccak256(FUNDER_PK || uint256(i)). Never written to disk.
// Traders use i = 0..BOT_COUNT-1; scenarios use i >= 100.
import { keccak256, concat, toHex } from 'viem';
import { FUNDER_PK, Wallet } from './config.mjs';

export function botKey(i) {
  return keccak256(concat([FUNDER_PK, toHex(BigInt(i), { size: 32 })]));
}
export function botWallet(i, label) {
  return new Wallet(botKey(i), label ?? `bot${i}`);
}
