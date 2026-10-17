// 浏览器独立复算：与 SealBatch.settle 同一算法，纯 BigInt，无依赖
export const NUM_TICKS = 41;

/**
 * @param {Array<bigint|number|string>} buyAt  长度 41，每档买量
 * @param {Array<bigint|number|string>} sellAt 长度 41，每档卖量
 * @returns {{priceTick:number, volume:bigint, rationedSide:number, marginalTick:number, rNum:bigint, rDen:bigint, D:bigint[], S:bigint[]}}
 */
export function clear(buyAt, sellAt) {
  const B = Array.from({ length: NUM_TICKS }, (_, i) => BigInt(buyAt[i] ?? 0));
  const Sl = Array.from({ length: NUM_TICKS }, (_, i) => BigInt(sellAt[i] ?? 0));
  const D = new Array(NUM_TICKS).fill(0n);
  const S = new Array(NUM_TICKS).fill(0n);
  let acc = 0n;
  for (let i = NUM_TICKS - 1; i >= 0; i--) { acc += B[i]; D[i] = acc; }
  acc = 0n;
  for (let i = 0; i < NUM_TICKS; i++) { acc += Sl[i]; S[i] = acc; }

  const res = { priceTick: 0, volume: 0n, rationedSide: 0, marginalTick: 0, rNum: 0n, rDen: 0n, D, S };

  // 候选价 = 有订单的档位；取 V=min(D,S) 最大者
  const ties = [];
  let maxV = 0n;
  for (let t = 0; t < NUM_TICKS; t++) {
    if (B[t] === 0n && Sl[t] === 0n) continue;
    const v = D[t] < S[t] ? D[t] : S[t];
    if (v === 0n) continue;
    if (v > maxV) { maxV = v; ties.length = 0; ties.push(t); }
    else if (v === maxV) ties.push(t);
  }
  if (maxV === 0n) return res;

  // 并列：升序取中位，偶数取较低
  ties.sort((a, b) => a - b);
  const p = ties[Math.floor((ties.length - 1) / 2)];
  res.priceTick = p;
  res.volume = maxV;

  if (D[p] > S[p]) {
    // 买方过量：从最高买价往下逐档全成，边际档按比例
    let cum = 0n;
    for (let t = NUM_TICKS - 1; t >= p; t--) {
      const q = B[t];
      if (cum + q > maxV) {
        res.rationedSide = 1; res.marginalTick = t; res.rNum = maxV - cum; res.rDen = q;
        break;
      }
      cum += q;
    }
  } else if (S[p] > D[p]) {
    let cum = 0n;
    for (let t = 0; t <= p; t++) {
      const q = Sl[t];
      if (cum + q > maxV) {
        res.rationedSide = 2; res.marginalTick = t; res.rNum = maxV - cum; res.rDen = q;
        break;
      }
      cum += q;
    }
  }
  return res;
}

export const priceOfTick = (t) => 90 + 0.5 * Number(t);
