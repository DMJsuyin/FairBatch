import test from 'node:test';
import assert from 'node:assert/strict';
import {nextAction,orderOutcome} from '../src/fairbatch/experience.ts';
import type {Order} from '../src/fairbatch/client.ts';
test('prepare before opening; settled, historical, sealed and recovery rounds expose the right action',()=>{
 const s={id:1n,latest:1n,phase:4};
 assert.equal(nextAction(s,false,false).kind,'connect');assert.equal(nextAction(s,true,false).kind,'prepare');
 assert.equal(nextAction(s,true,true).kind,'open');assert.equal(nextAction({...s,id:0n},true,true).kind,'latest');
 assert.equal(nextAction({...s,phase:2},true,true).kind,'wait');assert.equal(nextAction({...s,phase:1},true,true).kind,'place');
 assert.equal(nextAction({...s,phase:2},true,true,{revealed:false,claimed:false}).kind,'reveal');
 assert.equal(nextAction(s,true,true,{revealed:true,claimed:false}).kind,'claim');
 assert.equal(nextAction(s,true,true,{revealed:true,claimed:true}).kind,'open');
 assert.equal(nextAction({...s,phase:3},true,true).kind,'settle');
});
test('refund explanation exactly adds up for padded partial buys, sells, and timeout',()=>{
 const order={isBuy:true,revealed:true,claimed:true,lots:500n,limitTicks:110n,fillLots:300n,escrow:8000000n,baseDue:3n*10n**18n,quoteDue:5000000n} as Order;
 const result=orderOutcome(order,{phase:4,price:100n,volume:300n})!;
 assert.equal(result.components.reduce((s,c)=>s+c.value,0n),result.refund);assert.equal(result.received,3n*10n**18n);
 assert.deepEqual(result.components.map(c=>c.value),[2200000n,300000n,2500000n]);
 const seller={...order,isBuy:false,limitTicks:90n,escrow:8n*10n**18n,baseDue:5n*10n**18n,quoteDue:3000000n};
 const sold=orderOutcome(seller,{phase:4,price:100n,volume:300n})!;
 assert.equal(sold.components.reduce((s,c)=>s+c.value,0n),sold.refund);assert.equal(sold.receivedToken,'dUSDC');
 const timeout=orderOutcome({...order,fillLots:0n,quoteDue:8000000n,baseDue:0n},{phase:5,price:0n,volume:0n})!;
 assert.equal(timeout.refund,8000000n);assert.match(timeout.reason,/到期/);
});
