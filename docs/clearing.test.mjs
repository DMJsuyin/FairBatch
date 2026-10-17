// node web/clearing.test.mjs
import { clear } from './clearing.js';
import assert from 'node:assert/strict';

const book = (entries) => { const a = new Array(41).fill(0n); for (const [t, q] of entries) a[t] += BigInt(q); return a; };
let n = 0;
function t(name, buys, sells, exp) {
  const r = clear(book(buys), book(sells));
  for (const k of Object.keys(exp)) assert.equal(r[k], exp[k], `${name}: ${k} = ${r[k]} 期望 ${exp[k]}`);
  console.log('ok -', name); n++;
}

t('简单撮合', [[4, 2], [2, 1]], [[0, 2], [2, 1]], { priceTick: 2, volume: 3n, rationedSide: 0 });
t('买方按比例', [[5, 3]], [[2, 1]], { priceTick: 2, volume: 1n, rationedSide: 1, marginalTick: 5, rNum: 1n, rDen: 3n });
t('卖方按比例', [[3, 1]], [[1, 2], [2, 2]], { priceTick: 2, volume: 1n, rationedSide: 2, marginalTick: 1, rNum: 1n, rDen: 2n });
t('不交叉', [[0, 1]], [[5, 1]], { priceTick: 0, volume: 0n, rationedSide: 0, rNum: 0n });
t('并列取中位(偶数取低)', [[10, 1]], [[4, 1]], { priceTick: 4, volume: 1n, rationedSide: 0 });
t('并列取中位(奇数)', [[10, 2]], [[4, 2], [6, 0], [8, 0]], { priceTick: 4, volume: 2n });
t('四档并列取下中位', [[9, 1], [3, 1]], [[1, 1], [5, 1]], { priceTick: 3, volume: 1n, rationedSide: 1, marginalTick: 3, rNum: 0n, rDen: 1n });
console.log(`全部通过 ${n} 项`);
