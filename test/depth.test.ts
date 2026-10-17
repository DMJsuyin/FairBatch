import test from 'node:test';
import assert from 'node:assert/strict';
import {depthCurve} from '../src/fairbatch/depth.ts';
const order=(isBuy:boolean,lots:bigint,limitTicks:bigint,revealed=true)=>({isBuy,lots,limitTicks,revealed});
test('depth breakpoints equal inclusive limit-order depth at every small integer tick',()=>{
 const rows=[order(true,10n,3n),order(true,5n,3n),order(true,8n,7n),order(false,4n,1n),order(false,13n,5n),order(false,999n,2n,false)];
 const curve=depthCurve(rows);
 for(let p=curve.lo;p<=curve.hi;p++){
  const point=curve.points.filter(x=>x.price<=p).at(-1)!;
  const sum=(side:boolean)=>Number(rows.filter(o=>o.revealed&&o.isBuy===side&&(side?o.limitTicks>=BigInt(p):o.limitTicks<=BigInt(p))).reduce((a,o)=>a+o.lots,0n));
  assert.equal(point.buy,sum(true));assert.equal(point.sell,sum(false));
 }
 assert.deepEqual(depthCurve([...rows].reverse()),curve);
});
test('one billion tick span renders a bounded number of vertices, never a price-range loop',()=>{
 const rows=Array.from({length:32},(_,i)=>order(i%2===0,1_000_000_000n,i%2===0?1_000_000_000n:1n));
 const curve=depthCurve(rows);assert.equal(curve.points.length,6);assert.equal(curve.max,16_000_000_000);
 assert.equal(curve.points[2].buy,16_000_000_000);assert.equal(curve.points[2].sell,16_000_000_000);
 assert.equal(curve.points.at(-1)!.buy,0);
 assert.deepEqual(depthCurve([order(true,1n,1n,false)]).points,[]);
});
