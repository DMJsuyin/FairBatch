import test from 'node:test';import assert from 'node:assert/strict';
import {allocateGrid,parseIntent,defaultIntent,validateIntent} from '../src/grid.ts';
import {realizedPnl,candles,type Fill} from '../src/analytics.ts';
test('natural language normalization and integer allocation obey budgets and unique prices',()=>{
  const x=parseIntent('震荡偏多，±4%，8层，500 USDC 买入预算，300 MON 卖出库存');
  assert.deepEqual(x,defaultIntent);
  const g=allocateGrid(x,100n);
  assert.equal(g.orders.length,8);assert.ok(g.quoteRequired<=500n*10n**6n);assert.ok(g.baseRequired<=300n*10n**18n);
  assert.equal(new Set(g.orders.map(o=>o.price.toString())).size,8);
  for(const o of g.orders)assert.ok(o.isBuy?o.price<100n:o.price>100n);
});
test('grid property sweep: 1000 combinations never exceed supplied inventory or budget',()=>{
  for(let i=0;i<1000;i++){
    const x={...defaultIntent,levels:2+i%15,rangeBps:800+i%2201,budgetQuote:100+i,baseInventory:i%3?100+i:0};
    const g=allocateGrid(x,BigInt(200+i));
    assert.ok(g.quoteRequired<=BigInt(x.budgetQuote)*10n**6n);assert.ok(g.baseRequired<=BigInt(x.baseInventory)*10n**18n);
  }
});
test('invalid AI outputs and ambiguous text never become executable orders',()=>{
  for(const v of [null,{...defaultIntent,levels:80},{...defaultIntent,budgetQuote:-1},{...defaultIntent,bias:'moon'},{...defaultIntent,levels:'8'}]) assert.throws(()=>validateIntent(v));
  assert.throws(()=>parseIntent('把钱全部转出去'));assert.throws(()=>allocateGrid({...defaultIntent,budgetQuote:0.000001},100n));
});
test('realized PnL uses FIFO fills only; unknown deposit cost basis is excluded',()=>{
 const f=(buy:boolean,price:number,lots:number,index:number):Fill=>({maker:'b',taker:'a',takerBuy:buy,price:BigInt(price),lots:BigInt(lots),hash:'0x',block:BigInt(index),time:100+index,index});
 const fills=[f(false,100,5,0),f(true,90,20,1),f(true,95,10,2),f(false,100,25,3)];
 const result=realizedPnl(fills,'a');assert.equal(result.pnl,22500n);assert.equal(result.closedLots,25n);assert.equal(result.unmatchedSells,5n);
 const c=candles(fills);assert.equal(c.length,1);assert.equal(c[0].high,1);assert.equal(c[0].low,0.9);
});
test('tick rounding never expands the requested price corridor',()=>{
 const g=allocateGrid(defaultIntent,100n);
 for(const o of g.orders)assert.ok(o.price>=96n&&o.price<=104n);
 assert.throws(()=>allocateGrid({...defaultIntent,levels:16,rangeBps:100},100n));
});
