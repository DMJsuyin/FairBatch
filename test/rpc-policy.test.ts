import test from 'node:test';import assert from 'node:assert/strict';
import {validateRpc} from '../scripts/rpc-policy.ts';
const book='0x1111111111111111111111111111111111111111';
test('public RPC rejects unlocked signing, administration and arbitrary call targets',()=>{
 for(const method of ['eth_sendTransaction','wallet_sendTransaction','personal_unlockAccount','evm_mine','evm_setAccountBalance','debug_traceCall','eth_accounts'])assert.throws(()=>validateRpc({method,params:[]},[book]));
 assert.throws(()=>validateRpc([{method:'eth_chainId'}],[book]));
 assert.throws(()=>validateRpc({method:'eth_call',params:[{to:'0x2222222222222222222222222222222222222222'},'latest']},[book]));
 assert.doesNotThrow(()=>validateRpc({method:'eth_call',params:[{to:book,data:'0x'},'latest']},[book]));
 assert.doesNotThrow(()=>validateRpc({method:'eth_blockNumber',params:[]},[book]));
});
