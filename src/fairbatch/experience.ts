import type {Order,Snapshot} from './client';

export function nextAction(s:Pick<Snapshot,'phase'|'id'|'latest'>,connected:boolean,prepared:boolean,own?:Pick<Order,'revealed'|'claimed'>){
 if(!connected)return {kind:'connect',label:'准备钱包与交易资产'} as const;
 if(!prepared)return {kind:'prepare',label:'完成钱包与资产准备'} as const;
 if(s.id!==s.latest)return {kind:'latest',label:'返回最新轮次'} as const;
 if(own&&s.phase===2&&!own.revealed)return {kind:'reveal',label:'揭示我的报价'} as const;
 if(own&&!own.claimed&&(s.phase>=4||(s.phase===3&&!own.revealed)))return {kind:'claim',label:'领取成交资产与退款'} as const;
 if([0,4,5].includes(s.phase))return {kind:'open',label:'开启下一轮竞价'} as const;
 if(s.phase===3)return {kind:'settle',label:'触发统一清算'} as const;
 if(s.phase===1&&!own)return {kind:'place',label:'确认限价 · 密封下单'} as const;
 return {kind:'wait',label:own?'订单已提交 · 等待本轮结算':'本轮已封盘 · 等待下一轮'} as const;
}

export function orderOutcome(o:Order,s:Pick<Snapshot,'phase'|'price'|'volume'>){
 if(s.phase<4&&!(s.phase===3&&!o.revealed))return null;
 const refundToken=o.isBuy?'dUSDC':'dMON';
 const receivedToken=o.isBuy?'dMON':'dUSDC';
 const refund=o.isBuy?o.quoteDue:o.baseDue,received=o.isBuy?o.baseDue:o.quoteDue;
 let reason:string;
 if(s.phase===5)reason='清算窗口已到期，锁定资产全额退回。';
 else if(!o.revealed)reason='订单未在揭示窗口提交有效报价，未参与撮合，锁定资产全额退回。';
 else if(o.fillLots===o.lots)reason='报价满足清算条件，委托数量已全部成交。';
 else if(s.volume===0n)reason='本轮买卖限价没有形成可成交交集，锁定资产全额退回。';
 else if(o.isBuy?o.limitTicks<s.price:o.limitTicks>s.price)reason='你的限价未达到本轮清算价，未成交部分原路退回。';
 else reason=o.fillLots===0n?'本轮可成交数量有限，按价格优先及同价整数分配，本单未分得成交数量。':'本轮可成交数量有限，按价格优先、同价按比例分配，剩余委托原路退回。';
 const unit=o.isBuy?100n:10n**16n;
 const original=o.lots*(o.isBuy?o.limitTicks*unit:unit);
 const components=s.phase===4&&o.revealed?[
  {label:'未成交部分',value:(o.lots-o.fillLots)*(o.isBuy?o.limitTicks*unit:unit)},
  {label:'成交价差',value:o.isBuy?o.fillLots*(o.limitTicks-s.price)*unit:0n},
  {label:'额外锁仓',value:o.escrow>original?o.escrow-original:0n},
 ].filter(x=>x.value>0n):[{label:'锁定本金',value:refund}];
 return {refundToken,receivedToken,refund,received,reason,components};
}
