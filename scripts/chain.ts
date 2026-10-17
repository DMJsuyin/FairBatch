import {createPublicClient, createWalletClient, http, custom, defineChain, encodeDeployData, encodeFunctionData, type Address} from 'viem';
export const localChain=defineChain({id:31337,name:'Local EVM',nativeCurrency:{name:'Test Ether',symbol:'ETH',decimals:18},rpcUrls:{default:{http:['http://127.0.0.1:8545']}}});
export const testnet=defineChain({id:10143,name:'Monad Testnet',nativeCurrency:{name:'MON',symbol:'MON',decimals:18},rpcUrls:{default:{http:['https://testnet-rpc.monad.xyz']}},blockExplorers:{default:{name:'Monadscan',url:'https://testnet.monadscan.com'}},testnet:true});
export async function deployMarket(publicClient:any, wallet:any, artifacts:any) {
  const deploy=async(name:string,args:any[])=>{
    const gas = await publicClient.estimateGas({account:wallet.account, data:encodeDeployData({...artifacts[name],args})});
    const hash=await wallet.deployContract({...artifacts[name],args,gas:gas*120n/100n});
    const receipt=await publicClient.waitForTransactionReceipt({hash});
    if(receipt.status!=='success'||!receipt.contractAddress) throw new Error(`Deploy ${name} failed`);
    return receipt.contractAddress as Address;
  };
  const base=await deploy('DemoToken',['Demo MON — faucet only','dMON',18]);
  const quote=await deploy('DemoToken',['Demo USDC — faucet only','dUSDC',6]);
  const book=await deploy('OrderBook',[base,quote,10n**16n,100n]);
  return {base,quote,book,deployBlock:Number(await publicClient.getBlockNumber())};
}
export async function transact(client:any,wallet:any,address:Address,abi:any,functionName:string,args:any[]=[]) {
  const {request}=await client.simulateContract({account:wallet.account,address,abi,functionName,args});
  const gas = await client.estimateContractGas({account:wallet.account,address,abi,functionName,args});
  const hash=await wallet.writeContract({...request,gas:gas*120n/100n});
  const receipt=await client.waitForTransactionReceipt({hash});
  if(receipt.status!=='success') throw new Error(`${functionName} reverted`);
  return receipt;
}
export async function fundAccount(client:any,wallet:any,market:any,artifacts:any) {
  for(const [token,isBase,amount] of [[market.base,true,5000n*10n**18n],[market.quote,false,5000n*10n**6n]] as const) {
    await transact(client,wallet,token,artifacts.DemoToken.abi,'faucet');
    await transact(client,wallet,token,artifacts.DemoToken.abi,'approve',[market.book,amount]);
    await transact(client,wallet,market.book,artifacts.OrderBook.abi,'deposit',[isBase,amount]);
  }
}
export function providerClients(provider:any) {
  const publicClient=createPublicClient({chain:localChain,transport:custom(provider),pollingInterval:30});
  const wallet=(account:Address)=>createWalletClient({account,chain:localChain,transport:custom(provider)});
  return {publicClient,wallet};
}
export function rpcClients(rpc:string,chain=localChain) {
  return {publicClient:createPublicClient({chain,transport:http(rpc),pollingInterval:300}),wallet:(account:Address)=>createWalletClient({account,chain,transport:http(rpc)})};
}
