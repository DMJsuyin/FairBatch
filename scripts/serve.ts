import {fairBatchService} from './fairbatch-service.ts';
import http from 'node:http';import fs from 'node:fs';import path from 'node:path';
import {createPublicClient,createWalletClient,http as transport,isAddress,parseEther,type Address} from 'viem';
import {localChain,transact} from './chain.ts';import {bookAbi} from '../src/abi.ts';import {validateRpc} from './rpc-policy.ts';
const port=Number(process.env.PORT||5187),origin=process.env.PUBLIC_ORIGIN||`http://127.0.0.1:${port}`;
const rpc=process.env.INTERNAL_RPC||'http://127.0.0.1:8547';
const fairbatch=fairBatchService(rpc);
const buckets=new Map<string,{start:number;count:number}>(),funded=new Map<string,number>();let fundQueue=Promise.resolve(),arenaQueue=Promise.resolve(),arenaStep=0;
const client=createPublicClient({chain:localChain,transport:transport(rpc),pollingInterval:250});
const manifest=()=>JSON.parse(fs.readFileSync('public/deployment.json','utf8'));
const rate=(key:string,limit:number)=>{const now=Date.now();let b=buckets.get(key);if(!b||now-b.start>60000){b={start:now,count:0};buckets.set(key,b);}if(++b.count>limit)throw new Error('Too many requests');};
setInterval(()=>{const now=Date.now();for(const [k,v]of buckets)if(now-v.start>120000)buckets.delete(k);for(const [k,v]of funded)if(now-v>3600000)funded.delete(k);},60000).unref();
const server=http.createServer(async(req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','SAMEORIGIN');
 const json=(status:number,data:any)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
 try{
  const url=new URL(req.url||'/',origin);
  if(url.pathname==='/health'){json(200,{status:'ok',mode:'server-demo',chainId:await client.getChainId(),block:String(await client.getBlockNumber())});return;}
  if(url.pathname==='/fairbatch.json'){const d=fairbatch.manifest();json(d?200:404,d||{error:'FairBatch not deployed'});return;}
  if(url.pathname==='/deployment.json'){const d=manifest();json(200,{chainId:31337,network:'Server 78 演示链',rpc:'/rpc',base:d.base,quote:d.quote,book:d.book,deployBlock:d.deployBlock,demoHosted:true});return;}
  if(req.method==='POST'){
   if(req.headers.origin&&req.headers.origin!==origin)throw new Error('Origin denied');
   // CF-Connecting-IP is trusted only behind our configured tunnel; the app binds to the private server address.
   const ip=String(req.headers['cf-connecting-ip']||req.socket.remoteAddress);
   rate(ip,1200);let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>65536)throw new Error('Request too large');}
   const body=JSON.parse(raw),d=manifest();
   if(url.pathname.startsWith('/api/fairbatch/')){rate(`${ip}:fairbatch`,30);json(200,await fairbatch.handle(url.pathname.split('/').at(-1)!,body));return;}
   if(url.pathname==='/rpc'){
    try{validateRpc(body,[d.base,d.quote,d.book,...(fairbatch.manifest()?[fairbatch.manifest().contract]:[])]);if(body.method==='eth_sendRawTransaction')rate(`${ip}:writes`,45);}catch(e){json(200,{jsonrpc:'2.0',id:body?.id??null,error:{code:-32601,message:(e as Error).message}});return;}
    const r=await fetch(rpc,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});json(200,await r.json());return;
   }
   if(url.pathname==='/api/demo/fund'){
    rate(`${ip}:fund`,4);if(!isAddress(body.address))throw new Error('Invalid address');const address=body.address as Address;
    const run=async()=>{if(await client.getBalance({address})>=parseEther('0.005'))return;if(funded.has(address.toLowerCase()))throw new Error('钱包本小时已领过演示 Gas');
     const wallet=createWalletClient({account:d.demoAccount as Address,chain:localChain,transport:transport(rpc)});
     const hash=await wallet.sendTransaction({to:address,value:parseEther('0.02'),gas:21000n});await client.waitForTransactionReceipt({hash});funded.set(address.toLowerCase(),Date.now());};
    const task=fundQueue.then(run);fundQueue=task.catch(()=>{});await task;json(200,{ok:true});return;
   }
   if(url.pathname==='/api/demo/arena'){
    rate(`${ip}:arena`,40);const task=arenaQueue.then(async()=>{const buy=arenaStep++%2===0;const rows=await client.readContract({address:d.book,abi:bookAbi,functionName:'getBook',args:[!buy]});const top=rows[0];if(!top)throw new Error('该方向暂无挂单');
     const wallet=createWalletClient({account:d.arenaAccount,chain:localChain,transport:transport(rpc)});return transact(client,wallet,d.book,bookAbi,'placeOrder',[{isBuy:buy,price:top.price,lots:top.lots<100n?top.lots:100n,postOnly:false,ioc:true,minFill:1n}]);});
    arenaQueue=task.then(()=>{}).catch(()=>{});const receipt=await task;json(200,{hash:receipt.transactionHash,gas:String(receipt.gasUsed)});return;
   }
   if(url.pathname==='/api/intent'){json(503,{error:'线上演示尚未配置模型服务，请使用规则解析。'});return;}
   json(404,{error:'Not found'});return;
  }
  if(req.method!=='GET'&&req.method!=='HEAD'){json(405,{error:'Method not allowed'});return;}
  const root=path.resolve('dist'),relative=decodeURIComponent(url.pathname);let file=path.resolve(root,`.${relative}`);
  if(!file.startsWith(root+path.sep)){if(relative!=='/')throw new Error('Path denied');file=path.join(root,'index.html');}
  if(!fs.existsSync(file)||fs.statSync(file).isDirectory())file=path.join(root,'index.html');
  const type:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png'};
  res.setHeader('Content-Type',type[path.extname(file)]||'application/octet-stream');res.setHeader('Cache-Control',file.includes('/assets/')?'public, max-age=31536000, immutable':'no-cache');
  if(req.method==='HEAD'){res.end();return;}fs.createReadStream(file).pipe(res);
 }catch(e){json(400,{error:(e as Error).message});}
});server.requestTimeout=20000;server.headersTimeout=10000;server.listen(port,process.env.HOST||'127.0.0.1',()=>console.log(`Demo server listening on ${port}`));
