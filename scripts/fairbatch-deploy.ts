import fs from 'node:fs';
import path from 'node:path';
import {createPublicClient,createWalletClient,http,encodeDeployData,parseEther,keccak256,type Address} from 'viem';
import {privateKeyToAccount,generatePrivateKey} from 'viem/accounts';
import {localChain,testnet,transact} from './chain.ts';
import {tokenAbi} from '../src/abi.ts';
import {ensureBots,readKey} from './fairbatch-runtime.ts';
const isTestnet=process.argv.includes('--testnet');
const signerFile=process.env.FAIRBATCH_SIGNER_FILE||'.local/fairbatch-testnet-wallet.json';
if(isTestnet&&!fs.existsSync(signerFile)){fs.mkdirSync(path.dirname(signerFile),{recursive:true});const privateKey=generatePrivateKey();fs.writeFileSync(signerFile,JSON.stringify({address:privateKeyToAccount(privateKey).address,privateKey}),{mode:0o600,flag:'wx'});}
const chain=isTestnet?testnet:localChain;
const rpc=process.env.FAIRBATCH_RPC||(isTestnet?'https://testnet-rpc.monad.xyz':'http://127.0.0.1:8545');
const c=createPublicClient({chain,transport:http(rpc,{timeout:20_000,retryCount:1}),pollingInterval:500});
if(await c.getChainId()!==chain.id)throw Error('Deployment RPC chain mismatch');
const account=isTestnet?readKey(signerFile):(await (c.request as any)({method:'eth_accounts',params:[]}) as Address[])[0];
const w=createWalletClient({account,chain,transport:http(rpc,{retryCount:0})});
const address=typeof account==='string'?account:account.address;
console.log('Deploy wallet',address,'native balance',String(await c.getBalance({address})));
// Reuse successful deployments after an interrupted RPC/receipt wait, without spending twice.
const checkpointPath=process.env.FAIRBATCH_DEPLOY_STATE||`.local/fairbatch-deploy-${chain.id}.json`;
const state:any=isTestnet&&fs.existsSync(checkpointPath)?JSON.parse(fs.readFileSync(checkpointPath,'utf8')):{chainId:chain.id,deployer:address,contracts:{}};
if(state.chainId!==chain.id||state.deployer.toLowerCase()!==address.toLowerCase())throw Error('Deployment checkpoint mismatch');
const save=()=>{if(isTestnet){fs.mkdirSync(path.dirname(checkpointPath),{recursive:true});fs.writeFileSync(checkpointPath,JSON.stringify(state,null,2));}};
async function deploy(name:string,args:any[],slot=name){
 const a=JSON.parse(fs.readFileSync(`artifacts/${name}.json`,'utf8'));
 const data=encodeDeployData({...a,args});const fingerprint=keccak256(data);
 let saved=state.contracts[slot];
 if(saved&&saved.fingerprint!==fingerprint)throw Error(`${slot} deployment arguments changed; use a new checkpoint explicitly`);
 if(saved?.address){if((await c.getCode({address:saved.address}))==='0x')throw Error('Checkpoint contract missing');return saved.address as Address;}
 if(!saved){const gas=await c.estimateGas({account,data});const hash=await w.deployContract({...a,args,gas:gas*12n/10n});saved=state.contracts[slot]={hash,fingerprint};save();}
 const r=await c.waitForTransactionReceipt({hash:saved.hash,timeout:120_000});
 if(r.status!=='success'||!r.contractAddress)throw Error(`${name} deployment failed`);
 saved.address=r.contractAddress;saved.block=String(r.blockNumber);save();
 console.log(name,r.contractAddress,r.transactionHash);return r.contractAddress;
}
let base:Address,quote:Address;
if(isTestnet){
 if(await c.getBalance({address})<parseEther('0.02'))throw Error('Testnet gas not funded yet');
 base=await deploy('DemoToken',['FairBatch MON','dMON',18],'base');quote=await deploy('DemoToken',['FairBatch USD','dUSDC',6],'quote');
}else{const d=JSON.parse(fs.readFileSync('public/deployment.json','utf8'));base=d.base;quote=d.quote;}
const contract=await deploy('FairBatch',[base,quote,60n,60n,120n]);
const botAccounts=isTestnet?ensureBots(process.env.FAIRBATCH_BOTS_FILE||'.local/fairbatch-testnet-bots.json'):(await (c.request as any)({method:'eth_accounts',params:[]}) as Address[]).slice(1,5);
// Gas, faucet assets and allowances must be ready before starting the timed round.
for(const account of botAccounts){
 const owner=typeof account==='string'?account:account.address;
 if(isTestnet){
  const target=(await c.getGasPrice())*500_000n,balance=await c.getBalance({address:owner});
  if(balance<target){const hash=await w.sendTransaction({account:w.account,to:owner,value:target-balance,gas:21000n,type:'legacy',gasPrice:await c.getGasPrice()});const r=await c.waitForTransactionReceipt({hash,confirmations:5});if(r.status!=='success')throw Error('Bot gas funding failed');}
 }
 const bot=createWalletClient({account,chain,transport:http(rpc,{retryCount:0})});
 for(const token of [base,quote]){
  if(await c.readContract({address:token,abi:tokenAbi,functionName:'balanceOf',args:[owner]})===0n)await transact(c,bot,token,tokenAbi,'faucet');
  if(await c.readContract({address:token,abi:tokenAbi,functionName:'allowance',args:[owner,contract]})===0n)await transact(c,bot,token,tokenAbi,'approve',[contract,2n**255n]);
 }
 console.log('Counterparty ready',owner);
}
const counterparties=botAccounts.map(a=>typeof a==='string'?a:a.address);
const d={protocolVersion:'0.3',counterparties,chainId:chain.id,network:isTestnet?'Monad Testnet':'Local EVM',rpc:isTestnet?rpc:'/rpc',base,quote,contract,deployBlock:isTestnet?Number(state.contracts.FairBatch.block):Number(await c.getBlockNumber()),relayer:true,createdAt:new Date().toISOString()};
fs.writeFileSync(process.env.FAIRBATCH_MANIFEST||(isTestnet?'public/fairbatch-testnet.json':'public/fairbatch.json'),JSON.stringify(d,null,2));
console.log('FairBatch manifest saved.',d);
