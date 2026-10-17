// Run against the installed web service; only Monad testnet is accepted.
import fs from 'node:fs';
import {createPublicClient,createWalletClient,http,keccak256,toHex,type Hex} from 'viem';
import {privateKeyToAccount,generatePrivateKey} from 'viem/accounts';
import {testnet,transact} from './chain.ts';
import {tokenAbi,fairBatchAbi} from '../src/abi.ts';
import {intentDomain,intentTypes,referenceClear,clearingInputs} from '../src/fairbatch/protocol.ts';
const origin=process.env.FAIRBATCH_ORIGIN||'http://127.0.0.1:5198';
const d=await (await fetch(origin+'/fairbatch.json')).json();if(d.chainId!==10143)throw Error('This check requires Monad Testnet');
const c=createPublicClient({chain:testnet,transport:http(d.rpc),pollingInterval:500});
if(await c.getChainId()!==10143)throw Error('RPC chain mismatch');
fs.mkdirSync('.local',{recursive:true});
const file='.local/fairbatch-smoke-wallet.json';if(!fs.existsSync(file)){const privateKey=generatePrivateKey();fs.writeFileSync(file,JSON.stringify({privateKey}),{mode:0o600,flag:'wx'});}
const account=privateKeyToAccount(JSON.parse(fs.readFileSync(file,'utf8')).privateKey);
const w=createWalletClient({account,chain:testnet,transport:http(d.rpc)});
const read=(functionName:string,args:any[]=[])=>c.readContract({address:d.contract,abi:fairBatchAbi,functionName:functionName as any,args:args as any}) as Promise<any>;
async function api(action:string,body:any){const r=await fetch(origin+'/api/fairbatch/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,chainId:d.chainId,contract:d.contract},(_,v)=>typeof v==='bigint'?String(v):v)});const result=await r.json();if(!r.ok)throw Error(result.error);return result;}
const evidence:any={at:new Date().toISOString(),chainId:d.chainId,contract:d.contract,owner:account.address,transactions:{}};
if(await c.getBalance({address:account.address})===0n)await api('fund',{address:account.address});
for(const address of [d.base,d.quote]){
 if(await c.readContract({address,abi:tokenAbi,functionName:'balanceOf',args:[account.address]})===0n)await transact(c,w,address,tokenAbi,'faucet');
 if(await c.readContract({address,abi:tokenAbi,functionName:'allowance',args:[account.address,d.contract]})===0n)await transact(c,w,address,tokenAbi,'approve',[d.contract,2n**255n]);
}
console.log('Wallet ready',account.address);
evidence.transactions.open=(await api('open',{seed:true})).hash;
const id=await read('currentRound'),round=await read('rounds',[id]);evidence.round=String(id);
const salt=keccak256(toHex(crypto.getRandomValues(new Uint8Array(32))));
const commitment=await read('commitmentFor',[id,account.address,true,500n,103n,salt]);
const intent={roundId:id,owner:account.address,isBuy:true,commitment,escrow:8000000n,nonce:await read('nonces',[account.address]),deadline:round[0]-1n};
const signature=await w.signTypedData({domain:intentDomain(d.chainId,d.contract),types:intentTypes,primaryType:'CommitIntent',message:intent});
evidence.transactions.commit=(await api('commit',{round:id,intent,signature})).hash;
console.log('Sealed order accepted',String(id),evidence.transactions.commit);
const deadline=Date.now()+300_000;let revealed=false;
while(Date.now()<deadline){
 const phase=await read('phase',[id]);
 if(phase===2&&!revealed){evidence.transactions.reveal=(await api('reveal',{round:id,owner:account.address,lots:'500',ticks:'103',salt})).hash;revealed=true;console.log('Order revealed',evidence.transactions.reveal);}
 if(phase===4){
  const rows=await read('getOrders',[id]);if(!rows.every((o:any)=>o.claimed)){await new Promise(r=>setTimeout(r,1500));continue;}
  const result=await read('rounds',[id]),ref=referenceClear(clearingInputs(rows));
  if(result[7]!==ref.price||result[6]!==ref.volume||!rows.every((o:any,i:number)=>o.fillLots===ref.fills[i]))throw Error('Independent clearing mismatch');
  const mine=rows.find((o:any)=>o.owner.toLowerCase()===account.address.toLowerCase());
  if(!mine?.claimed||mine.baseDue!==5n*10n**18n||mine.quoteDue!==3n*10n**6n)throw Error('User settlement mismatch');
  if(await read('baseLiability')!==0n||await read('quoteLiability')!==0n)throw Error('Unclaimed liabilities');
  evidence.orders=rows;evidence.price=String(result[7]);evidence.volume=String(result[6]);evidence.verified=true;
  const out=process.env.FAIRBATCH_SMOKE_OUTPUT||'docs/monad-verification.json';fs.writeFileSync(out,JSON.stringify(evidence,(_,v)=>typeof v==='bigint'?String(v):v,2));
  console.log('PASS: all five orders settled and claimed; 5 dMON received + 3 dUSDC refunded; liabilities zero');process.exit(0);
 }
 if(phase===5)throw Error('Round expired');
 await new Promise(r=>setTimeout(r,1500));
}
throw Error('Settlement timed out');
