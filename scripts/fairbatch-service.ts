import fs from 'node:fs';
import {createPublicClient,createWalletClient,http,keccak256,toHex,isAddress,type Address,type Hex} from 'viem';
import {randomBytes} from 'node:crypto';
import {localChain,transact} from './chain.ts';
import {fairBatchAbi} from '../src/abi.ts';
import {witness,clearingInputs} from '../src/fairbatch/protocol.ts';

type Secret={round:string;owner:Address;lots:string;ticks:string;salt:Hex};
export function fairBatchService(rpc:string){
 const client=createPublicClient({chain:localChain,transport:http(rpc),pollingInterval:200});
 const manifest=()=>fs.existsSync('public/fairbatch.json')?JSON.parse(fs.readFileSync('public/fairbatch.json','utf8')):null;
 const statePath='.local/fairbatch-bots.json';
 let queue:Promise<any>=Promise.resolve(),ticking=false;
 let secrets:Secret[]=fs.existsSync(statePath)?JSON.parse(fs.readFileSync(statePath,'utf8')):[];
 const save=()=>{fs.mkdirSync('.local',{recursive:true});fs.writeFileSync(statePath,JSON.stringify(secrets),{mode:0o600});};
 const serial=<T>(fn:()=>Promise<T>)=>{const next=queue.then(fn);queue=next.catch(()=>{});return next;};
 async function wallet(a?:Address){const accounts=await (client.request as any)({method:'eth_accounts',params:[]});return createWalletClient({account:a||accounts[4]||accounts[0],chain:localChain,transport:http(rpc)});}
 async function write(fn:string,args:any[],a?:Address){const d=manifest();if(!d||d.chainId!==31337)throw Error('Local relayer unavailable');const r=await transact(client,await wallet(a),d.contract,fairBatchAbi,fn,args);return {hash:r.transactionHash,gas:String(r.gasUsed)};}
 const read=(fn:string,args:any[]=[])=>client.readContract({address:manifest().contract,abi:fairBatchAbi,functionName:fn as any,args:args as any}) as Promise<any>;
 async function seed(){
  const id=await read('currentRound');if(await read('phase',[id])!==1)return;
  const accounts=await (client.request as any)({method:'eth_accounts',params:[]});const orders=[[true,800,103],[true,600,101],[false,700,97],[false,900,99]] as const;
  for(let i=0;i<orders.length;i++){
   const owner=accounts[i+1];if(!owner)break;if(await read('indexPlus',[id,owner])>0n)continue;
   const [buy,lots,ticks]=orders[i],salt=toHex(randomBytes(32));
   const secret={round:String(id),owner,lots:String(lots),ticks:String(ticks),salt};secrets.push(secret);save();
   const hash=await read('commitmentFor',[id,owner,buy,BigInt(lots),BigInt(ticks),salt]);
   await write('commit',[id,buy,hash,BigInt(lots)*(buy?BigInt(ticks)*100n:10n**16n)],owner);
  }
 }
 async function settle(id:bigint){
  const rows=await read('getOrders',[id]);
  return write('settleWithWitness',[id,...witness(clearingInputs(rows))]);
 }
 async function tick(){if(ticking||!manifest()||manifest().chainId!==31337)return;ticking=true;
  try{await serial(async()=>{await (client.request as any)({method:'evm_mine',params:[]});const id=await read('currentRound');if(id===0n)return;const p=await read('phase',[id]);
   if(p===2){for(const s of secrets.filter(s=>s.round===String(id))){const index=await read('indexPlus',[id,s.owner]);if(index===0n)continue;const o=await read('getOrder',[id,s.owner]);if(!o.revealed){const expected=await read('commitmentFor',[id,s.owner,o.isBuy,BigInt(s.lots),BigInt(s.ticks),s.salt]);if(expected.toLowerCase()!==o.commitment.toLowerCase())continue;await write('revealFor',[id,s.owner,BigInt(s.lots),BigInt(s.ticks),s.salt]);}}}
   if(p===3)await settle(id);
   if(p===3||p===4||p===5){const orders=await read('getOrders',[id]);const owners=orders.filter((o:any)=>!o.claimed).map((o:any)=>o.owner);if(owners.length)await write('claimMany',[id,owners]);}
  });}catch(e){console.error('FairBatch keeper:',(e as Error).message.slice(0,180));}finally{ticking=false;}}
 const timer=setInterval(()=>void tick(),2500);timer.unref();
 return {manifest,async handle(action:string,body:any){return serial(async()=>{
  if(action==='open'){const id=await read('currentRound');if(id>0n){const p=await read('phase',[id]);if(p===1||p===2||p===3)throw Error('当前轮次仍在进行');}const r=await write('openRound',[]);if(body.seed!==false){try{await seed();}catch(e){console.error('FairBatch seed:',(e as Error).message);return {...r,warning:'轮次已开启，对手盘需要重试'};}}return r;}
  if(action==='seed'){await seed();return {ok:true};}
  const id=BigInt(body.round);if(id<=0n)throw Error('Invalid round');
  if(action==='commit'){
   const i=body.intent;
   if(!i||!isAddress(i.owner)||!/^0x[0-9a-f]{64}$/i.test(i.commitment)||typeof i.isBuy!=='boolean'||!/^0x([0-9a-f]{2})+$/i.test(body.signature)||body.signature.length>8194)throw Error('Invalid signed intent');
   const intent={roundId:BigInt(i.roundId),owner:i.owner,isBuy:i.isBuy,commitment:i.commitment,escrow:BigInt(i.escrow),nonce:BigInt(i.nonce),deadline:BigInt(i.deadline)};
   if(intent.roundId!==id)throw Error('Round mismatch');
   return write('commitFor',[intent,body.signature]);
  }
  if(action==='reveal'){if(!isAddress(body.owner)||!/^0x[0-9a-f]{64}$/i.test(body.salt))throw Error('Invalid order credential');return write('revealFor',[id,body.owner,BigInt(body.lots),BigInt(body.ticks),body.salt]);}
  if(action==='settle')return settle(id);
  if(action==='claim'){if(!isAddress(body.owner))throw Error('Invalid owner');return write('claimFor',[id,body.owner]);}
  throw Error('Unknown FairBatch action');
 });}};
}
