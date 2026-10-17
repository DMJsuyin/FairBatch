type DepthOrder={revealed:boolean;isBuy:boolean;lots:bigint;limitTicks:bigint};
export type DepthPoint={price:number;buy:number;sell:number};

// Integer ticks: a sell enters at its limit; a buy exits one tick above its limit.
// At most 2n event levels, independent of the numeric distance between prices.
export function depthCurve(orders:DepthOrder[]){
 const rows=orders.filter(o=>o.revealed&&o.lots>0n);
 if(!rows.length)return {lo:0,hi:1,max:1,points:[] as DepthPoint[]};
 const lo=Math.max(1,Math.min(...rows.map(o=>Number(o.limitTicks)))-3);
 const hi=Math.max(...rows.map(o=>Number(o.limitTicks)))+3;
 const events=new Map<number,{buy:bigint;sell:bigint}>();
 let buy=0n,sell=0n,totalSell=0n;
 for(const o of rows){
  const p=Number(o.limitTicks)+(o.isBuy?1:0),event=events.get(p)||{buy:0n,sell:0n};
  if(o.isBuy){buy+=o.lots;event.buy-=o.lots;}else{totalSell+=o.lots;event.sell+=o.lots;}
  events.set(p,event);
 }
 const max=Math.max(Number(buy),Number(totalSell),1);
 const points:DepthPoint[]=[{price:lo,buy:Number(buy),sell:0}];
 for(const [price,delta] of [...events].sort((a,b)=>a[0]-b[0])){
  points.push({price,buy:Number(buy),sell:Number(sell)});
  buy+=delta.buy;sell+=delta.sell;
  points.push({price,buy:Number(buy),sell:Number(sell)});
 }
 points.push({price:hi,buy:Number(buy),sell:Number(sell)});
 return {lo,hi,max,points};
}
