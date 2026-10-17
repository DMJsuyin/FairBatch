export type GridIntent = { levels:number; rangeBps:number; budgetQuote:number; baseInventory:number; bias:'neutral'|'bullish'|'bearish' };
export type GridOrder = { isBuy:boolean; price:bigint; lots:bigint; postOnly:true; ioc:false; minFill:bigint };
export const defaultIntent:GridIntent = { levels:8, rangeBps:400, budgetQuote:500, baseInventory:300, bias:'bullish' };
export function validateIntent(value:unknown):GridIntent {
  if (!value || typeof value !== 'object') throw new Error('需要结构化网格参数');
  const v=value as Record<string,unknown>;
  for (const key of ['levels','rangeBps','budgetQuote','baseInventory']) if(typeof v[key] !== 'number' || !Number.isFinite(v[key])) throw new Error(`参数 ${key} 无效`);
  const x=v as GridIntent;
  if(!Number.isInteger(x.levels)||x.levels<2||x.levels>16) throw new Error('网格层数须为 2–16');
  if(!Number.isInteger(x.rangeBps)||x.rangeBps<100||x.rangeBps>3000) throw new Error('区间须为 ±1%–30%');
  if(x.budgetQuote<=0||x.budgetQuote>1e6||x.baseInventory<0||x.baseInventory>1e6) throw new Error('资金参数超出范围');
  if(!['neutral','bullish','bearish'].includes(x.bias)) throw new Error('方向须为 neutral / bullish / bearish');
  return { levels:x.levels, rangeBps:x.rangeBps, budgetQuote:x.budgetQuote, baseInventory:x.baseInventory, bias:x.bias };
}
/// Deterministic convenience parser, deliberately not marketed as an AI model.
export function parseIntent(text:string, fallback=defaultIntent):GridIntent {
  const levels=text.match(/(\d+)\s*(?:层|档|levels?)/i);
  const range=text.match(/(?:±|\+\/-|区间\s*)?\s*(\d+(?:\.\d+)?)\s*%/);
  const budget=text.match(/(\d+(?:\.\d+)?)\s*(?:d?USDC|美元|U\b)/i);
  const base=text.match(/(\d+(?:\.\d+)?)\s*(?:d?MON)/i);
  const bias=/偏多|看多|bullish/i.test(text)?'bullish':/偏空|看空|bearish/i.test(text)?'bearish':'neutral';
  if(!levels&&!range&&!budget&&!base&&!/偏多|看多|bullish|偏空|看空|bearish|中性|neutral/i.test(text)) throw new Error('未识别策略。请填写层数、百分比、USDC 买入预算和 MON 卖出库存，或使用参数编辑器。');
  return validateIntent({...fallback, levels:levels?Number(levels[1]):fallback.levels, rangeBps:range?Math.round(Number(range[1])*100):fallback.rangeBps, budgetQuote:budget?Number(budget[1]):fallback.budgetQuote, baseInventory:base?Number(base[1]):fallback.baseInventory, bias});
}
export function allocateGrid(raw:GridIntent, midTicks:bigint) {
  const x=validateIntent(raw);
  if(midTicks<2n||midTicks>100_000_000n) throw new Error('参考价格无效');
  let buys=x.baseInventory===0?x.levels:Math.max(1,Math.min(x.levels-1,Math.round(x.levels*(x.bias==='bullish'?0.625:x.bias==='bearish'?0.375:0.5))));
  const maxDelta=midTicks*BigInt(x.rangeBps)/10000n;
  if(maxDelta===0n || BigInt(x.levels)>maxDelta*(x.baseInventory===0?1n:2n)) throw new Error('区间内价格档位不足，请扩大区间或减少层数');
  if(x.baseInventory>0) buys=Math.min(Number(maxDelta),Math.max(x.levels-Number(maxDelta),buys));
  const sells=x.levels-buys;
  const budget=BigInt(Math.floor(x.budgetQuote*1e6));
  const inventory=BigInt(Math.floor(x.baseInventory*100));
  const orders:GridOrder[]=[];
  for(let side=0;side<2;side++) {
    const count=side===0?buys:sells;
    const weights=Array.from({length:count},(_,i)=>BigInt(count-i));
    const total=weights.reduce((a,b)=>a+b,0n);
    let prior=midTicks;
    for(let i=0;i<count;i++) {
      const delta=maxDelta*BigInt(i+1)/BigInt(count);
      const rawPrice=side===0?midTicks-delta:midTicks+delta;
      const price=side===0?(rawPrice<prior?rawPrice:prior-1n):(rawPrice>prior?rawPrice:prior+1n);
      prior=price;
      if(price<=0n) throw new Error('当前价格精度不足以铺设这些网格');
      const lots=side===0?budget*weights[i]/total/(price*100n):inventory*weights[i]/total;
      if(lots<=0n||lots>1_000_000_000n) throw new Error('每层数量必须至少 0.01 MON；请调整预算或层数');
      orders.push({isBuy:side===0,price,lots,postOnly:true,ioc:false,minFill:0n});
    }
  }
  const quoteRequired=orders.filter(o=>o.isBuy).reduce((s,o)=>s+o.price*o.lots*100n,0n);
  const baseRequired=orders.filter(o=>!o.isBuy).reduce((s,o)=>s+o.lots*10n**16n,0n);
  return {orders,quoteRequired,baseRequired,midTicks};
}
