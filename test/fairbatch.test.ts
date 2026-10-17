import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ganache from 'ganache';
import {encodeDeployData,encodeFunctionData,hashTypedData, keccak256, toHex, type Address,type Hex} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {witness,referenceClear,intentTypes,intentDomain,paddedEscrow} from '../src/fairbatch/protocol.ts';
import {compileFixture} from '../scripts/fairbatch-fixture.ts';
import {providerClients,transact} from '../scripts/chain.ts';
const token=JSON.parse(fs.readFileSync('artifacts/DemoToken.json','utf8'));
const art=JSON.parse(fs.readFileSync('artifacts/FairBatch.json','utf8'));
const salt=keccak256(toHex('test salt'));
test('FairBatch: clearing, deadlines, commitment binding and asset conservation',async t=>{
 const p=ganache.provider({chain:{chainId:31337,hardfork:'shanghai'},logging:{quiet:true},wallet:{totalAccounts:5}});
 t.after(()=>p.disconnect());
 const {publicClient:c,wallet}=providerClients(p);
 const accounts=await p.request({method:'eth_accounts',params:[]}) as Address[];
 async function deploy(a:any,args:any[]){const gas=await c.estimateGas({account:accounts[0],data:encodeDeployData({...a,args})});const h=await wallet(accounts[0]).deployContract({...a,args,gas:gas*12n/10n});return (await c.waitForTransactionReceipt({hash:h})).contractAddress!;}
 const b=await deploy(token,['Base','B',18]),q=await deploy(token,['Quote','Q',6]),book=await deploy(art,[b,q,60n,60n,120n]);
 const read=(name:string,args:any[]=[])=>c.readContract({address:book,abi:art.abi,functionName:name,args}) as Promise<any>;
 const write=(who:number,name:string,args:any[]=[])=>transact(c,wallet(accounts[who]),book,art.abi,name,args);
 for(const who of accounts)for(const a of [b,q]){await transact(c,wallet(who),a,token.abi,'faucet');await transact(c,wallet(who),a,token.abi,'approve',[book,2n**255n]);}
 const warp=async(n:bigint)=>{await p.request({method:'evm_setTime',params:[Number(n)*1000]});await p.request({method:'evm_mine',params:[]});};
 const round=()=>read('rounds',[1n]);
 async function commit(who:number,buy:boolean,lots:bigint,price:bigint){const h=await read('commitmentFor',[1n,accounts[who],buy,lots,price,salt]);await write(who,'commit',[1n,buy,h,lots*(buy?price*100n:10n**16n)]);}
 const reveal=(who:number,lots:bigint,price:bigint)=>write(4,'revealFor',[1n,accounts[who],lots,price,salt]);
 async function invariant(){for(const [addr,field]of [[b,'baseLiability'],[q,'quoteLiability']] as const){assert.equal(await c.readContract({address:addr,abi:token.abi,functionName:'balanceOf',args:[book]}),await read(field));}}
 const clean=await p.request({method:'evm_snapshot',params:[]});let checkpoint=clean;
 const reset=async()=>{await p.request({method:'evm_revert',params:[checkpoint]});checkpoint=await p.request({method:'evm_snapshot',params:[]});};
 await t.test('independent exhaustive oracle and all-order permutation invariance',async()=>{
  let seed=73019;const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
  const addr=(i:number)=>('0x'+(i+1).toString(16).padStart(40,'0')) as Address;
  for(let k=0;k<65;k++){
   const rows=Array.from({length:2+rnd()%30},(_,i)=>({owner:addr(i),isBuy:rnd()%3!==0,lots:BigInt(1+rnd()%30),limitTicks:BigInt(1+rnd()%20)}));
   const r=await read('compute',[rows]);assert.deepEqual(r,referenceClear(rows));assert.deepEqual(await read('computeWithWitness',[rows,...witness(rows)]),r);let volume=0n;
   for(let price=1n;price<=20n;price++){let buy=0n,sell=0n;for(const o of rows){if(o.isBuy&&o.limitTicks>=price)buy+=o.lots;if(!o.isBuy&&o.limitTicks<=price)sell+=o.lots;}const v=buy<sell?buy:sell;if(v>volume)volume=v;}
   assert.equal(r.volume,volume);let bv=0n,sv=0n;
   rows.forEach((o,i)=>{assert.ok(r.fills[i]>=0n&&r.fills[i]<=o.lots);if(r.fills[i]>0n)assert.ok(o.isBuy?r.price<=o.limitTicks:r.price>=o.limitTicks);if(o.isBuy)bv+=r.fills[i];else sv+=r.fills[i];});assert.equal(bv,volume);assert.equal(sv,volume);
   const rev=await read('compute',[[...rows].reverse()]);assert.equal(rev.price,r.price);assert.deepEqual([...rev.fills].reverse(),r.fills);
  }
  const rows=[{owner:addr(1),isBuy:true,lots:5n,limitTicks:110n},{owner:addr(2),isBuy:true,lots:3n,limitTicks:110n},{owner:addr(3),isBuy:false,lots:5n,limitTicks:90n}];
  const r=await read('compute',[rows]);assert.equal(r.price,100n);assert.deepEqual(r.fills,[3n,2n,5n]);
  const tie=await read('compute',[[{...rows[0],lots:1n},{...rows[1],lots:1n},{...rows[2],lots:1n}]]);assert.deepEqual(tie.fills,[1n,0n,1n]);
  const max=await read('compute',[Array.from({length:32},(_,i)=>({owner:addr(i),isBuy:i<16,lots:1_000_000_000n,limitTicks:1_000_000_000n}))]);assert.equal(max.volume,16_000_000_000n);
 });
 await t.test('malicious solver: omitted, duplicate, wrong-side, out-of-range, unsorted and unrevealed indices revert',async()=>{
  const rows=[{owner:accounts[0],isBuy:true,lots:5n,limitTicks:110n},{owner:accounts[1],isBuy:true,lots:3n,limitTicks:100n},{owner:accounts[2],isBuy:false,lots:5n,limitTicks:90n},{owner:accounts[3],isBuy:false,lots:0n,limitTicks:0n}];
  assert.deepEqual(await read('computeWithWitness',[rows,'0x0001','0x02']),referenceClear(rows));
  for(const [buys,sells] of [['0x00','0x02'],['0x0000','0x02'],['0x0002','0x01'],['0x0001','0xff'],['0x0100','0x02'],['0x0001','0x0203']])await assert.rejects(read('computeWithWitness',[rows,buys,sells]));
  assert.deepEqual(await read('computeWithWitness',[[],'0x','0x']),referenceClear([]));
 });
 await t.test('sealed commit, invalid preimage rejection, pro rata and exact refund',async()=>{
  await write(0,'openRound');await commit(0,true,5n,110n);await commit(1,true,3n,110n);await commit(2,false,5n,90n);await invariant();
  await assert.rejects(commit(0,true,1n,100n));await assert.rejects(reveal(0,5n,110n));
  const r=await round();await warp(r[0]);assert.equal(await read('phase',[1n]),2);await assert.rejects(commit(3,true,1n,100n));
  await assert.rejects(write(4,'revealFor',[1n,accounts[0],5n,110n,keccak256(toHex('wrong'))]));
  for(const[who,lots,price]of [[0,5n,110n],[1,3n,110n],[2,5n,90n]] as const)await reveal(who,lots,price);
  await assert.rejects(write(0,'settle',[1n]));await warp(r[1]);await write(4,'settle',[1n]);
  const after=await round();assert.equal(after[6],5n);assert.equal(after[7],100n);assert.deepEqual((await read('getOrders',[1n])).map((o:any)=>o.fillLots),[3n,2n,5n]);
  await invariant();await write(4,'claimMany',[1n,accounts.slice(0,3)]);await invariant();assert.equal(await read('baseLiability'),0n);assert.equal(await read('quoteLiability'),0n);
  await write(4,'claimFor',[1n,accounts[0]]);await invariant();await write(0,'openRound');assert.equal(await read('currentRound'),2n);
 });
 await t.test('unrevealed refund before settlement never double counts',async()=>{
  await reset();await write(0,'openRound');await commit(0,true,5n,110n);await commit(1,true,3n,110n);await commit(2,false,5n,90n);
  const r=await round();await warp(r[0]);await reveal(0,5n,110n);await reveal(2,5n,90n);await warp(r[1]);
  await write(4,'claimFor',[1n,accounts[1]]);await invariant();await write(4,'settle',[1n]);await write(4,'claimMany',[1n,accounts.slice(0,3)]);await invariant();assert.equal(await read('quoteLiability'),0n);
 });
 await t.test('exact phase boundaries and permissionless timeout recovery',async()=>{
  await reset();await write(0,'openRound');await commit(0,true,5n,110n);const r=await round();
  await warp(r[0]-1n);assert.equal(await read('phase',[1n]),1);await warp(r[0]);assert.equal(await read('phase',[1n]),2);
  await reveal(0,5n,110n);await warp(r[1]-1n);assert.equal(await read('phase',[1n]),2);await warp(r[1]);assert.equal(await read('phase',[1n]),3);
  await assert.rejects(write(4,'claimFor',[1n,accounts[0]]));await warp(r[2]-1n);assert.equal(await read('phase',[1n]),3);await warp(r[2]);assert.equal(await read('phase',[1n]),5);
  await assert.rejects(write(4,'settle',[1n]));await write(4,'claimFor',[1n,accounts[0]]);await invariant();assert.equal(await read('quoteLiability'),0n);await write(0,'openRound');
  const h1=await read('commitmentFor',[1n,accounts[0],true,5n,110n,salt]),h2=await read('commitmentFor',[2n,accounts[0],true,5n,110n,salt]);assert.notEqual(h1,h2);
 });
 await t.test('EIP-712: domain, every signed field, replay, cancellation and expiry are enforced',async()=>{
  await reset();await write(0,'openRound');
  const signer=privateKeyToAccount(p.getInitialAccounts()[accounts[0].toLowerCase()].secretKey as Hex);
  const r=await round(),commitment=await read('commitmentFor',[1n,accounts[0],true,5n,110n,salt]);
  const intent={roundId:1n,owner:accounts[0],isBuy:true,commitment,escrow:55000n,nonce:0n,deadline:r[0]-1n};
  const typed={domain:intentDomain(31337,book),types:intentTypes,primaryType:'CommitIntent' as const,message:intent};
  const sig=await signer.signTypedData(typed);
  assert.equal(await read('intentDigest',[intent]),hashTypedData(typed));
  for(const patch of [{roundId:2n},{owner:accounts[1]},{isBuy:false},{commitment:salt},{escrow:55001n},{nonce:1n},{deadline:r[0]-2n}])await assert.rejects(write(4,'commitFor',[{...intent,...patch},sig]));
  for(const domain of [intentDomain(1,book),intentDomain(31337,b),{...typed.domain,version:'0.2'}])await assert.rejects(write(4,'commitFor',[intent,await signer.signTypedData({...typed,domain})]));
  await assert.rejects(write(4,'commitFor',[intent,'0x1234']));assert.equal(await read('nonces',[accounts[0]]),0n);
  await write(4,'commitFor',[intent,sig]);assert.equal(await read('nonces',[accounts[0]]),1n);assert.equal((await read('getOrder',[1n,accounts[0]])).escrow,55000n);
  await assert.rejects(write(3,'commitFor',[intent,sig]));await invariant();
  await reset();await write(0,'openRound');await write(0,'invalidateNonce',[7n]);await assert.rejects(write(4,'commitFor',[intent,sig]));await assert.rejects(write(0,'invalidateNonce',[7n]));
  const expired={...intent,nonce:7n,deadline:(await c.getBlock()).timestamp-1n};await assert.rejects(write(4,'commitFor',[expired,await signer.signTypedData({...typed,message:expired})]));
  await commit(0,true,5n,110n);assert.equal(await read('nonces',[accounts[0]]),8n);
 });
 await t.test('ERC-1271 wallet validates delegated orders and retains ownership of refund',async()=>{
  await reset();await write(0,'openRound');
  const mock=compileFixture('test/fixtures',['SignatureWallet.sol'],'SignatureWallet');
  const contractWallet=await deploy(mock,[accounts[0]]);
  for(const fn of ['faucet','approve'])await transact(c,wallet(accounts[0]),contractWallet,mock.abi,'execute',[q,encodeFunctionData({abi:token.abi,functionName:fn,args:fn==='approve'?[book,2n**255n]:[]})]);
  const signer=privateKeyToAccount(p.getInitialAccounts()[accounts[0].toLowerCase()].secretKey as Hex);
  const r=await round(),intent={roundId:1n,owner:contractWallet,isBuy:true,commitment:await read('commitmentFor',[1n,contractWallet,true,5n,110n,salt]),escrow:55000n,nonce:0n,deadline:r[0]-1n};
  const sig=await signer.signTypedData({domain:intentDomain(31337,book),types:intentTypes,primaryType:'CommitIntent',message:intent});
  await write(4,'commitFor',[intent,sig]);await warp(r[1]);await write(3,'claimFor',[1n,contractWallet]);await invariant();
  assert.equal(await c.readContract({address:q,abi:token.abi,functionName:'balanceOf',args:[contractWallet]}),10000n*10n**6n);
 });
 await t.test('padded buy/sell escrow, verified settlement, excess refund and insufficient collateral',async()=>{
  await reset();await write(0,'openRound');
  for(const [who,buy,lots,ticks,escrow]of [[0,true,5n,110n,1000000n],[1,false,3n,90n,10n**18n],[2,true,5n,110n,100n]]as const){
   const h=await read('commitmentFor',[1n,accounts[who],buy,lots,ticks,salt]);await write(who,'commit',[1n,buy,h,escrow]);
  }
  const r=await round();await warp(r[0]);await reveal(0,5n,110n);await reveal(1,3n,90n);await assert.rejects(reveal(2,5n,110n));await warp(r[1]);
  await assert.rejects(write(4,'settleWithWitness',[1n,'0x00','0x']));assert.equal(await read('phase',[1n]),3);
  const rows=(await read('getOrders',[1n])).map((o:any)=>({...o,lots:o.revealed?o.lots:0n}));await write(4,'settleWithWitness',[1n,...witness(rows)]);
  const after=await read('getOrders',[1n]);assert.equal(after[0].quoteDue,970000n);assert.equal(after[1].baseDue,970000000000000000n);
  assert.equal(after[2].quoteDue,100n);await invariant();await write(4,'claimMany',[1n,accounts.slice(0,3)]);await invariant();assert.equal(await read('baseLiability'),0n);assert.equal(await read('quoteLiability'),0n);
  const historical=await read('getOrders',[1n]);await write(4,'openRound');assert.deepEqual(await read('getOrders',[1n]),historical);
  assert.equal(paddedEscrow(5150000n,1000000n),8000000n);assert.equal(paddedEscrow(8000000n,1000000n),8000000n);
 });

});
