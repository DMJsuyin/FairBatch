import {toHex, type Address, type Hex} from 'viem';

export const intentTypes = {CommitIntent:[
 {name:'roundId',type:'uint256'}, {name:'owner',type:'address'}, {name:'isBuy',type:'bool'},
 {name:'commitment',type:'bytes32'}, {name:'escrow',type:'uint256'},
 {name:'nonce',type:'uint256'}, {name:'deadline',type:'uint256'},
]} as const;
export const intentDomain = (chainId:number,verifyingContract:Address) => ({name:'FairBatch',version:'0.3',chainId,verifyingContract});
export type Input = {owner:Address;isBuy:boolean;lots:bigint;limitTicks:bigint};
export type Clearing = {volume:bigint;price:bigint;low:bigint;high:bigint;fills:bigint[]};
export function witness(rows:Input[]):[Hex,Hex]{
 const side=(buy:boolean)=>toHex(new Uint8Array(rows.map((o,i)=>({o,i})).filter(({o})=>o.lots>0n&&o.isBuy===buy).sort((a,b)=>{
  if(a.o.limitTicks!==b.o.limitTicks)return (a.o.limitTicks>b.o.limitTicks)===buy?-1:1;
  return a.o.owner.toLowerCase().localeCompare(b.o.owner.toLowerCase());
 }).map(({i})=>i)));
 if(rows.length>32)throw Error('Batch exceeds 32 orders');
 return [side(true),side(false)];
}
export const clearingInputs=(orders:(Input&{revealed:boolean})[])=>orders.map(o=>({...o,lots:o.revealed?o.lots:0n}));
// Independent oracle: scan every distinct price, not the contract's two-pointer match.
// Allocation uses a sorted remainder list, not the contract's heap.
export function referenceClear(rows:Input[]):Clearing{
 const levels=[...new Set(rows.filter(o=>o.lots>0n).map(o=>o.limitTicks))].sort((a,b)=>a<b?-1:1);
 const curve=levels.map(p=>{let buy=0n,sell=0n;for(const o of rows){if(o.isBuy&&o.limitTicks>=p)buy+=o.lots;if(!o.isBuy&&o.limitTicks<=p)sell+=o.lots;}return {p,v:buy<sell?buy:sell};});
 const volume=curve.reduce((v,c)=>v>c.v?v:c.v,0n),fills=rows.map(()=>0n);
 if(!volume)return {volume,price:0n,low:0n,high:0n,fills};
 const feasible=curve.filter(c=>c.v===volume),low=feasible[0].p,high=feasible.at(-1)!.p,price=low+(high-low)/2n;
 for(const buy of [true,false]){
  let left=volume;
  const priorities=levels.slice().sort((a,b)=>(a>b)===buy?-1:1);
  for(const p of priorities){
   if(!left)break;
   const group=rows.map((o,i)=>({o,i})).filter(({o})=>o.lots>0n&&o.isBuy===buy&&o.limitTicks===p);
   const total=group.reduce((s,{o})=>s+o.lots,0n);if(!total)continue;
   if(left>=total){for(const {o,i}of group)fills[i]=o.lots;left-=total;continue;}
   let assigned=0n;
   const remainder=group.map(({o,i})=>{fills[i]=left*o.lots/total;assigned+=fills[i];return {i,owner:o.owner.toLowerCase(),r:left*o.lots%total};}).sort((a,b)=>a.r===b.r?a.owner.localeCompare(b.owner):a.r>b.r?-1:1);
   for(let k=0;k<Number(left-assigned);k++)fills[remainder[k].i]++;
   left=0n;
  }
 }
 return {volume,price,low,high,fills};
}
// Round up to a common power-of-two collateral bucket; callers can opt out.
// This hides the exact amount within a bucket, not direction, address or balance history.
export function paddedEscrow(required:bigint,unit:bigint){let n=unit;while(n<required)n*=2n;return n;}
