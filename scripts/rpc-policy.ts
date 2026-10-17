import {parseTransaction} from 'viem';
const reads=new Set(['eth_chainId','eth_blockNumber','eth_getBalance','eth_getCode','eth_getTransactionCount','eth_getTransactionReceipt','eth_getTransactionByHash','eth_getBlockByNumber','eth_getBlockByHash','eth_gasPrice','eth_maxPriorityFeePerGas','eth_feeHistory','net_version']);
export function validateRpc(body:any,addresses:string[],allowBatch=true) {
 if(Array.isArray(body)){if(!allowBatch||body.length===0||body.length>20)throw new Error('Invalid RPC request');for(const item of body)validateRpc(item,addresses,false);return;}
 if(body&&typeof body==='object'&&body.params===undefined)body.params=[];
 if(!body||typeof body.method!=='string'||!Array.isArray(body.params))throw new Error('Invalid RPC request');
 const allowed=new Set(addresses.map(a=>a.toLowerCase()));
 const target=(to:any)=>typeof to==='string'&&allowed.has(to.toLowerCase());
 if(reads.has(body.method)) {
  if(body.method==='eth_feeHistory'&&(BigInt(body.params[0])>100n||body.params[2]?.length>10))throw new Error('History limit');
  return;
 }
 if(body.method==='eth_call'||body.method==='eth_estimateGas'){
  const tx=body.params[0];if(!target(tx?.to)||BigInt(tx.value||0)!==0n)throw new Error('Target denied');
  if(tx.gas&&BigInt(tx.gas)>6_000_000n)throw new Error('Gas limit');tx.gas='0x5b8d80';return;
 }
 if(body.method==='eth_getLogs'){
  const q=body.params[0];if(!target(q?.address))throw new Error('Log target denied');
  if(!/^0x[\da-f]+$/i.test(q.fromBlock)||!/^0x[\da-f]+$/i.test(q.toBlock)||BigInt(q.toBlock)-BigInt(q.fromBlock)>5000n)throw new Error('Log range limit');return;
 }
 if(body.method==='eth_sendRawTransaction'){
  const tx=parseTransaction(body.params[0]);if(tx.chainId!==31337||!target(tx.to)||BigInt(tx.value||0)!==0n||!tx.gas||tx.gas>6_000_000n||!tx.r||!tx.s)throw new Error('Signed transaction denied');return;
 }
 throw new Error('RPC method denied');
}
