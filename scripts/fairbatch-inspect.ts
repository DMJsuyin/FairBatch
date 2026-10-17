import fs from 'node:fs';
import {createPublicClient,http,encodeAbiParameters,keccak256,stringToHex} from 'viem';
import assert from 'node:assert/strict';
import {referenceClear,clearingInputs} from '../src/fairbatch/protocol.ts';
import {fairBatchAbi,tokenAbi} from '../src/abi.ts';
const site=process.env.FAIRBATCH_SITE||'https://clob.reallier.com';
const d=await (await fetch(`${site}/fairbatch.json`)).json();
const client=createPublicClient({transport:http(new URL(d.rpc,site).href)});
const read=(functionName:string,args:any[]=[])=>client.readContract({address:d.contract,abi:fairBatchAbi,functionName:functionName as any,args:args as any}) as Promise<any>;
if(process.argv.includes('--wait')){let last=-1;for(let attempt=0;attempt<40;attempt++){const rid=await read('currentRound'),phase=await read('phase',[rid]);if(phase!==last){console.log('Observed phase',phase,'round',String(rid));last=phase;}if(phase===4&&(await read('getOrders',[rid])).every((o:any)=>o.claimed))break;await new Promise(r=>setTimeout(r,5000));}}
const id=await read('currentRound'),round=await read('rounds',[id]),orders=await read('getOrders',[id]);
const [baseLiability,quoteLiability,baseBalance,quoteBalance]=await Promise.all([read('baseLiability'),read('quoteLiability'),client.readContract({address:d.base,abi:tokenAbi,functionName:'balanceOf',args:[d.contract]}),client.readContract({address:d.quote,abi:tokenAbi,functionName:'balanceOf',args:[d.contract]})]);
const result={observedAt:new Date().toISOString(),site,chainId:await client.getChainId(),contract:d.contract,roundId:id,phase:await read('phase',[id]),commitEnd:round[0],revealEnd:round[1],settleEnd:round[2],volumeLots:round[6],priceTicks:round[7],baseLiability,quoteLiability,baseBalance,quoteBalance,solvent:baseBalance>=baseLiability&&quoteBalance>=quoteLiability,orders};
if(process.argv.includes('--wait')&&(result.phase!==4||!orders.every((o:any)=>o.claimed)||!result.solvent))throw Error('Round did not fully settle and pay out before deadline');
if(result.phase===4){
 const independent=referenceClear(clearingInputs(orders));assert.equal(independent.volume,result.volumeLots);assert.equal(independent.price,result.priceTicks);assert.deepEqual(independent.fills,orders.map((o:any)=>o.fillLots));
 Object.assign(result,{independentClearingVerified:true,independent});
 if(d.protocolVersion==='0.3'){
  const latest=await client.getBlockNumber(),events:any[]=[];
  for(let from=BigInt(d.deployBlock);from<=latest;from+=100n){
   const to=from+99n<latest?from+99n:latest;
   for(const eventName of ['IntentExecuted','ClearingVerified']as const)events.push(...await client.getContractEvents({address:d.contract,abi:fairBatchAbi,eventName,fromBlock:from,toBlock:to}));
  }
  const relevant=events.filter(e=>e.args.roundId===id);
  const verified=relevant.find(e=>e.eventName==='ClearingVerified');assert.ok(verified,'settlement verification event');
  const expectedHash=keccak256(encodeAbiParameters([{type:'bytes32'},{type:'uint256'},{type:'address'},{type:'uint256'},{type:'tuple',components:[{name:'volume',type:'uint256'},{name:'price',type:'uint256'},{name:'low',type:'uint256'},{name:'high',type:'uint256'},{name:'fills',type:'uint256[]'}]}],[keccak256(stringToHex('FairBatch:v0.3')),BigInt(d.chainId),d.contract,id,independent]));
  assert.equal(verified.args.resultHash,expectedHash);
  Object.assign(result,{resultHashVerified:true,events:relevant.map(e=>({event:e.eventName,args:e.args,transactionHash:e.transactionHash,blockNumber:e.blockNumber}))});
 }
}
const json=JSON.stringify(result,(_,v)=>typeof v==='bigint'?String(v):v,2);if(!process.argv[2])console.log(json);else console.log('Verified round',String(id),'phase',result.phase,'orders',orders.length,'solvent',result.solvent);
if(process.argv[2])fs.writeFileSync(process.argv[2],json+'\n');
