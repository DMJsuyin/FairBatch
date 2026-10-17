import test from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import {compile} from '../scripts/compile.ts';
import {providerClients,deployMarket,fundAccount,transact} from '../scripts/chain.ts';
import type {Address} from 'viem';
const artifacts=compile();
const r=(buy:boolean,price:number,lots:number, extra={})=>({isBuy:buy,price:BigInt(price),lots:BigInt(lots),postOnly:false,ioc:false,minFill:0n,...extra});
async function setup(t:any) {
  const provider=ganache.provider({chain:{chainId:31337,hardfork:'shanghai'},logging:{quiet:true},wallet:{totalAccounts:4}});
  t.after(()=>provider.disconnect());
  const {publicClient:c,wallet}=providerClients(provider);
  const accounts=await provider.request({method:'eth_accounts',params:[]}) as Address[];
  const market=await deployMarket(c,wallet(accounts[0]),artifacts);
  for(const a of accounts.slice(0,3)) await fundAccount(c,wallet(a),market,artifacts);
  const read=(name:string,args:any[]=[])=>c.readContract({address:market.book,abi:artifacts.OrderBook.abi,functionName:name,args}) as Promise<any>;
  const write=(who:number,name:string,args:any[]=[])=>transact(c,wallet(accounts[who]),market.book,artifacts.OrderBook.abi,name,args);
  async function invariant() {
    const entries=[...await read('getBook',[true]),...await read('getBook',[false])];
    let base=0n,quote=0n;
    for(const a of accounts){base+=await read('baseFree',[a]);quote+=await read('quoteFree',[a]);}
    for(const o of entries){if(o.isBuy)quote+=BigInt(o.lots)*BigInt(o.price)*100n;else base+=o.lots*10n**16n;}
    assert.equal(BigInt(entries.length),await read('activeOrders'));
    assert.equal(base,await read('baseLiability'));assert.equal(quote,await read('quoteLiability'));
    for(const [address,liability] of [[market.base,base],[market.quote,quote]] as const) {
      assert.equal(await c.readContract({address,abi:artifacts.DemoToken.abi,functionName:'balanceOf',args:[market.book]}),liability);
    }
    for(const side of [true,false]) {
      const rows=await read('getBook',[side]);
      for(let i=1;i<rows.length;i++) assert.ok(side?rows[i-1].price>=rows[i].price:rows[i-1].price<=rows[i].price);
      for(let i=0;i<rows.length;i++) {
        const row=await read('orders',[rows[i].id]);
        assert.equal(row[4],i?rows[i-1].id:0n);assert.equal(row[5],i+1<rows.length?rows[i+1].id:0n);
      }
    }
  }
  return {c,accounts,market,read,write,invariant};
}
test('maker price, FIFO, partial fill, improvement refund, cancel and withdraw conserve assets',async t=>{
  const {read,write,accounts,invariant}=await setup(t);
  await write(1,'placeOrder',[r(false,105,50)]);
  await write(2,'placeOrder',[r(false,103,40)]);
  await write(1,'placeOrder',[r(false,103,30)]);
  await write(0,'placeOrder',[r(true,110,60,{ioc:true,minFill:60n})]);
  const asks=await read('getBook',[false]);
  assert.deepEqual(asks.map((o:any)=>[o.id,o.lots]),[[3n,10n],[1n,50n]]);
  assert.equal(await read('baseFree',[accounts[0]]),5000n*10n**18n+60n*10n**16n);
  assert.equal(await read('quoteFree',[accounts[0]]),5000n*10n**6n-60n*103n*100n);
  await write(1,'cancel',[3n]);
  await write(0,'withdraw',[true,60n*10n**16n]);
  await invariant();
});
test('buy maker execution and residual IOC release have exact accounting',async t=>{
  const {read,write,accounts,invariant}=await setup(t);
  await write(1,'placeOrder',[r(true,108,30)]);
  await write(0,'placeOrder',[r(false,100,50,{ioc:true})]);
  assert.equal((await read('getBook',[true])).length,0);
  assert.equal(await read('quoteFree',[accounts[0]]),5000n*10n**6n+30n*108n*100n);
  assert.equal(await read('baseFree',[accounts[0]]),5000n*10n**18n-30n*10n**16n);
  await invariant();
});
test('post-only, minimum fill, self-trade and unauthorized cancel revert without ledger changes',async t=>{
  const {read,write,invariant}=await setup(t);
  await write(1,'placeOrder',[r(false,100,10)]);
  await assert.rejects(write(0,'placeOrder',[r(true,101,20,{ioc:true,minFill:20n})]));
  await assert.rejects(write(0,'placeOrder',[r(true,100,5,{postOnly:true})]));
  await assert.rejects(write(1,'placeOrder',[r(true,100,5)]));
  await assert.rejects(write(0,'cancel',[1n]));
  await assert.rejects(write(0,'withdraw',[true,6000n*10n**18n]));
  assert.equal((await read('orders',[1n]))[3],10n);
  assert.equal(await read('nextOrderId'),2n);
  await invariant();
});
test('batch placement, cancellation and replacement are atomic',async t=>{
  const {read,write,invariant}=await setup(t);
  const receipt=await write(0,'batchPlaceOrders',[Array.from({length:8},(_,i)=>r(true,80+i,100))]);
  console.log(`8-order batch gas: ${receipt.gasUsed}`);
  await assert.rejects(write(0,'batchPlaceOrders',[[r(true,90,10),r(true,1_000_000_000,1_000_000_000)]]));
  assert.equal(await read('activeOrders'),8n);
  await assert.rejects(write(0,'replaceOrders',[[1n,2n],[r(true,100,0)]]));
  assert.equal((await read('orders',[1n]))[3],100n);
  await assert.rejects(write(0,'batchCancel',[[1n,1n]]));
  await write(0,'replaceOrders',[[1n,2n],[r(true,88,100)]]);
  assert.equal(await read('activeOrders'),7n);
  await invariant();
});
test('matching cap: GTC cannot leave a crossed book; IOC releases unused collateral',async t=>{
  const {read,write,invariant}=await setup(t);
  for(let i=0;i<3;i++) await write(1,'batchPlaceOrders',[Array.from({length:i===2?1:16},()=>r(false,100,1))]);
  await assert.rejects(write(0,'placeOrder',[r(true,100,33)]));
  assert.equal(await read('activeOrders'),33n);
  await write(0,'placeOrder',[r(true,100,33,{ioc:true,minFill:32n})]);
  assert.equal(await read('activeOrders'),1n);
  await invariant();
});
test('bounded book accepts 128 resting orders and safely rejects capacity/invalid inputs',async t=>{
  const {read,write,invariant}=await setup(t);
  for(let i=0;i<8;i++)await write(0,'batchPlaceOrders',[Array.from({length:16},()=>r(true,90,1))]);
  assert.equal(await read('activeOrders'),128n);
  await assert.rejects(write(0,'placeOrder',[r(true,90,1)]));
  await assert.rejects(write(0,'batchPlaceOrders',[[]]));
  await assert.rejects(write(0,'placeOrder',[r(false,0,1)]));
  await invariant();
});
test('deterministic adversarial sequence preserves order links, collateral and token conservation',async t=>{
  const {read,write,invariant}=await setup(t);
  let seed=81231;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
  for(let i=0;i<65;i++) {
    const who=random()%3,buy=random()%2===0,price=90+random()%21,lots=1+random()%80;
    try{await write(who,'placeOrder',[r(buy,price,lots,{ioc:i%4===0})]);}catch(e){assert.match(String(e),/SelfTrade|InsufficientBalance/);}
    if(i%7===0) await invariant();
  }
  for(const o of [...await read('getBook',[true]),...await read('getBook',[false])]) {
    // Owners are resolved through eth_accounts in setup; cancellation authorization is separately tested.
    assert.ok(o.lots>0n);
  }
  await invariant();
});
