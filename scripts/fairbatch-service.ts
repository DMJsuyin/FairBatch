import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {toHex,isAddress,parseEther,encodeAbiParameters,keccak256,stringToHex,type Address,type Hex} from 'viem';
import {transact} from './chain.ts';
import {batchRuntime,type BatchManifest} from './fairbatch-runtime.ts';
import {fairBatchAbi} from '../src/abi.ts';
import {witness,clearingInputs,intentDomain,intentTypes} from '../src/fairbatch/protocol.ts';

type Secret={chainId:number;contract:Address;round:string;owner:Address;lots:string;ticks:string;salt:Hex};
type State={secrets:Secret[];rounds:string[];grants:Record<string,number>;day:string;spent:string;lastRelayerTx?:Hex};
type Options={env?:NodeJS.ProcessEnv;manifestPath?:string;statePath?:string;intervalMs?:number};
export class BatchServiceError extends Error {constructor(public status:number,message:string){super(message);}}
export function fairBatchService(localRpc:string,options:Options={}){
 const env=options.env||process.env;
 const manifestPath=options.manifestPath||env.FAIRBATCH_MANIFEST||'public/fairbatch.json';
 const manifest=():BatchManifest|null=>fs.existsSync(manifestPath)?JSON.parse(fs.readFileSync(manifestPath,'utf8')):null;
 let runtime:ReturnType<typeof batchRuntime>|undefined,domain='';
 function context(){
  const d=manifest();if(!d)throw new BatchServiceError(503,'FairBatch 尚未部署');
  const key=`${d.chainId}:${d.contract.toLowerCase()}`;
  if(!runtime||key!==domain){
   try{runtime=batchRuntime(d,env.FAIRBATCH_RPC||(d.chainId===31337?localRpc:d.rpc),env);domain=key;}
   catch{throw new BatchServiceError(503,'代发服务尚未就绪，可使用钱包直接提交');}
  }
  return {d,...runtime};
 }
 const statePath=options.statePath||env.FAIRBATCH_STATE_FILE||'.local/fairbatch-service.json';
 let state:State={secrets:[],rounds:[],grants:{},day:'',spent:'0'};
 if(fs.existsSync(statePath))state=JSON.parse(fs.readFileSync(statePath,'utf8'));
 else if(manifest()?.chainId===31337&&fs.existsSync('.local/fairbatch-bots.json')){
  const d=manifest()!;state.secrets=JSON.parse(fs.readFileSync('.local/fairbatch-bots.json','utf8')).map((s:Secret)=>({...s,chainId:d.chainId,contract:d.contract}));
 }
 function save(){fs.mkdirSync(path.dirname(statePath),{recursive:true});const tmp=`${statePath}.tmp`;fs.writeFileSync(tmp,JSON.stringify(state),{mode:0o600});fs.renameSync(tmp,statePath);}
 let queue:Promise<unknown>=Promise.resolve(),ticking=false,lastError='';
 const serial=<T>(fn:()=>Promise<T>)=>{const next=queue.then(fn);queue=next.catch(()=>{});return next;};
 const track=(id:bigint)=>{const key=`${context().d.chainId}:${context().d.contract.toLowerCase()}:${id}`;if(!state.rounds.includes(key)){state.rounds.push(key);save();}};
 const read=async(fn:string,args:any[]=[])=>{const {d,client,check}=context();await check();return client.readContract({address:d.contract,abi:fairBatchAbi,functionName:fn as any,args:args as any}) as Promise<any>;};
 async function write(fn:string,args:any[],owner?:Address){const {d,client,wallet}=context();const r=await transact(client,await wallet(owner),d.contract,fairBatchAbi,fn,args);if(d.chainId===10143&&!owner){state.lastRelayerTx=r.transactionHash;save();}return {hash:r.transactionHash,gas:String(r.gasUsed)};}
 async function seed(onlyIndex?:number){
  const {d}=context();const id=await read('currentRound');if(await read('phase',[id])!==1)return;
  track(id);
  const existing=new Set((await read('getOrders',[id])).map((o:any)=>o.owner.toLowerCase()));
  const orders=[[true,800,103],[true,600,101],[false,700,97],[false,900,99]] as const;
  for(const [i,owner] of (d.counterparties||[]).slice(0,4).entries()){
   if(onlyIndex!==undefined&&i!==onlyIndex)continue;
   if(existing.has(owner.toLowerCase()))continue;
   const [buy,lots,ticks]=orders[i];
   try{
   // Persist the preimage before broadcasting. A receipt timeout must never lose a reveal.
   let secret=state.secrets.find(s=>s.chainId===d.chainId&&s.contract.toLowerCase()===d.contract.toLowerCase()&&s.round===String(id)&&s.owner.toLowerCase()===owner.toLowerCase());
   if(!secret){secret={chainId:d.chainId,contract:d.contract,round:String(id),owner,lots:String(lots),ticks:String(ticks),salt:toHex(randomBytes(32))};state.secrets.push(secret);save();}
   const hash=keccak256(encodeAbiParameters([{type:'bytes32'},{type:'uint256'},{type:'address'},{type:'uint256'},{type:'address'},{type:'bool'},{type:'uint256'},{type:'uint256'},{type:'bytes32'}],[keccak256(stringToHex('FairBatch:v0.3')),BigInt(d.chainId),d.contract,id,owner,buy,BigInt(lots),BigInt(ticks),secret.salt]));
   const escrow=BigInt(lots)*(buy?BigInt(ticks)*100n:10n**16n);
   if(d.chainId===10143){
    const bot=await context().wallet(owner),[round,nonce,block]=await Promise.all([read('rounds',[id]),read('nonces',[owner]),context().client.getBlock()]);
    const deadline=round[0]-1n;
    if(block.timestamp>=deadline){lastError='对手盘播种赶不上提交窗口';continue;}
    const intent={roundId:id,owner,isBuy:buy,commitment:hash,escrow,nonce,deadline};
    const signature=await bot.signTypedData({account:bot.account,domain:intentDomain(d.chainId,d.contract),types:intentTypes,primaryType:'CommitIntent',message:intent});
    await write('commitFor',[intent,signature]);
   }else await write('commit',[id,buy,hash,escrow],owner);
   }catch(e){lastError=(e as Error).message.slice(0,180);console.error('FairBatch seed:',lastError);}
  }
 }
 async function seedWithoutBlockingUsers(){
  // Release the signer queue after each bot so a user's signed order can interleave.
  for(let i=0;i<4;i++)await serial(()=>seed(i));
 }

 async function settle(id:bigint){return write('settleWithWitness',[id,...witness(clearingInputs(await read('getOrders',[id])))]);}
 async function processRound(id:bigint){
  const {d}=context();let p=await read('phase',[id]);
  if(p===1&&id===await read('currentRound'))await seed();
  if(p===2){
   const orders=await read('getOrders',[id]);
   for(const s of state.secrets.filter(s=>s.chainId===d.chainId&&s.contract.toLowerCase()===d.contract.toLowerCase()&&s.round===String(id))){
    const o=orders.find((x:any)=>x.owner.toLowerCase()===s.owner.toLowerCase());
    if(!o||o.revealed)continue;
    const expected=keccak256(encodeAbiParameters([{type:'bytes32'},{type:'uint256'},{type:'address'},{type:'uint256'},{type:'address'},{type:'bool'},{type:'uint256'},{type:'uint256'},{type:'bytes32'}],[keccak256(stringToHex('FairBatch:v0.3')),BigInt(d.chainId),d.contract,id,s.owner,o.isBuy,BigInt(s.lots),BigInt(s.ticks),s.salt]));
    if(expected.toLowerCase()===o.commitment.toLowerCase())await write('revealFor',[id,s.owner,BigInt(s.lots),BigInt(s.ticks),s.salt]);
   }
  }
  p=await read('phase',[id]);
  if(p===3){await settle(id);p=await read('phase',[id]);}
  if(p===4||p===5){
   const orders=await read('getOrders',[id]);const owners=orders.filter((o:any)=>!o.claimed).map((o:any)=>o.owner);
   if(owners.length)await write('claimMany',[id,owners]);
   const key=`${d.chainId}:${d.contract.toLowerCase()}:${id}`;
   state.rounds=state.rounds.filter(x=>x!==key);state.secrets=state.secrets.filter(s=>!(s.chainId===d.chainId&&s.contract.toLowerCase()===d.contract.toLowerCase()&&s.round===String(id)));save();
  }
 }
 async function tick(){if(ticking||!manifest())return;ticking=true;
  try{await serial(async()=>{
   const {client,d,check}=context();await check();
   if(d.chainId===31337)await (client.request as any)({method:'evm_mine',params:[]});
   const id=await read('currentRound');if(id===0n)return;
   const prefix=`${d.chainId}:${d.contract.toLowerCase()}:`;
   const ids=[...new Set([String(id),...state.rounds.filter(s=>s.startsWith(prefix)).map(s=>s.slice(prefix.length))])];
   for(const x of ids)await processRound(BigInt(x));lastError='';
  });}catch(e){lastError=(e as Error).message.slice(0,180);console.error('FairBatch keeper:',lastError);}finally{ticking=false;}
 }
 const timer=options.intervalMs===0?undefined:setInterval(()=>void tick(),options.intervalMs||2500);timer?.unref();
 async function fund(owner:Address){
  const {d,client,wallet}=context();
  if(d.chainId!==10143)throw new BatchServiceError(400,'当前网络使用本地 Gas 领取入口');
  const balance=await client.getBalance({address:owner});
  const gasPrice=await client.getGasPrice();
  const target=gasPrice*360_000n; // Two faucets + two approvals, including gas-limit headroom.
  if(target>parseEther('0.04'))throw new BatchServiceError(503,'当前 Gas 较高，请使用官方水龙头补充 MON');
  if(balance>=target)return {ok:true};
  const day=new Date().toISOString().slice(0,10);if(state.day!==day){state.day=day;state.spent='0';state.grants={};}
  if(state.grants[owner.toLowerCase()]||BigInt(state.spent)+target>parseEther('0.3'))throw new BatchServiceError(429,'本轮 Gas 赞助额度已用完，可从 Monad 水龙头补充 MON');
  const payer=await wallet();
  if(await client.getBalance({address:payer.account.address})<target+parseEther('0.08'))throw new BatchServiceError(503,'Gas 赞助暂不可用，请从 Monad 水龙头补充 MON');
  const value=target-balance;
  // Monad value transfers require the previous sender transaction to leave the inflight window.
  if(state.lastRelayerTx)await client.waitForTransactionReceipt({hash:state.lastRelayerTx,confirmations:5});
  // Reserve the allowance before broadcast; retries cannot duplicate grants after a restart.
  state.grants[owner.toLowerCase()]=Date.now();state.spent=String(BigInt(state.spent)+value);save();
  const hash=await payer.sendTransaction({account:payer.account,to:owner,value,gas:21000n,type:'legacy',gasPrice});
  state.lastRelayerTx=hash as Hex;save();
  const receipt=await client.waitForTransactionReceipt({hash,confirmations:5});if(receipt.status!=='success')throw new BatchServiceError(503,'Gas 赞助交易未成功');
  return {ok:true,hash};
 }
 return {manifest,tick,close:()=>timer&&clearInterval(timer),status:()=>({chainId:manifest()?.chainId,keeperError:lastError||null}),async handle(action:string,body:any){return serial(async()=>{
  const {d}=context();
  if(body?.chainId!==undefined&&Number(body.chainId)!==d.chainId)throw new BatchServiceError(400,'网络已变更，请刷新页面');
  if(body?.contract&&body.contract.toLowerCase()!==d.contract.toLowerCase())throw new BatchServiceError(400,'市场已变更，请刷新页面');
  if(action==='fund'){if(!isAddress(body.address))throw new BatchServiceError(400,'Invalid address');return fund(body.address);}
  if(action==='open'){
   const id=await read('currentRound');if(id>0n&&[1,2,3].includes(await read('phase',[id])))throw new BatchServiceError(400,'当前轮次仍在进行');
   const r=await write('openRound',[]);track(await read('currentRound'));
   // Keep the HTTP response below RPC/proxy timeouts; commitments continue through the same queue.
   if(body.seed!==false)void seedWithoutBlockingUsers().catch(e=>{lastError=(e as Error).message.slice(0,180);console.error('FairBatch seed:',lastError);});
   return r;
  }
  if(action==='seed'){await seed();return {ok:true};}
  const id=BigInt(body.round);if(id<=0n)throw new BatchServiceError(400,'Invalid round');
  if(action==='commit'){
   const i=body.intent;
   if(!i||!isAddress(i.owner)||!/^0x[0-9a-f]{64}$/i.test(i.commitment)||typeof i.isBuy!=='boolean'||!/^0x([0-9a-f]{2})+$/i.test(body.signature)||body.signature.length>8194)throw new BatchServiceError(400,'Invalid signed intent');
   const intent={roundId:BigInt(i.roundId),owner:i.owner,isBuy:i.isBuy,commitment:i.commitment,escrow:BigInt(i.escrow),nonce:BigInt(i.nonce),deadline:BigInt(i.deadline)};
   if(intent.roundId!==id)throw new BatchServiceError(400,'Round mismatch');track(id);
   return write('commitFor',[intent,body.signature]);
  }
  if(action==='reveal'){if(!isAddress(body.owner)||!/^0x[0-9a-f]{64}$/i.test(body.salt))throw new BatchServiceError(400,'Invalid order credential');track(id);return write('revealFor',[id,body.owner,BigInt(body.lots),BigInt(body.ticks),body.salt]);}
  if(action==='settle')return settle(id);
  if(action==='claim'){if(!isAddress(body.owner))throw new BatchServiceError(400,'Invalid owner');return write('claimFor',[id,body.owner]);}
  throw new BatchServiceError(400,'Unknown FairBatch action');
 });}};
}
