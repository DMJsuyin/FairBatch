"""Run: python3 -I ref/test_clearing.py   (plain asserts, no deps)"""
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from clearing import clear, payouts, price_of, _D, _S, BPS  # noqa: E402

E = 10**18


def O(owner, isBuy, qty, tick):
    return dict(owner=owner, isBuy=isBuy, qty=qty, tick=tick)


def key(r):
    return (r["priceTick"], r["volume"], r["rationedSide"], r["marginalTick"], r["rNum"], r["rDen"],
            tuple(sorted(r["fills"].items())))


def test_simple_cross():
    r = clear([O("A", True, 2 * E, 22), O("B", True, 1 * E, 20), O("C", False, 3 * E, 18)])
    # V(18)=3, V(20)=3, V(22)=2 -> ties [18,20] -> index 0 -> 18
    assert r["priceTick"] == 18 and r["volume"] == 3 * E and r["rationedSide"] == 0, r
    assert r["fills"] == {"A": 2 * E, "B": 1 * E, "C": 3 * E}


def test_buy_rationed():
    r = clear([O("A", True, 2 * E, 25), O("B", True, 2 * E, 21), O("C", True, 2 * E, 21), O("D", False, 3 * E, 20)])
    # V(20)=3 (D=6,S=3), V(21)=3, V(25)=2 -> ties [20,21] -> 20
    assert r["priceTick"] == 20 and r["volume"] == 3 * E and r["rationedSide"] == 1
    assert r["marginalTick"] == 21 and r["rNum"] == 1 * E and r["rDen"] == 4 * E
    assert r["fills"]["A"] == 2 * E and r["fills"]["B"] == E // 2 and r["fills"]["D"] == 3 * E


def test_sell_rationed():
    r = clear([O("S1", False, 1 * E, 10), O("S2", False, 3 * E, 12), O("B", True, 2 * E, 15)])
    # V(10)=1, V(12)=2 (S=4), V(15)=2 (S=4) -> ties [12,15] -> 12; S>D -> sells rationed
    assert r["priceTick"] == 12 and r["volume"] == 2 * E and r["rationedSide"] == 2
    assert r["marginalTick"] == 12 and r["rNum"] == 1 * E and r["rDen"] == 3 * E
    assert r["fills"]["S1"] == E and r["fills"]["S2"] == 3 * E * 1 // 3 and r["fills"]["B"] == 2 * E


def test_no_cross():
    r = clear([O("A", True, E, 10), O("B", False, E, 11)])
    assert r["volume"] == 0 and r["priceTick"] == 0 and all(v == 0 for v in r["fills"].values())
    assert clear([])["volume"] == 0
    assert clear([O("A", True, E, 10)])["volume"] == 0


def test_tie_median():
    # buy 1@30, sell 1@10, plus tie candidates at 15, 20, 25 (tiny orders that keep V=1)
    orders = [O("B", True, E, 30), O("S", False, E, 10)]
    r = clear(orders)
    assert r["priceTick"] == 10  # ties [10,30] -> index 0
    orders += [O("X", True, 10**15, 5)]  # tick 5: S(5)=0 -> V=0, not a tie
    orders += [O("Y", False, 10**15, 35)]  # tick 35: D(35)=0
    orders += [O("Z", True, 10**15, 20)]  # tick 20: D=1.001, S=1 -> V=1
    r = clear(orders)
    assert r["priceTick"] == 20, r  # ties [10, 20, 30] -> median 20


def test_permutation_invariance():
    rng = random.Random(7)
    orders = [O(f"o{i}", rng.random() < 0.5, rng.randint(1, 30) * 10**17, rng.randint(14, 26)) for i in range(25)]
    base = key(clear(orders))
    for _ in range(50):
        rng.shuffle(orders)
        assert key(clear(orders)) == base


def test_fuzz():
    rng = random.Random(42)
    crossed = 0
    for case in range(2000):
        n = rng.randint(1, 12)
        orders = []
        locked = {}
        for i in range(n):
            isBuy = rng.random() < 0.5
            qty = rng.choice([rng.randint(10**15, 5 * E), rng.randint(1, 20) * 10**17])
            tick = rng.randint(0, 40) if rng.random() < 0.2 else rng.randint(15, 25)
            orders.append(O(f"o{i}", isBuy, qty, tick))
            locked[f"o{i}"] = (10 * E, 1000 * E - E)
        fee = rng.choice([1, 5, 30])
        unrev = rng.randint(0, 3)
        r = clear(orders)
        P, V = r["priceTick"], r["volume"]
        if V == 0:
            assert all(f == 0 for f in r["fills"].values())
            continue
        crossed += 1
        assert V == min(_D(orders, P), _S(orders, P))
        pays = payouts(orders, locked, E, fee, unrev, r)
        px = price_of(P)
        buy_base_rx = sum(pays[o["owner"]]["gotBase"] for o in orders if o["isBuy"])
        sell_base_dl = sum(pays[o["owner"]]["deliveredBase"] for o in orders if not o["isBuy"])
        sell_quote_rx = sum(pays[o["owner"]]["gotQuote"] for o in orders if not o["isBuy"])
        buy_quote_pd = sum(pays[o["owner"]]["paidQuote"] for o in orders if o["isBuy"])
        comp = sum(p["comp"] for p in pays.values())
        sum_buy_fill = sum(r["fills"][o["owner"]] for o in orders if o["isBuy"])
        sum_sell_fill = sum(r["fills"][o["owner"]] for o in orders if not o["isBuy"])
        assert sum_buy_fill <= V and sum_sell_fill <= V
        assert max(sum_buy_fill, sum_sell_fill) == V  # non-rationed side fills exactly V
        assert buy_base_rx <= sell_base_dl, case
        assert sell_quote_rx <= buy_quote_pd, (case, sell_quote_rx, buy_quote_pd)
        assert comp <= unrev * E
        for o in orders:
            f = r["fills"][o["owner"]]
            p = pays[o["owner"]]
            assert 0 <= f <= o["qty"]
            if o["isBuy"]:
                assert p["paidQuote"] <= -(-f * price_of(o["tick"]) // E)  # pays <= ceil(limit*fill)
                if f:
                    assert o["tick"] >= P
            else:
                pre_fee = f * px // E
                assert pre_fee >= f * price_of(o["tick"]) // E  # receives >= limit*fill pre-fee
                assert p["gotQuote"] <= pre_fee
                if f:
                    assert o["tick"] <= P
            # nobody goes negative
            assert p["baseOut"] >= 0 and p["quoteOut"] >= 0
    assert crossed > 1000, crossed


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for t in tests:
        t()
        print("ok", t.__name__)
    print(f"ALL {len(tests)} TESTS PASSED")
