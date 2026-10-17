// node scenario.mjs <normal|reorder|grief|timeout|all>
// Deterministic pitch demos on their own wallets (bot index 100+). Run with traders AND keeper stopped.
import { pub, read, params, windowAt, commitHash, randomSalt, receipt, refClear, log, fmt, sleep, PHASE } from './config.mjs';
import { botWallet } from './keys.mjs';
import { fundAndOnboard } from './fund.mjs';
import { decodeEventLog } from 'viem';
import { abi } from './config.mjs';

const E = 10n ** 18n;
const p = await params();
const W = (i, label) => botWallet(i, label);

async function curWindow() {
  return (await windowAt(await pub.getBlockNumber()));
}
async function waitWindow(k) {
  for (;;) { const { window } = await curWindow(); if (window >= k) return; await sleep(250); }
}
/** wait for the start of a fresh window, return its id */
async function freshWindow() {
  const { window } = await curWindow();
  await waitWindow(window + 1n);
  return window + 1n;
}
async function vault(w) {
  const [b, q] = await Promise.all([read('freeBase', [w.address]), read('freeQuote', [w.address])]);
  return { b, q };
}

/** send in the given order: each tx is broadcast before the next one is signed */
async function sendSeq(items, fn) {
  const hs = [];
  for (const it of items) hs.push(await fn(it));
  const rs = await Promise.all(hs.map(receipt));
  return rs;
}

async function commitAll(k, orders, reverse = false) {
  const seq = reverse ? [...orders].reverse() : orders;
  for (const o of seq) {
    o.salt = randomSalt(); o.batch = k;
  }
  const rs = await sendSeq(seq, (o) => o.w.write('commit', [o.w.address, k, commitHash(k, o.w.address, o.isBuy, o.qty, o.tick, o.salt)]));
  seq.forEach((o, i) => log(`  commit#${k} ${o.w.label.padEnd(4)} [hidden: ${o.isBuy ? 'BUY ' : 'SELL'} ${fmt(o.qty)}@${o.tick}] ${rs[i].status} blk=${rs[i].blockNumber} idx=${rs[i].transactionIndex} ${rs[i].transactionHash}`));
  if (rs.some((r) => r.status !== 'success')) throw new Error('commit reverted');
}
async function revealAll(orders, reverse = false) {
  const seq = (reverse ? [...orders].reverse() : orders).filter((o) => !o.noReveal);
  const rs = await sendSeq(seq, (o) => o.w.write('reveal', [o.w.address, o.batch, o.isBuy, o.qty, o.tick, o.salt]));
  seq.forEach((o, i) => log(`  reveal#${o.batch} ${o.w.label.padEnd(4)} ${o.isBuy ? 'BUY ' : 'SELL'} ${fmt(o.qty)}@${o.tick} ${rs[i].status} blk=${rs[i].blockNumber} idx=${rs[i].transactionIndex} ${rs[i].transactionHash}`));
  if (rs.some((r) => r.status !== 'success')) throw new Error('reveal reverted');
}

async function settleAndCheck(k, orders, settler) {
  const h = await settler.write('settle', [k]);
  const r = await receipt(h);
  const ev = r.logs.map((l) => { try { return decodeEventLog({ abi, ...l }); } catch { return null; } })
    .find((e) => e && e.eventName === 'Settled');
  const s = ev.args;
  log(`  settle#${k} ${r.status} gasUsed=${r.gasUsed} ${h}`);
  const px = 90 + 0.5 * s.priceTick;
  log(`  chain: priceTick=${s.priceTick} (price ${px} SUSD) volume=${fmt(s.volume)} rationedSide=${s.rationedSide} marginal=${s.marginalTick} r=${fmt(s.rNum)}/${fmt(s.rDen)} slashPool=${fmt(s.slashPool)}`);
  const revealed = orders.filter((o) => !o.noReveal).map((o) => ({ owner: o.w.address, isBuy: o.isBuy, qty: o.qty, tick: o.tick }));
  const ref = refClear(revealed);
  const same = ref.priceTick === s.priceTick && BigInt(ref.volume) === s.volume && ref.rationedSide === s.rationedSide
    && ref.marginalTick === s.marginalTick && BigInt(ref.rNum) === s.rNum && BigInt(ref.rDen) === s.rDen;
  log(`  ref  : priceTick=${ref.priceTick} volume=${fmt(BigInt(ref.volume))} rationedSide=${ref.rationedSide} marginal=${ref.marginalTick} → ${same ? '✅ chain == python reference' : '❌ MISMATCH'}`);
  for (const o of orders) {
    const fill = await read('fillOf', [k, o.w.address]);
    const refFill = o.noReveal ? 0n : BigInt(ref.fills[o.w.address]);
    if (fill !== refFill) { log(`  ❌ fill mismatch ${o.w.label}`); return { s, same: false }; }
  }
  return { s, same, ref };
}

async function claimAll(k, orders, claimer) {
  for (const o of orders) {
    const before = await vault(o.w);
    const [pb, pq] = await read('previewClaim', [k, o.w.address]);
    const fill = await read('fillOf', [k, o.w.address]);
    const r = await receipt(await claimer.write('claim', [o.w.address, k]));
    const after = await vault(o.w);
    log(`  claim ${o.w.label.padEnd(4)} ${o.noReveal ? '(never revealed)' : `${o.isBuy ? 'BUY ' : 'SELL'} ${fmt(o.qty)}@${o.tick}`} fill=${fmt(fill)} preview=(${fmt(pb)} SBA, ${fmt(pq)} SUSD) vault ${fmt(before.b)}/${fmt(before.q)} → ${fmt(after.b)}/${fmt(after.q)} ${r.status} ${r.transactionHash}`);
    o.claimed = { pb, pq, after };
  }
}

async function prep(ws) {
  await fundAndOnboard(ws);
  for (const w of ws) {
    const v = await vault(w);
    if (v.q < p.bond + 300n * E || v.b < 3n * E) throw new Error(`${w.label} vault too low (${fmt(v.b)}/${fmt(v.q)}) — previous order unclaimed?`);
  }
}

const NAMES = ['甲', '乙', '丙', '丁', '戊', '己'];

async function normal(base = 100, reverse = false) {
  const ws = [0, 1, 2].map((i) => W(base + i, NAMES[i]));
  await prep(ws);
  const orders = [
    { w: ws[0], isBuy: true, qty: 2n * E, tick: 22 },
    { w: ws[1], isBuy: true, qty: 1n * E, tick: 20 },
    { w: ws[2], isBuy: false, qty: 3n * E, tick: 18 },
  ];
  const k = await freshWindow();
  log(`batch ${k}: commit ${reverse ? '(REVERSED order)' : ''}`);
  await commitAll(k, orders, reverse);
  await waitWindow(k + 1n);
  log(`batch ${k}: reveal ${reverse ? '(REVERSED order)' : ''}`);
  await revealAll(orders, reverse);
  await waitWindow(k + 2n);
  const res = await settleAndCheck(k, orders, ws[0]);
  await claimAll(k, orders, ws[0]);
  return res;
}

async function scenarioNormal() {
  log('=== normal: 甲 buy 2@22, 乙 buy 1@20, 丙 sell 3@18 ===');
  const { s, same } = await normal(100, false);
  if (!same || s.volume !== 3n * E) throw new Error('normal: unexpected');
  log(`RESULT normal: everyone trades at one uniform price ${90 + 0.5 * s.priceTick} SUSD, volume ${fmt(s.volume)} SBA ✅`);
}

async function scenarioReorder() {
  log('=== reorder: same three orders, forward (wallets 103-105) vs reversed submission+reveal (106-108) ===');
  const a = await normal(103, false);
  const b = await normal(106, true);
  const t = (x) => [x.priceTick, x.volume, x.rationedSide, x.marginalTick, x.rNum, x.rDen].map(String).join(',');
  const ok = t(a.s) === t(b.s) && a.same && b.same;
  log(`forward : ${t(a.s)}`);
  log(`reversed: ${t(b.s)}`);
  log(`RESULT reorder: ${ok ? 'identical clearing result regardless of tx order ✅' : '❌ DIFFERENT'}`);
  if (!ok) throw new Error('reorder mismatch');
}

async function scenarioGrief() {
  log('=== grief: 甲 buy 2@22, 乙 sell 3@18, 丙 commits and never reveals ===');
  const ws = [0, 1, 2].map((i) => W(110 + i, NAMES[i]));
  await prep(ws);
  const orders = [
    { w: ws[0], isBuy: true, qty: 2n * E, tick: 22 },
    { w: ws[1], isBuy: false, qty: 3n * E, tick: 18 },
    { w: ws[2], isBuy: true, qty: 1n * E, tick: 30, noReveal: true },
  ];
  const before = await Promise.all(ws.map(vault));
  const k = await freshWindow();
  await commitAll(k, orders);
  await waitWindow(k + 1n);
  await revealAll(orders);
  await waitWindow(k + 2n);
  const { s, same } = await settleAndCheck(k, orders, ws[0]);
  await claimAll(k, orders, ws[0]);
  const after = await Promise.all(ws.map(vault));
  const comp = (s.slashPool * s.volume) / (2n * s.volume);
  log(`  slashPool=${fmt(s.slashPool)} SUSD; each matched trader gets slashPool*fill/(2V) = ${fmt(comp)} SUSD`);
  log(`  griefer 丙 vault quote ${fmt(before[2].q)} → ${fmt(after[2].q)} (lost bond ${fmt(before[2].q - after[2].q)})`);
  const ok = same && s.slashPool === p.bond && before[2].q - after[2].q === p.bond;
  log(`RESULT grief: ${ok ? 'bond slashed and paid to counterparties ✅' : '❌'}`);
  if (!ok) throw new Error('grief');
}

async function scenarioTimeout() {
  log('=== timeout: commit+reveal, nobody settles → after timeout anyone cancels → full refund incl. bond ===');
  const ws = [0, 1].map((i) => W(120 + i, NAMES[i]));
  await prep(ws);
  const orders = [
    { w: ws[0], isBuy: true, qty: 1n * E, tick: 25 },
    { w: ws[1], isBuy: false, qty: 1n * E, tick: 15 },
  ];
  const before = await Promise.all(ws.map(vault));
  const k = await freshWindow();
  await commitAll(k, orders);
  await waitWindow(k + 1n);
  await revealAll(orders);
  const cancelAt = k + 2n + p.timeoutWindows;
  log(`  keeper is down… waiting until window ${cancelAt} (phase 3) — settle deliberately NOT called`);
  for (;;) {
    const ph = Number(await read('phaseOf', [k]));
    if (ph === 3) break;
    await sleep(500);
  }
  // settle must now be impossible
  const r = await receipt(await ws[0].write('cancel', [k]));
  log(`  cancel#${k} ${r.status} ${r.transactionHash} phase=${PHASE[Number(await read('phaseOf', [k]))]}`);
  await claimAll(k, orders, ws[1]);
  const after = await Promise.all(ws.map(vault));
  const ok = r.status === 'success' && before.every((b, i) => b.b === after[i].b && b.q === after[i].q);
  log(`RESULT timeout: ${ok ? 'full refund (balances identical to before commit, bond returned) ✅' : '❌'}`);
  if (!ok) throw new Error('timeout');
}

const which = process.argv[2] || 'all';
const table = { normal: scenarioNormal, reorder: scenarioReorder, grief: scenarioGrief, timeout: scenarioTimeout };
const run = which === 'all' ? Object.keys(table) : [which];
for (const n of run) {
  if (!table[n]) { console.error('usage: node scenario.mjs <normal|reorder|grief|timeout|all>'); process.exit(2); }
  await table[n]();
}
process.exit(0);
