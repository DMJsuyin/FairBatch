import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {demoClock, demoReel} from '../src/fairbatch/demo.ts';

test('recording reel stays inside three minutes and does not wait on a live round', () => {
  const reel = demoReel();
  assert.equal(reel.mode, 'replay');
  assert.equal(reel.waitsForChain, false);
  assert.equal(reel.openRoundOnClick, false);
  assert.equal(reel.durationMs, reel.beats.reduce((s, b) => s + b.holdMs, 0));
  assert.ok(reel.durationMs >= 150000 && reel.durationMs <= 174000);
  assert.ok(reel.durationMs < reel.recommendedRecordingMs);
  let at = 0;
  for (const beat of reel.beats) {
    assert.equal(beat.atMs, at);
    assert.ok(beat.narration.length > 12);
    assert.ok([...beat.narration].length <= Math.floor(beat.holdMs / 1000 * 4.6), beat.id);
    assert.ok(beat.caption.length <= 16, beat.id);
    at += beat.holdMs;
  }
  assert.equal(JSON.stringify(reel).includes('60s'), false);
});

test('round 4 frames match the published verification, including the refund split', () => {
  const published = JSON.parse(fs.readFileSync('docs/monad-public-verification.json', 'utf8'));
  const reel = demoReel();
  assert.equal(reel.source.contract, published.contract);
  assert.equal(reel.source.clearingTx, published.events.find((e: {event: string}) => e.event === 'ClearingVerified').transactionHash);
  assert.equal(reel.source.userTx, published.events.find((e: {event: string; args: {owner: string}}) => e.event === 'IntentExecuted' && e.args.owner === '0x0D191bC0114e913965a1A044aCc0C9353Ee9884F').transactionHash);
  assert.equal(reel.round.price, '1.00');
  assert.equal(reel.round.volume, '16');
  assert.equal(reel.round.user.received, '5 dMON');
  assert.equal(reel.round.user.refund, '3.00 dUSDC');
  assert.equal(reel.round.orders.sealed.every(o => o.qty === null && o.escrow === null), true);
  assert.equal(reel.round.orders.settled.find(o => o.id === 'P3')?.escrow, '7');
  assert.equal(reel.round.orders.settled.find(o => o.id === 'YOU')?.received, '5');
  assert.deepEqual(reel.round.user.components.map(c => c.amount), ['0.15', '2.85']);
  assert.equal(reel.round.user.components.reduce((s, c) => s + Number(c.amount), 0).toFixed(2), '3.00');
  assert.equal(reel.round.orders.sealed.every(o => o.limit === null), true);
  assert.equal(reel.round.orders.revealed.every(o => o.limit !== null), true);
  assert.ok(reel.round.curve.points <= bookPoints(published.orders.length));
  assert.ok(reel.round.curve.points < 20);
});

test('sequence lab is labeled apart from round 4 and is not order-invariant on the continuous book', () => {
  const reel = demoReel();
  const compare = reel.beats.find(b => b.id === 'compare')!;
  assert.equal(compare.dataset, 'sequence-lab');
  assert.match(compare.narration, /不是第 4 轮/);
  assert.equal(new Set(reel.contrast.rows.map(r => r.clobPrice)).size > 1, true);
  assert.equal(new Set(reel.contrast.rows.map(r => r.clobBuyer)).size > 1, true);
  assert.equal(reel.contrast.rows.every(r => r.fairBatchPrice === '0.90' && r.fairBatchBuyer === 'A'), true);
});

test('clock lands on the refund beat before the proof card and then finishes', () => {
  const mid = demoClock(demoReel().beats.find(b => b.id === 'result')!.atMs + 1000);
  assert.equal(mid.beat.id, 'result');
  assert.equal(mid.done, false);
  const end = demoClock(demoReel().durationMs + 50);
  assert.equal(end.done, true);
  assert.equal(end.beat.id, 'proof');
});

function bookPoints(n: number) {
  return n * 4;
}
