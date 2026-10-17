import fs from 'node:fs';
import {createPublicClient,createWalletClient,http} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {compile} from './compile.ts';
import {testnet,deployMarket} from './chain.ts';
// Never persist or log the deployer's key. Mainnet is intentionally not supported.
const key=process.env.DEPLOYER_PRIVATE_KEY;
if(!key||!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error('Set DEPLOYER_PRIVATE_KEY in your local environment (testnet funded wallet). Never paste it into chat.');
const rpc=process.env.MONAD_RPC_URL||testnet.rpcUrls.default.http[0];
const publicClient=createPublicClient({chain:testnet,transport:http(rpc)});
if(await publicClient.getChainId()!==10143) throw new Error('Refusing to deploy outside Monad Testnet 10143');
const account=privateKeyToAccount(key as `0x${string}`);
const wallet=createWalletClient({account,chain:testnet,transport:http(rpc)});
if(await publicClient.getBalance({address:account.address})===0n) throw new Error('Deployment wallet needs test MON from https://faucet.monad.xyz');
const market=await deployMarket(publicClient,wallet,compile());
// Keep RPC credentials out of the published manifest.
const manifest={...market,chainId:10143,rpc:testnet.rpcUrls.default.http[0],network:'Monad Testnet',createdAt:new Date().toISOString()};
fs.writeFileSync('public/deployment.json',JSON.stringify(manifest,null,2));
fs.mkdirSync('deployments',{recursive:true});fs.writeFileSync('deployments/monad-testnet.json',JSON.stringify(manifest,null,2));
console.log(`Deployed test assets and book: https://testnet.monadscan.com/address/${market.book}`);
