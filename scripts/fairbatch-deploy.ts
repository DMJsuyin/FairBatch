import fs from 'node:fs';
import {createPublicClient,createWalletClient,http,encodeDeployData,parseEther,type Address} from 'viem';
import {privateKeyToAccount,generatePrivateKey} from 'viem/accounts';
import {localChain,testnet,transact} from './chain.ts';
import {fairBatchAbi,tokenAbi} from '../src/abi.ts';
const isTestnet=process.argv.includes('--testnet');
if(isTestnet&&!fs.existsSync('.local/fairbatch-testnet-wallet.json')){fs.mkdirSync('.local',{recursive:true});const privateKey=generatePrivateKey();fs.writeFileSync('.local/fairbatch-testnet-wallet.json',JSON.stringify({address:privateKeyToAccount(privateKey).address,privateKey}),{mode:0o600});}
const chain=isTestnet?testnet:localChain;
const rpc=process.env.FAIRBATCH_RPC||(isTestnet?'https://testnet-rpc.monad.xyz':'http://127.0.0.1:8545');
const c=createPublicClient({chain,transport:http(rpc),pollingInterval:300});
const account=isTestnet?privateKeyToAccount(JSON.parse(fs.readFileSync('.local/fairbatch-testnet-wallet.json','utf8')).privateKey):(await (c.request as any)({method:'eth_accounts',params:[]}))[0];
const w=createWalletClient({account,chain,transport:http(rpc)});
const address=typeof account==='string'?account:account.address;
console.log('Deploy wallet',address,'native balance',String(await c.getBalance({address})));
async function deploy(name:string,args:any[]){const a=JSON.parse(fs.readFileSync(`artifacts/${name}.json`,'utf8'));const gas=await c.estimateGas({account,data:encodeDeployData({...a,args})});const hash=await w.deployContract({...a,args,gas:gas*12n/10n});const r=await c.waitForTransactionReceipt({hash});if(r.status!=='success'||!r.contractAddress)throw Error(`${name} deployment failed`);console.log(name,r.contractAddress,hash);return r.contractAddress;}
let base:Address,quote:Address;
if(isTestnet){if(await c.getBalance({address})<parseEther('0.02'))throw Error('Testnet gas not funded yet');base=await deploy('DemoToken',['FairBatch MON','dMON',18]);quote=await deploy('DemoToken',['FairBatch USD','dUSDC',6]);}
else{const d=JSON.parse(fs.readFileSync('public/deployment.json','utf8'));base=d.base;quote=d.quote;}
const contract=await deploy('FairBatch',[base,quote,60n,60n,120n]);
// Bot approvals are prepared before opening a round so the commit window is fully usable.
if(!isTestnet){const accounts=await (c.request as any)({method:'eth_accounts',params:[]});for(const a of accounts.slice(1,5)){const bot=createWalletClient({account:a,chain,transport:http(rpc)});for(const token of [base,quote]){await transact(c,bot,token,tokenAbi,'faucet');await transact(c,bot,token,tokenAbi,'approve',[contract,2n**255n]);}}}
const counterparties:Address[]=isTestnet?[]:(await (c.request as any)({method:'eth_accounts',params:[]})).slice(1,5);
const d={protocolVersion:"0.3",counterparties,chainId:chain.id,network:isTestnet?'Monad Testnet':'Local EVM',rpc:isTestnet?rpc:'/rpc',base,quote,contract,deployBlock:Number(await c.getBlockNumber()),relayer:!isTestnet,createdAt:new Date().toISOString()};
fs.writeFileSync(process.env.FAIRBATCH_MANIFEST||(isTestnet?'public/fairbatch-testnet.json':'public/fairbatch.json'),JSON.stringify(d,null,2));
console.log('FairBatch manifest saved.');
