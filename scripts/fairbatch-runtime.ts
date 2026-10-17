import fs from 'node:fs';
import path from 'node:path';
import {createPublicClient, createWalletClient, http, type Address, type Hex} from 'viem';
import {generatePrivateKey, privateKeyToAccount} from 'viem/accounts';
import {localChain, testnet} from './chain.ts';

export type BatchManifest = {protocolVersion?:string;chainId:number;network:string;rpc:string;base:Address;quote:Address;contract:Address;deployBlock:number;relayer:boolean;counterparties?:Address[]};
export function readKey(file:string) {
  const value=JSON.parse(fs.readFileSync(file,'utf8'));
  return privateKeyToAccount(value.privateKey as Hex);
}
export function ensureBots(file:string) {
  if(!fs.existsSync(file)){
    fs.mkdirSync(path.dirname(file),{recursive:true});
    const bots=Array.from({length:4},()=>{const privateKey=generatePrivateKey();return {address:privateKeyToAccount(privateKey).address,privateKey};});
    fs.writeFileSync(file,JSON.stringify(bots),{mode:0o600,flag:'wx'});
  }
  return readBots(file);
}
export function readBots(file:string) {
  return (JSON.parse(fs.readFileSync(file,'utf8')) as {privateKey:Hex}[]).map(b=>privateKeyToAccount(b.privateKey));
}
export function batchRuntime(d:BatchManifest,rpc:string,env:NodeJS.ProcessEnv=process.env) {
  if(d.chainId!==31337&&d.chainId!==10143)throw Error('Unsupported FairBatch chain');
  const chain=d.chainId===10143?testnet:localChain;
  const client=createPublicClient({chain,transport:http(rpc,{timeout:15_000,retryCount:1,batch:true}),pollingInterval:500});
  const signer=d.chainId===10143?readKey(env.FAIRBATCH_SIGNER_FILE||'.local/fairbatch-testnet-wallet.json'):undefined;
  const bots=d.chainId===10143?readBots(env.FAIRBATCH_BOTS_FILE||'.local/fairbatch-testnet-bots.json'):[];
  let checked=false;
  async function check(){if(!checked){if(await client.getChainId()!==d.chainId)throw Error('FairBatch RPC chain mismatch');checked=true;}}
  async function wallet(owner?:Address){
    await check();
    if(signer){
      const account=!owner||owner.toLowerCase()===signer.address.toLowerCase()?signer:bots.find(b=>b.address.toLowerCase()===owner.toLowerCase());
      if(!account)throw Error('Signer unavailable');
      return createWalletClient({account,chain,transport:http(rpc,{retryCount:0})});
    }
    const accounts=await (client.request as any)({method:'eth_accounts',params:[]}) as Address[];
    return createWalletClient({account:owner||accounts[0],chain,transport:http(rpc)});
  }
  return {client,wallet,check,chain,bots,signer};
}
