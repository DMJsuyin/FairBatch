"""SealBatch independent reference model (pure stdlib).

Written from the spec, not from the Solidity code:
  D(t) = sum of buy qty with limit tick >= t
  S(t) = sum of sell qty with limit tick <= t
  candidates = distinct limit ticks of revealed orders
  V(t) = min(D(t), S(t)); pick max V > 0; ties -> ascending list, index (n-1)//2
  rationing on the long side, walking from the most aggressive tick inward.
"""

NUM_TICKS = 41
P0 = 90 * 10**18
STEP = 5 * 10**17
WAD = 10**18
BPS = 10_000


def price_of(tick):
    return P0 + STEP * tick


def ceil_mul(qty, px):
    return (qty * px + WAD - 1) // WAD


def _D(orders, t):
    return sum(o["qty"] for o in orders if o["isBuy"] and o["tick"] >= t)


def _S(orders, t):
    return sum(o["qty"] for o in orders if not o["isBuy"] and o["tick"] <= t)


def clear(orders):
    """orders: list of dict(owner, isBuy, qty, tick) -- revealed only.

    Returns dict(priceTick, volume, rationedSide, marginalTick, rNum, rDen, fills{owner: fill}).
    """
    fills = {o["owner"]: 0 for o in orders}
    empty = dict(priceTick=0, volume=0, rationedSide=0, marginalTick=0, rNum=0, rDen=0, fills=fills)
    cands = sorted({o["tick"] for o in orders})
    scored = [(t, min(_D(orders, t), _S(orders, t))) for t in cands]
    best = max((v for _, v in scored), default=0)
    if best <= 0:
        return empty
    ties = [t for t, v in scored if v == best]
    P = ties[(len(ties) - 1) // 2]
    V = best
    d, s = _D(orders, P), _S(orders, P)

    side, marg, rnum, rden = 0, 0, 0, 0
    if d > s:
        side = 1
        cum = 0
        for t in range(NUM_TICKS - 1, P - 1, -1):
            q = sum(o["qty"] for o in orders if o["isBuy"] and o["tick"] == t)
            if cum + q > V:
                marg, rnum, rden = t, V - cum, q
                break
            cum += q
    elif s > d:
        side = 2
        cum = 0
        for t in range(0, P + 1):
            q = sum(o["qty"] for o in orders if (not o["isBuy"]) and o["tick"] == t)
            if cum + q > V:
                marg, rnum, rden = t, V - cum, q
                break
            cum += q

    for o in orders:
        f = 0
        if o["isBuy"] and o["tick"] >= P:
            if side == 1 and o["tick"] < marg:
                f = 0
            elif side == 1 and o["tick"] == marg:
                f = o["qty"] * rnum // rden
            else:
                f = o["qty"]
        elif (not o["isBuy"]) and o["tick"] <= P:
            if side == 2 and o["tick"] > marg:
                f = 0
            elif side == 2 and o["tick"] == marg:
                f = o["qty"] * rnum // rden
            else:
                f = o["qty"]
        fills[o["owner"]] = f
    return dict(priceTick=P, volume=V, rationedSide=side, marginalTick=marg, rNum=rnum, rDen=rden, fills=fills)


def payouts(orders, locked, bond, fee_bps, unrevealed=0, result=None):
    """Mirror of previewClaim for revealed orders after settlement.

    locked: {owner: (lockedBase, lockedQuote)} (lockedQuote excludes bond).
    Returns {owner: dict(baseOut, quoteOut, fill, paidQuote, gotBase, gotQuote, comp)}.
    """
    r = result or clear(orders)
    slash = unrevealed * bond
    V = r["volume"]
    px = price_of(r["priceTick"])
    out = {}
    for o in orders:
        lb, lq = locked[o["owner"]]
        base_out, quote_out = lb, lq + bond
        fill = r["fills"][o["owner"]]
        rec = dict(fill=fill, paidQuote=0, gotBase=0, gotQuote=0, deliveredBase=0, comp=0)
        if fill > 0:
            if o["isBuy"]:
                rec["paidQuote"] = ceil_mul(fill, px)
                rec["gotBase"] = fill * (BPS - fee_bps) // BPS
                quote_out -= rec["paidQuote"]
                base_out += rec["gotBase"]
            else:
                rec["deliveredBase"] = fill
                rec["gotQuote"] = (fill * px // WAD) * (BPS - fee_bps) // BPS
                base_out -= fill
                quote_out += rec["gotQuote"]
            if slash > 0:
                rec["comp"] = slash * fill // (2 * V)
                quote_out += rec["comp"]
        rec["baseOut"], rec["quoteOut"] = base_out, quote_out
        out[o["owner"]] = rec
    return out


if __name__ == "__main__":
    # CLI: echo '[{"owner":"a","isBuy":true,"qty":"1000","tick":20}, ...]' | python3 -I clearing.py
    import json
    import sys

    data = json.load(sys.stdin)
    for o in data:
        o["qty"] = int(o["qty"])
    r = clear(data)
    r["volume"], r["rNum"], r["rDen"] = str(r["volume"]), str(r["rNum"]), str(r["rDen"])
    r["fills"] = {k: str(v) for k, v in r["fills"].items()}
    print(json.dumps(r))
