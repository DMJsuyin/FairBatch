import {referenceClear} from './protocol';
import {orderOutcome} from './experience';
import {depthCurve} from './depth';
import type {Order} from './client';

// Recording reel. One click plays this clock. It does not open a Monad round:
// the live windows are 60s + 60s + 120s, which cannot fit a three-minute take.

const dmon = (lots: number) => (lots / 100).toFixed(lots % 100 ? 2 : 0);
const px = (ticks: number) => (ticks / 100).toFixed(2);
const usd = (raw: number) => (raw / 1e6).toFixed(2);
const token = (wei: bigint) => {
  const whole = wei / 10n ** 18n;
  const frac = (wei % 10n ** 18n) / 10n ** 16n;
  return frac === 0n ? whole.toString() : `${whole}.${frac.toString().padStart(2, '0')}`;
};

const published = {
  chainId: 10143,
  contract: '0x10886f059743e61585e4c762b459a9ecdcb61343',
  roundId: '4',
  priceTicks: 100,
  volumeLots: 1600,
  userTx: '0x6e590d7e5b1d21979af715c38bb63579019f3f3154061a70f98fba2e982fce2e',
  clearingTx: '0x547adcbc01fd86b35e62166b392bf22f7c1352750d175b98e4508f10f5f9f860',
  resultHash: '0x56d1a7234879167af1254c208002249a41dcd523f136d1a5e5e1fd6ec0453308',
  baseLiability: '0',
  quoteLiability: '0',
};

const book = [
  {id: 'P1', role: 'counterparty' as const, owner: '0x2B92998550E7F7A37DB85AB048fb3542CDCc3C04', isBuy: true, lots: 800, limitTicks: 103, commitment: '0x61de5f3b37c4744e681206611133747d5a272351964b7c2671fd4a543688ce89', escrow: 8240000, fillLots: 800, baseDue: '8000000000000000000', quoteDue: 240000},
  {id: 'P2', role: 'counterparty' as const, owner: '0xD5c154164bFa2578a4bb96c96a58d406fC9C4c0c', isBuy: true, lots: 600, limitTicks: 101, commitment: '0x8e85f5af971d32556f6040eae7a23530ce1264291d163fe6ffbd42377731b01f', escrow: 6060000, fillLots: 300, baseDue: '3000000000000000000', quoteDue: 3060000},
  {id: 'P3', role: 'counterparty' as const, owner: '0x930a65d1bEeae70fd4588bd85dD76f79d41dA8Ae', isBuy: false, lots: 700, limitTicks: 97, commitment: '0x5d4e729cd3cb008ba78fc631eda7fd8ce60288d0ce08bb0747c19a079c36e9db', escrow: 7000000000000000000, fillLots: 700, baseDue: '0', quoteDue: 7000000},
  {id: 'P4', role: 'counterparty' as const, owner: '0x8434041f3711a5DB9a59EaB3d7fF36567AeCD629', isBuy: false, lots: 900, limitTicks: 99, commitment: '0x480d824a1cb039e010da3612cbc83d2a5501cc30ceec77f169bfe2c5cfd9c02f', escrow: 9000000000000000000, fillLots: 900, baseDue: '0', quoteDue: 9000000},
  {id: 'YOU', role: 'user' as const, owner: '0x0D191bC0114e913965a1A044aCc0C9353Ee9884F', isBuy: true, lots: 500, limitTicks: 103, commitment: '0xacc04f40bc0dd30732ef0945afcb99e97a47b44247392451b40407d55e17f68a', escrow: 8000000, fillLots: 500, baseDue: '5000000000000000000', quoteDue: 3000000},
];

const user = book[4];
const userOrder = {
  owner: user.owner,
  isBuy: true,
  revealed: true,
  claimed: true,
  lots: BigInt(user.lots),
  limitTicks: BigInt(user.limitTicks),
  commitment: user.commitment,
  escrow: BigInt(user.escrow),
  fillLots: BigInt(user.fillLots),
  baseDue: BigInt(user.baseDue),
  quoteDue: BigInt(user.quoteDue),
} as Order;
const outcome = orderOutcome(userOrder, {phase: 4, price: BigInt(published.priceTicks), volume: BigInt(published.volumeLots)});
if (!outcome) throw Error('demo user outcome missing');

const clearing = referenceClear(book.map(o => ({owner: o.owner as `0x${string}`, isBuy: o.isBuy, lots: BigInt(o.lots), limitTicks: BigInt(o.limitTicks)})));
if (clearing.volume !== BigInt(published.volumeLots) || clearing.price !== BigInt(published.priceTicks)) throw Error('demo clearing drifted from the published round');
if (clearing.fills.some((v, i) => v !== BigInt(book[i].fillLots))) throw Error('demo fills drifted from the published round');

const revealed = book.map(o => ({revealed: true, isBuy: o.isBuy, lots: BigInt(o.lots), limitTicks: BigInt(o.limitTicks)}));
const curve = depthCurve(revealed);

export type DemoFocus = 'intro' | 'wallet' | 'round' | 'commit' | 'book' | 'reveal' | 'clear' | 'result' | 'compare' | 'witness' | 'proof';

export type DemoBeat = {
  id: string;
  atMs: number;
  holdMs: number;
  title: string;
  caption: string;
  narration: string;
  focus: DemoFocus;
  dataset: 'round-4' | 'sequence-lab' | 'none';
  motion: string;
};

const lab = [
  {id: 'A', buy: true, price: 110},
  {id: 'B', buy: false, price: 90},
  {id: 'C', buy: true, price: 100},
];
const sequences = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];

function continuous(seq: number[]) {
  const resting: typeof lab = [];
  let price = 0;
  let buyer = '';
  for (const i of seq) {
    const o = lab[i];
    const at = resting
      .map((x, idx) => ({x, idx}))
      .filter(({x}) => x.buy !== o.buy && (o.buy ? o.price >= x.price : o.price <= x.price))
      .sort((a, b) => (o.buy ? a.x.price - b.x.price : b.x.price - a.x.price))[0]?.idx ?? -1;
    if (at >= 0) {
      const maker = resting.splice(at, 1)[0];
      price = maker.price;
      buyer = o.buy ? o.id : maker.id;
    } else resting.push(o);
  }
  return {price, buyer};
}

const contrast = sequences.map(seq => {
  const clob = continuous(seq);
  return {
    arrival: seq.map(i => lab[i].id).join('→'),
    clobPrice: px(clob.price),
    clobBuyer: clob.buyer,
    fairBatchPrice: px(90),
    fairBatchBuyer: 'A',
  };
});

const script: Omit<DemoBeat, 'atMs'>[] = [
  {holdMs: 12000, id: 'intro', title: '问题', caption: '顺序会改写成交', narration: '同一限价，先到后到会改写谁成交。FairBatch 把窗口内的报价封进哈希，到点统一清算。', focus: 'intro', dataset: 'none', motion: 'title-in, then two ghost fills swap'},
  {holdMs: 10000, id: 'wallet', title: '准备', caption: '先备钱包与资产', narration: '先准备钱包、测试资产和授权，再开轮。没准备好，主按钮不会进入下单。', focus: 'wallet', dataset: 'round-4', motion: 'balance counters tick up, then approve'},
  {holdMs: 10000, id: 'open', title: '开轮', caption: '窗口只收哈希', narration: '提交窗口打开。合约只记下截止时间。限价还不可见。', focus: 'round', dataset: 'round-4', motion: 'phase pill flips to commit'},
  {holdMs: 16000, id: 'commit', title: '密封下单', caption: '5 dMON · 限价 1.03', narration: '买入 5 dMON，限价 1.03，锁仓 8 dUSDC。链上此刻只有哈希，没有价格。', focus: 'commit', dataset: 'round-4', motion: 'price field collapses into the real commitment hash'},
  {holdMs: 14000, id: 'book', title: '同窗对手盘', caption: '四笔对手盘入窗', narration: '四个对手盘进入同一窗口。谁先提交，不改变这批订单的清算价。', focus: 'book', dataset: 'round-4', motion: 'four hash rows stagger in'},
  {holdMs: 16000, id: 'reveal', title: '揭示', caption: '报价断点成图', narration: '揭示后限价出现。供需按真实报价断点绘制，不按价格逐格扫描。', focus: 'reveal', dataset: 'round-4', motion: 'hashes flip to prices, curve draws by breakpoints'},
  {holdMs: 22000, id: 'clear', title: '统一清算', caption: '统一价 1.00', narration: '最大成交 16 dMON，统一价 1.00。同价 6 手买单按比例只成交 3 手。复算与链上哈希一致。', focus: 'clear', dataset: 'round-4', motion: 'price line locks, volume counter settles on 16'},
  {holdMs: 26000, id: 'result', title: '成交与退款', caption: '成交 5 · 退 3', narration: '这张单全部成交，收到 5 dMON，退回 3 dUSDC。0.15 是成交价差，2.85 是多锁的仓。', focus: 'result', dataset: 'round-4', motion: 'two refund bars grow, then the filled amount lands'},
  {holdMs: 20000, id: 'compare', title: '顺序对照', caption: '六序，价格会分叉', narration: '另一组三笔样例，不是第 4 轮。连续撮合会在 0.90 和 1.10 间改价，FairBatch 始终 0.90。', focus: 'compare', dataset: 'sequence-lab', motion: 'table in, pulse the rows whose price or buyer changes'},
  {holdMs: 12000, id: 'witness', title: '见证', caption: '漏单即回滚', narration: '漏单或错序的见证会被合约拒绝。清算价由规则算出，不由提交者指定。', focus: 'witness', dataset: 'round-4', motion: 'drop one index, stamp revert, restore the valid witness'},
  {holdMs: 16000, id: 'proof', title: '到账', caption: '五单到账 · 负债为零', narration: '公网第 4 轮五单全部到账，两种资产负债为零。哈希留在画面上，可以复算。', focus: 'proof', dataset: 'round-4', motion: 'hold the two transaction hashes, do not advance'},
];

function withClock(rows: Omit<DemoBeat, 'atMs'>[]): DemoBeat[] {
  let at = 0;
  return rows.map(row => {
    const beat = {...row, atMs: at};
    at += row.holdMs;
    return beat;
  });
}

const beats = withClock(script);
const durationMs = beats.reduce((s, b) => s + b.holdMs, 0);

const show = (o: (typeof book)[number], stage: 'sealed' | 'revealed' | 'settled') => ({
  id: o.id,
  role: o.role,
  owner: o.owner,
  side: o.isBuy ? 'buy' : 'sell',
  qty: stage === 'sealed' ? null : dmon(o.lots),
  limit: stage === 'sealed' ? null : px(o.limitTicks),
  commitment: o.commitment,
  escrow: stage === 'sealed' ? null : (o.isBuy ? usd(o.escrow) : token(BigInt(o.escrow))),
  fill: stage === 'settled' ? dmon(o.fillLots) : null,
  received: stage === 'settled' ? (o.isBuy ? token(BigInt(o.baseDue)) : usd(o.quoteDue)) : null,
  refund: stage === 'settled' ? (o.isBuy ? usd(o.quoteDue) : token(BigInt(o.baseDue))) : null,
});

export function demoReel() {
  return {
    product: 'FairBatch' as const,
    mode: 'replay' as const,
    waitsForChain: false as const,
    openRoundOnClick: false as const,
    durationMs,
    recommendedRecordingMs: 180000,
    clickStartsClock: true,
    source: published,
    beats,
    round: {
      id: published.roundId,
      price: px(published.priceTicks),
      volume: dmon(published.volumeLots),
      orders: {
        sealed: book.map(o => show(o, 'sealed')),
        revealed: book.map(o => show(o, 'revealed')),
        settled: book.map(o => show(o, 'settled')),
      },
      curve: {points: curve.points.length, lo: curve.lo, hi: curve.hi},
      user: {
        qty: dmon(user.lots),
        limit: px(user.limitTicks),
        locked: usd(user.escrow),
        filled: dmon(user.fillLots),
        received: `${token(BigInt(user.baseDue))} dMON`,
        refund: `${usd(user.quoteDue)} dUSDC`,
        components: outcome!.components.map(c => ({label: c.label, amount: usd(Number(c.value))})),
        reason: outcome!.reason,
      },
      partial: {id: 'P2', qty: '6', fill: '3', note: '同价按比例，余数按规则分配'},
    },
    contrast: {
      label: '三笔样例，不是第 4 轮',
      fairBatchPrice: '0.90',
      fairBatchBuyer: 'A',
      rows: contrast,
    },
    proof: {
      userTx: published.userTx,
      clearingTx: published.clearingTx,
      resultHash: published.resultHash,
      liabilities: {base: '0', quote: '0'},
    },
  };
}

export function demoClock(elapsedMs: number) {
  const reel = demoReel();
  const t = Math.max(0, elapsedMs);
  const beat = reel.beats.find(b => t >= b.atMs && t < b.atMs + b.holdMs) ?? reel.beats.at(-1)!;
  const done = t >= reel.durationMs;
  return {
    done,
    beat,
    index: reel.beats.indexOf(beat),
    beatElapsed: Math.min(t - beat.atMs, beat.holdMs),
    progress: Math.min(1, t / reel.durationMs),
  };
}
