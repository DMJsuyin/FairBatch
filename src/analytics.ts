export type Fill = {maker:string; taker:string; takerBuy:boolean; price:bigint; lots:bigint; hash:string; block:bigint; time:number; index:number};
export function realizedPnl(fills:Fill[], address:string) {
  const inventory:{lots:bigint; price:bigint}[]=[];
  let pnl=0n, closedLots=0n, unmatchedSells=0n;
  for(const f of [...fills].sort((a,b)=>a.block===b.block?a.index-b.index:a.block<b.block?-1:1)) {
    const maker=f.maker.toLowerCase()===address.toLowerCase(), taker=f.taker.toLowerCase()===address.toLowerCase();
    if(!maker&&!taker) continue;
    const buy=taker?f.takerBuy:!f.takerBuy;
    if(buy) inventory.push({lots:f.lots,price:f.price});
    else {
      let remaining=f.lots;
      while(remaining&&inventory.length) {
        const first=inventory[0], matched=first.lots<remaining?first.lots:remaining;
        pnl+=(f.price-first.price)*matched*100n; closedLots+=matched;
        first.lots-=matched;remaining-=matched;if(!first.lots) inventory.shift();
      }
      unmatchedSells+=remaining;
    }
  }
  return {pnl,closedLots,unmatchedSells};
}
export function candles(fills:Fill[]) {
  const groups=new Map<number,{time:number;open:number;high:number;low:number;close:number;volume:number}>();
  for(const f of [...fills].sort((a,b)=>a.time-b.time||a.index-b.index)) {
    const time=Math.floor(f.time/60)*60,price=Number(f.price)/100;
    const c=groups.get(time);
    if(c){c.high=Math.max(c.high,price);c.low=Math.min(c.low,price);c.close=price;c.volume+=Number(f.lots)/100;}
    else groups.set(time,{time,open:price,high:price,low:price,close:price,volume:Number(f.lots)/100});
  }
  return [...groups.values()];
}
