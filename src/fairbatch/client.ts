import {createPublicClient,createWalletClient,http,custom,defineChain,encodeFunctionData,encodeAbiParameters,keccak256,stringToHex,type Address,type Hex} from 'viem';
import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
import {fairBatchAbi,tokenAbi} from '../abi';
import {intentTypes,intentDomain} from './protocol';
export type Manifest={chainId:number;network:string;rpc:string;base:Address;quote:Address;contract:Address;relayer:boolean;deployBlock:number;counterparties?:Address[]};
export type Secret={chainId:number;contract:Address;round:string;owner:Address;isBuy:boolean;lots:string;ticks:string;salt:Hex;hash?:Hex};
export type Order={owner:Address;isBuy:boolean;revealed:boolean;claimed:boolean;lots:bigint;limitTicks:bigint;commitment:Hex;escrow:bigint;fillLots:bigint;baseDue:bigint;quoteDue:bigint};
export type Snapshot={id:bigint;latest:bigint;phase:number;commitEnd:bigint;revealEnd:bigint;settleEnd:bigint;count:bigint;revealed:bigint;volume:bigint;price:bigint;low:bigint;high:bigint;orders:Order[];block:bigint;time:bigint};
export const empty:Snapshot={id:0n,latest:0n,phase:0,commitEnd:0n,revealEnd:0n,settleEnd:0n,count:0n,revealed:0n,volume:0n,price:0n,low:0n,high:0n,orders:[],block:0n,time:0n};
export const short=(s:string)=>s.slice(0,6)+'…'+s.slice(-4);
export const fmt=(v:number,d=2)=>v.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
export const err=(e:any)=>e?.shortMessage||e?.message||String(e);
const prefix='fairbatch:credential:';
export const secretKey=(s:Pick<Secret,'chainId'|'contract'|'round'|'owner'>)=>prefix+[s.chainId,s.contract.toLowerCase(),s.round,s.owner.toLowerCase()].join(':');
export const saveSecret=(s:Secret)=>localStorage.setItem(secretKey(s),JSON.stringify(s));
export const getSecret=(d:Manifest,id:bigint,owner:Address)=>{try{return JSON.parse(localStorage.getItem(secretKey({...d,round:String(id),owner}))||'null') as Secret|null;}catch{return null;}};
export function commitment(s:Secret){return keccak256(encodeAbiParameters([{type:'bytes32'},{type:'uint256'},{type:'address'},{type:'uint256'},{type:'address'},{type:'bool'},{type:'uint256'},{type:'uint256'},{type:'bytes32'}],[keccak256(stringToHex('FairBatch:v0.3')),BigInt(s.chainId),s.contract,BigInt(s.round),s.owner,s.isBuy,BigInt(s.lots),BigInt(s.ticks),s.salt]));}
export function createBatch(d:Manifest){
 const chain=defineChain({id:d.chainId,name:d.network,nativeCurrency:{name:'MON',symbol:'MON',decimals:18},rpcUrls:{default:{http:[new URL(d.rpc,location.href).href]}},testnet:true});
 const c=createPublicClient({chain,transport:http(new URL(d.rpc,location.href).href,{retryCount:1}),pollingInterval:500});
 const read=(fn:string,args:any[]=[],blockNumber?:bigint)=>c.readContract({address:d.contract,abi:fairBatchAbi,functionName:fn as any,args:args as any,blockNumber}) as Promise<any>;
 async function write(w:any,fn:string,args:any[]=[],address=d.contract,abi:any=fairBatchAbi){const request={account:w.account,address,abi,functionName:fn,args};const [gas,nonce,gasPrice]=await Promise.all([c.estimateContractGas(request),c.getTransactionCount({address:w.account.address,blockTag:'pending'}),c.getGasPrice()]);const hash=w.account.type==='local'?await c.sendRawTransaction({serializedTransaction:await w.account.signTransaction({chainId:d.chainId,to:address,data:encodeFunctionData({abi,functionName:fn,args}),gas:gas*12n/10n,nonce,gasPrice,type:'legacy',value:0n})}):await w.writeContract({...request,gas:gas*12n/10n});const receipt=await c.waitForTransactionReceipt({hash});if(receipt.status!=='success')throw Error('交易未执行，请重试');return hash;}
 async function api(action:string,body:any){const r=await fetch(`/api/fairbatch/${action}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Object.assign(Error(data.error||'服务暂不可用'),{serverRejected:r.status>=400&&r.status<500});return data.hash as Hex;}
 async function snapshot(selected?:bigint):Promise<Snapshot>{const block=await c.getBlock();const latest=await read('currentRound',[],block.number);const id=selected||latest;if(id===0n)return {...empty,block:block.number,time:block.timestamp};const[r,phase,orders]=await Promise.all([read('rounds',[id],block.number),read('phase',[id],block.number),read('getOrders',[id],block.number)]);return {id,latest,phase,orders,commitEnd:r[0],revealEnd:r[1],settleEnd:r[2],count:r[3],revealed:r[4],volume:r[6],price:r[7],low:r[8],high:r[9],block:block.number,time:block.timestamp};}
 function localWallet(){const keyName=`fairbatch:wallet:${d.chainId}`;let key=sessionStorage.getItem(keyName) as Hex|null;if(!key){key=generatePrivateKey();sessionStorage.setItem(keyName,key);}return createWalletClient({account:privateKeyToAccount(key),chain,transport:http(new URL(d.rpc,location.href).href)});}
 async function connect(){const provider=(window as any).ethereum;if(!provider)throw Error('未检测到钱包扩展，请使用测试钱包');const [address]=await provider.request({method:'eth_requestAccounts'});try{await provider.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x'+d.chainId.toString(16)}]});}catch(e:any){if(e.code!==4902)throw e;await provider.request({method:'wallet_addEthereumChain',params:[{chainId:'0x'+d.chainId.toString(16),chainName:d.network,nativeCurrency:chain.nativeCurrency,rpcUrls:chain.rpcUrls.default.http}]});}return createWalletClient({account:address,chain,transport:custom(provider)});}
 async function fund(w:any){if(d.chainId===31337){const r=await fetch('/api/demo/fund',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({address:w.account.address})});if(!r.ok)throw Error((await r.json()).error);}
  for(const address of [d.base,d.quote]){const balance=await c.readContract({address,abi:tokenAbi,functionName:'balanceOf',args:[w.account.address]});if(balance===0n)await write(w,'faucet',[],address,tokenAbi);const allowance=await c.readContract({address,abi:tokenAbi,functionName:'allowance',args:[w.account.address,d.contract]});if(allowance===0n)await write(w,'approve',[d.contract,2n**255n],address,tokenAbi);}}
 async function commitOrder(w:any,s:Secret,escrow:bigint){
  const hash=commitment(s);
  if(!d.relayer)return write(w,'commit',[BigInt(s.round),s.isBuy,hash,escrow]);
  const [nonce,round]=await Promise.all([read('nonces',[s.owner]),read('rounds',[BigInt(s.round)])]);
  const intent={roundId:BigInt(s.round),owner:s.owner,isBuy:s.isBuy,commitment:hash,escrow,nonce,deadline:round[0]-1n};
  const signature=await w.signTypedData({account:w.account,domain:intentDomain(d.chainId,d.contract),types:intentTypes,primaryType:'CommitIntent',message:intent});
  try{return await api('commit',{round:s.round,intent:JSON.parse(JSON.stringify(intent,(_,v)=>typeof v==='bigint'?String(v):v)),signature});}
  catch(e){
   // A timed-out relay may already have mined. Check before attempting the same order.
   if(await read('indexPlus',[intent.roundId,s.owner])>0n)return;
   if((e as any).serverRejected)throw e;
   return write(w,'commitFor',[intent,signature]);
  }
 }
 return {d,c,read,write,api,snapshot,localWallet,connect,fund,commitOrder};
}
export type Batch=ReturnType<typeof createBatch>;
