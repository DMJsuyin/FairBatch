import {createPublicClient,createWalletClient,http,custom,defineChain,parseUnits,type Address,type Hash} from 'viem';
import {bookAbi,tokenAbi} from './abi';
import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
import type {Fill} from './analytics';
export type Deployment={chainId:31337|10143;rpc:string;book:Address;base:Address;quote:Address;deployBlock:number;network:string;demoHosted?:boolean;demoAccount?:Address;arenaAccount?:Address;seedAccount?:Address};
export type Entry={id:bigint;owner:Address;isBuy:boolean;price:bigint;lots:bigint};
export type Snapshot={block:bigint;bids:readonly Entry[];asks:readonly Entry[];fills:Fill[];baseFree:bigint;quoteFree:bigint;baseWallet:bigint;quoteWallet:bigint;partialHistory:boolean};
export const zeroSnapshot:Snapshot={block:0n,bids:[],asks:[],fills:[],baseFree:0n,quoteFree:0n,baseWallet:0n,quoteWallet:0n,partialHistory:false};
export function createMarket(d:Deployment) {
 if(![31337,10143].includes(d.chainId))throw new Error('只支持本地链与 Monad 测试网');
 if(d.demoHosted&&d.rpc!=='/rpc')throw new Error('Hosted demo requires same-origin RPC');
 if(d.demoHosted)d={...d,rpc:new URL('/rpc',location.origin).href};
 if(d.chainId===31337&&!d.demoHosted&&!['127.0.0.1','localhost'].includes(new URL(d.rpc).hostname))throw new Error('本地钱包仅允许 loopback RPC');
 const chain=defineChain({id:d.chainId,name:d.network,nativeCurrency:{name:d.chainId===31337?'Test ETH':'MON',symbol:d.chainId===31337?'ETH':'MON',decimals:18},rpcUrls:{default:{http:[d.rpc]}},testnet:true});
 const client=createPublicClient({chain,transport:http(d.rpc,{batch:{batchSize:20,wait:0}}),pollingInterval:600});
 let cursor=BigInt(d.deployBlock),partialHistory=false;
 const fills=new Map<string,Fill>(),times=new Map<string,number>();
 const read=(functionName:'getBook'|'baseFree'|'quoteFree',args:any[],blockNumber?:bigint)=>client.readContract({address:d.book,abi:bookAbi,functionName,args:args as any,blockNumber});
 let synced=false;
  async function snapshot(account?:Address):Promise<Snapshot> {
   const block=await client.getBlockNumber({cacheTime:0});
   if(!synced){
    if(await client.getChainId()!==d.chainId)throw new Error('RPC 网络与部署信息不一致');
    if(block<BigInt(d.deployBlock))throw new Error('链已重置，请重启本地环境并刷新页面');
    if(!await client.getBytecode({address:d.book,blockNumber:block}))throw new Error('当前地址没有合约，请重新部署');
    synced=true;
   }else if(block<BigInt(d.deployBlock))throw new Error('链已重置，请重启本地环境并刷新页面');
   const [bids,asks,baseFree,quoteFree,baseWallet,quoteWallet]=await Promise.all([
    read('getBook',[true],block),read('getBook',[false],block),
    account?read('baseFree',[account],block):0n,account?read('quoteFree',[account],block):0n,
    account?client.readContract({address:d.base,abi:tokenAbi,functionName:'balanceOf',args:[account],blockNumber:block}):0n,
    account?client.readContract({address:d.quote,abi:tokenAbi,functionName:'balanceOf',args:[account],blockNumber:block}):0n
   ]);
   const event=bookAbi.find(e=>e.type==='event'&&e.name==='Trade')!;
   let from=cursor>BigInt(d.deployBlock)+2n?cursor-2n:BigInt(d.deployBlock);
   if(block-from>5000n){from=block-5000n;partialHistory=true;}
   // Re-read the last two blocks and replace overlapping records for small reorgs.
   for(const [key,fill] of fills)if(fill.block>=from)fills.delete(key);
   const fresh:any[]=[];
   while(from<=block){
     const to=from+4999n<block?from+4999n:block;
     fresh.push(...await client.getLogs({address:d.book,event:event as any,fromBlock:from,toBlock:to}));
     from=to+1n;
   }
   await Promise.all([...new Set(fresh.map(log=>log.blockHash).filter((hash:string)=>hash&&!times.has(hash)))].map(async hash=>{times.set(hash,Number((await client.getBlock({blockHash:hash})).timestamp));}));
   for(const log of fresh){
     const args=(log as any).args;
     fills.set(`${log.transactionHash}:${log.logIndex}`,{maker:args.maker,taker:args.taker,takerBuy:args.takerBuy,price:args.price,lots:args.lots,hash:log.transactionHash!,block:log.blockNumber!,time:times.get(log.blockHash)!,index:log.logIndex!});
   }
   cursor=block;
   return {block,bids:bids as Entry[],asks:asks as Entry[],baseFree:baseFree as bigint,quoteFree:quoteFree as bigint,baseWallet:baseWallet as bigint,quoteWallet:quoteWallet as bigint,fills:[...fills.values()].sort((a,b)=>a.block===b.block?a.index-b.index:a.block<b.block?-1:1),partialHistory};
 }
 function localWallet(address:Address){if(d.chainId!==31337||d.demoHosted)throw new Error('测试网需使用钱包签名');return createWalletClient({account:address,chain,transport:http(d.rpc)});}
 function injectedWallet(provider:any,address:Address){return createWalletClient({account:address,chain,transport:custom(provider)});}
 async function write(wallet:any,address:Address,abi:any,functionName:string,args:any[],onHash:(hash:Hash)=>void){
   if(await wallet.getChainId()!==d.chainId)throw new Error(`请切换钱包到 ${d.network}`);
   const {request}=await client.simulateContract({account:wallet.account,address,abi,functionName,args});
   const gas=await client.estimateContractGas({account:wallet.account,address,abi,functionName,args});
   const gasLimit=d.chainId===10143?gas*110n/100n:gas*120n/100n;
   const hash=await wallet.writeContract({...request,gas:gasLimit});onHash(hash);
   const receipt=await client.waitForTransactionReceipt({hash,timeout:120000});
   if(receipt.status!=='success')throw new Error('交易已上链但执行回滚');
   return receipt;
 }
 function hostedWallet(){if(!d.demoHosted||d.chainId!==31337)throw new Error('Not a hosted demo');const keyName=`clob-demo:${d.book}`;let key=sessionStorage.getItem(keyName) as `0x${string}`|null;if(!key){key=generatePrivateKey();sessionStorage.setItem(keyName,key);}const account=privateKeyToAccount(key);return createWalletClient({account,chain,transport:http(d.rpc)});}
 return {d,chain,client,snapshot,localWallet,hostedWallet,injectedWallet,write};
}
export type Market=ReturnType<typeof createMarket>;
export const tokenAmount=(v:string,base:boolean)=>parseUnits(v,base?18:6);
export function errorMessage(error:unknown):string {
 const e=error as any;const s=String(e?.shortMessage||e?.message||error);
 for(const [key,msg] of Object.entries({InsufficientBalance:'可用余额不足，请先充值或撤回其他挂单。',WouldCross:'价格已变化，Post-only 网格会立即吃单。请重新生成并审核。',SelfTrade:'订单会与自己的挂单成交，请先撤销对应挂单。',MinFill:'可成交数量低于最低要求，整笔交易已回滚。',NotOwner:'只能撤销当前钱包自己的有效订单。',BookFull:'订单簿已达到 128 笔容量。',MatchLimit:'本次撮合超过 32 笔上限，请缩小订单。',UserRejectedRequestError:'已取消钱包签名。'}))if(s.includes(key))return msg;
 return s.length>220?s.slice(0,220)+'…':s;
}
