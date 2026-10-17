import fs from 'node:fs';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import {encodeDeployData,keccak256,toHex,type Address} from 'viem';
import {providerClients,transact} from './chain.ts';
import {compileFixture} from './fairbatch-fixture.ts';
import {witness,referenceClear,type Input} from '../src/fairbatch/protocol.ts';
const p=ganache.provider({chain:{chainId:31337,hardfork:'shanghai'},logging:{quiet:true},wallet:{totalAccounts:33}});
const {publicClient:c,wallet}=providerClients(p),accounts=await p.request({method:'eth_accounts',params:[]}) as Address[];
const old=compileFixture('test/fixtures/v02',['BatchMath.sol','FairBatch.sol'],'FairBatch');
const current=JSON.parse(fs.readFileSync('artifacts/FairBatch.json','utf8')),token=JSON.parse(fs.readFileSync('artifacts/DemoToken.json','utf8'));
async function deploy(a:any,args:any[]){const gas=await c.estimateGas({account:accounts[0],data:encodeDeployData({...a,args})});const hash=await wallet(accounts[0]).deployContract({...a,args,gas:gas*12n/10n});return (await c.waitForTransactionReceipt({hash})).contractAddress!;}
const pct=(a:any,b:any)=>Number((BigInt(a)-BigInt(b))*10000n/BigInt(a))/100;
try{
 const base=await deploy(token,['Base','B',18]),quote=await deploy(token,['Quote','Q',6]);
 const before=await deploy(old,[base,quote,600n,600n,600n]),after=await deploy(current,[base,quote,600n,600n,600n]);
 const rows=(n:number,tie=false):Input[]=>Array.from({length:n},(_,i)=>({owner:accounts[i],isBuy:i<n/2,lots:tie?(i<n/2?17n:15n):10n,limitTicks:BigInt(tie?100:i<n/2?101+i:99-(i-n/2))}));
 const scenarios=[];
 for(const n of [8,16,32])for(const tied of [false,true]){
  const input=rows(n,tied),expected=referenceClear(input);
  const read=async(address:Address,abi:any,fn:string,args:any[])=>c.readContract({address,abi,functionName:fn,args});
  assert.deepEqual(await read(after,current.abi,'computeWithWitness',[input,...witness(input)]),expected);
  assert.deepEqual(await read(before,old.abi,'compute',[input]),expected);
  const a=await transact(c,wallet(accounts[32]),before,old.abi,'compute',[input]);
  const b=await transact(c,wallet(accounts[32]),after,current.abi,'compute',[input]);
  const v=await transact(c,wallet(accounts[32]),after,current.abi,'computeWithWitness',[input,...witness(input)]);
  scenarios.push({name:tied?'marginal-pro-rata':'reverse-price-priority',orders:n,baselineComputeGas:a.gasUsed,fallbackComputeGas:b.gasUsed,verifiedComputeGas:v.gasUsed,verifiedSavingsPercent:pct(a.gasUsed,v.gasUsed)});
 }
 const input=rows(32,false),salt=keccak256(toHex('fixed benchmark salt'));
 for(const owner of accounts.slice(0,32))for(const t of [base,quote]){
  await transact(c,wallet(owner),t,token.abi,'faucet');
  for(const book of [before,after])await transact(c,wallet(owner),t,token.abi,'approve',[book,2n**255n]);
 }
 const full=[];
 for(const [name,book,abi]of [['v0.2',before,old.abi],['v0.3',after,current.abi]]as const){
  const read=(fn:string,args:any[]=[])=>c.readContract({address:book,abi,functionName:fn,args}) as Promise<any>;
  await transact(c,wallet(accounts[32]),book,abi,'openRound');
  for(const o of input){const h=await read('commitmentFor',[1n,o.owner,o.isBuy,o.lots,o.limitTicks,salt]);await transact(c,wallet(o.owner),book,abi,'commit',[1n,o.isBuy,h,o.lots*(o.isBuy?o.limitTicks*100n:10n**16n)]);}
  const round=await read('rounds',[1n]);await p.request({method:'evm_setTime',params:[Number(round[0])*1000]});await p.request({method:'evm_mine',params:[]});
  for(const o of input)await transact(c,wallet(accounts[32]),book,abi,'revealFor',[1n,o.owner,o.lots,o.limitTicks,salt]);
  await p.request({method:'evm_setTime',params:[Number(round[1])*1000]});await p.request({method:'evm_mine',params:[]});
  const snapshot=await p.request({method:'evm_snapshot',params:[]});
  const r=await transact(c,wallet(accounts[32]),book,abi,'settle',[1n]);const paid=await transact(c,wallet(accounts[32]),book,abi,'claimMany',[1n,accounts.slice(0,32)]);full.push({name,route:'on-chain sort',gas:r.gasUsed,claimGas:paid.gasUsed,settleAndClaimGas:r.gasUsed+paid.gasUsed});
  if(name==='v0.3'){
   await p.request({method:'evm_revert',params:[snapshot]});
   const verified=await transact(c,wallet(accounts[32]),book,abi,'settleWithWitness',[1n,...witness(input)]);const paid=await transact(c,wallet(accounts[32]),book,abi,'claimMany',[1n,accounts.slice(0,32)]);full.push({name,route:'verified witness',gas:verified.gasUsed,claimGas:paid.gasUsed,settleAndClaimGas:verified.gasUsed+paid.gasUsed});
   assert.deepEqual((await read('getOrders',[1n])).map((o:any)=>o.fillLots),referenceClear(input).fills);
  }
 }
 const report={generatedAt:new Date().toISOString(),environment:{chainId:31337,evm:'Shanghai',compiler:'solc 0.8.30, viaIR, optimizer 200',measurement:'mined receipt gasUsed; baseline v0.2 sources included in test/fixtures/v02'},scenarios,fullSettlement32:full,fullSettlementSavingsPercent:pct(full[0].gas,full[2].gas),settleAndClaimSavingsPercent:pct(full[0].settleAndClaimGas,full[2].settleAndClaimGas)};
 fs.writeFileSync('docs/protocol-benchmark.json',JSON.stringify(report,(_,v)=>typeof v==='bigint'?String(v):v,2)+'\n');console.log(JSON.stringify(report,(_,v)=>typeof v==='bigint'?String(v):v,2));
}finally{await p.disconnect();}
