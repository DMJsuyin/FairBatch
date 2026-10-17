import fs from 'node:fs';
import ganache from 'ganache';
import {compile} from './compile.ts';
import {deployMarket,fundAccount,transact,rpcClients} from './chain.ts';
import type {Address} from 'viem';
const artifacts=compile();
const server=ganache.server({chain:{chainId:31337,hardfork:'shanghai'},wallet:{totalAccounts:5,defaultBalance:1000},logging:{quiet:true}});
const port=Number(process.env.RPC_PORT||8545);
await server.listen(port,'127.0.0.1');
const {publicClient,wallet}=rpcClients(`http://127.0.0.1:${port}`);
const accounts=await server.provider.request({method:'eth_accounts',params:[]}) as Address[];
const market=await deployMarket(publicClient,wallet(accounts[0]),artifacts);
for(const account of accounts.slice(0,3)) await fundAccount(publicClient,wallet(account),market,artifacts);
const request=(isBuy:boolean,price:number,lots:number, ioc=false)=>({isBuy,price:BigInt(price),lots:BigInt(lots),postOnly:!ioc,ioc,minFill:0n});
// These candles are real local-chain fills from explicitly labelled demo counterparties.
for(let i=0;i<12;i++) {
  const price=[99,100,102,101,103,104,102,101,99,98,100,100][i];
  await server.provider.request({method:'evm_increaseTime',params:[60]});
  await transact(publicClient,wallet(accounts[1]),market.book,artifacts.OrderBook.abi,'placeOrder',[request(false,price,100)]);
  await transact(publicClient,wallet(accounts[2]),market.book,artifacts.OrderBook.abi,'placeOrder',[request(true,price,100,true)]);
}
for(const buy of [true,false]) {
  await transact(publicClient,wallet(accounts[1]),market.book,artifacts.OrderBook.abi,'batchPlaceOrders',[Array.from({length:10},(_,i)=>request(buy,buy?99-i:101+i,2000+i*300))]);
}
fs.mkdirSync('public',{recursive:true});
fs.writeFileSync('public/deployment.json',JSON.stringify({...market,chainId:31337,rpc:`http://127.0.0.1:${port}`,demoAccount:accounts[0],arenaAccount:accounts[2],seedAccount:accounts[1],network:'Local EVM',createdAt:new Date().toISOString()},null,2));
process.env.FAIRBATCH_RPC=`http://127.0.0.1:${port}`;
await import('./fairbatch-deploy.ts');
console.log(`Local chain ready. ${market.book}\nDemo wallets are ephemeral and unlocked on loopback only.\nRun npm run dev in another terminal.`);
let closing=false;
async function stop(){if(closing)return;closing=true;await server.close();process.exit(0);}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
