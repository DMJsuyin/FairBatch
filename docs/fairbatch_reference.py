"""FairBatch v0.2 clearing specification model, Python 3.10+, no dependencies.
Run: python3 fairbatch_reference.py --verify --output verification.json
Only the clearing algorithm is modelled here, not EVM/storage/network behaviour.
Prices: ticks; quantities: base lots; quote raw units per lot per tick = 100.
"""
from dataclasses import dataclass, asdict
from collections import defaultdict
from itertools import permutations
import argparse
import json
import random

QUOTE_UNIT = 100

@dataclass(frozen=True)
class Order:
    owner: str
    buy: bool
    lots: int
    price: int
    revealed: bool = True


def order(owner, buy, lots, price, revealed=True):
    return Order(f'0x{owner:040x}', buy, lots, price, revealed)


def allocate(rows, volume, buy):
    """Price priority; marginal level uses largest remainder, then owner ASC."""
    fills = {o.owner: 0 for o in rows}
    levels = defaultdict(list)
    for o in rows:
        levels[o.price].append(o)
    remaining = volume
    for price in sorted(levels, reverse=buy):
        group = levels[price]
        total = sum(o.lots for o in group)
        take = min(remaining, total)
        for o in group:
            fills[o.owner] = take * o.lots // total
        dust = take - sum(fills[o.owner] for o in group)
        ranked = sorted(group, key=lambda o: (-(take * o.lots % total), o.owner))
        for o in ranked[:dust]:
            fills[o.owner] += 1
        remaining -= take
        if not remaining:
            break
    assert remaining == 0
    return fills


def settle(orders):
    assert len({o.owner for o in orders}) == len(orders)
    assert all(0 < o.lots <= 10**9 and 0 < o.price <= 10**9 for o in orders)
    bids = sorted((o for o in orders if o.buy and o.revealed), key=lambda o: (-o.price, o.owner))
    asks = sorted((o for o in orders if not o.buy and o.revealed), key=lambda o: (o.price, o.owner))
    i = j = 0
    left_b = bids[0].lots if bids else 0
    left_a = asks[0].lots if asks else 0
    volume = 0
    while i < len(bids) and j < len(asks) and bids[i].price >= asks[j].price:
        size = min(left_b, left_a)
        volume += size
        left_b -= size
        left_a -= size
        if left_b == 0:
            i += 1
            if i < len(bids): left_b = bids[i].lots
        if left_a == 0:
            j += 1
            if j < len(asks): left_a = asks[j].lots

    def marginal(rows):
        cumulative = 0
        for o in rows:
            cumulative += o.lots
            if cumulative >= volume: return o.price
        raise AssertionError('Missing marginal order')

    low = marginal(asks) if volume else None
    high = marginal(bids) if volume else None
    price = low + (high - low) // 2 if volume else None
    assert not volume or low <= price <= high
    fills = {o.owner: 0 for o in orders}
    if volume:
        fills.update(allocate([o for o in bids if o.price >= price], volume, True))
        fills.update(allocate([o for o in asks if o.price <= price], volume, False))
    payouts = {}
    for o in orders:
        f = fills[o.owner]
        paid = f * (price or 0) * QUOTE_UNIT
        payouts[o.owner] = {
            'fillLots': f,
            'baseLots': f if o.buy else o.lots-f,
            'quoteRaw': o.lots*o.price*QUOTE_UNIT-paid if o.buy else paid,
        }
    return {'priceTicks': price, 'volumeLots': volume, 'lowTicks': low,
            'highTicks': high, 'payouts': payouts}


def exhaustive(orders):
    """Independent oracle: enumerate every integer price, no matching pointers."""
    valid = [o for o in orders if o.revealed]
    if not valid: return (None, 0, None, None)
    volumes = {}
    for p in range(1, max(o.price for o in valid)+1):
        demand = sum(o.lots for o in valid if o.buy and o.price >= p)
        supply = sum(o.lots for o in valid if not o.buy and o.price <= p)
        volumes[p] = min(demand, supply)
    v = max(volumes.values())
    if v == 0: return (None, 0, None, None)
    prices = [p for p, vol in volumes.items() if vol == v]
    low, high = min(prices), max(prices)
    assert prices == list(range(low, high+1))
    return (low+(high-low)//2, v, low, high)


def old_candidate_median(orders):
    valid = [o for o in orders if o.revealed]
    candidates = sorted({o.price for o in valid})
    values = {p: min(sum(o.lots for o in valid if o.buy and o.price >= p),
                     sum(o.lots for o in valid if not o.buy and o.price <= p))
              for p in candidates}
    if not values or max(values.values()) == 0: return None
    winners = [p for p in candidates if values[p] == max(values.values())]
    return winners[(len(winners)-1)//2]


def check(orders, result):
    b = sum(o.lots for o in orders if not o.buy)
    q = sum(o.lots*o.price*QUOTE_UNIT for o in orders if o.buy)
    assert sum(x['baseLots'] for x in result['payouts'].values()) == b
    assert sum(x['quoteRaw'] for x in result['payouts'].values()) == q
    for side in [True, False]:
        assert sum(result['payouts'][o.owner]['fillLots'] for o in orders if o.buy == side) == result['volumeLots']
    for o in orders:
        x = result['payouts'][o.owner]
        f = x['fillLots']
        assert 0 <= f <= o.lots
        assert x['baseLots'] >= 0 and x['quoteRaw'] >= 0
        if not o.revealed: assert f == 0
        if f:
            assert result['priceTicks'] <= o.price if o.buy else result['priceTicks'] >= o.price
        # No worse-price order fills while a better-price order on its side is unfilled.
        for other in orders:
            if f and other.revealed and other.buy == o.buy:
                better = other.price > o.price if o.buy else other.price < o.price
                if better: assert result['payouts'][other.owner]['fillLots'] == other.lots



def continuous_book(orders):
    """Comparison model: price-time priority, trades at resting maker price."""
    book = []
    fills = {o.owner: {'fillLots': 0, 'quoteTradedRaw': 0} for o in orders}
    trades = []
    for seq, incoming in enumerate(orders):
        remaining = incoming.lots
        while remaining:
            opposite = [r for r in book if r['lots'] and r['order'].buy != incoming.buy
                        and (r['order'].price <= incoming.price if incoming.buy else r['order'].price >= incoming.price)]
            if not opposite: break
            maker = min(opposite, key=lambda r: (r['order'].price if incoming.buy else -r['order'].price, r['seq']))
            size = min(remaining, maker['lots'])
            price = maker['order'].price
            for owner in [incoming.owner, maker['order'].owner]:
                fills[owner]['fillLots'] += size
                fills[owner]['quoteTradedRaw'] += size*price*QUOTE_UNIT
            trades.append({'lots': size, 'priceTicks': price})
            remaining -= size
            maker['lots'] -= size
        if remaining: book.append({'order': incoming, 'lots': remaining, 'seq': seq})
    return {'trades': trades, 'fills': fills}


def comparison_demo():
    orders = [order(1,True,300,1100), order(2,True,100,1100), order(3,False,200,900)]
    expected = settle(orders)
    runs = []
    for permutation in permutations(orders):
        assert settle(permutation) == expected
        book = continuous_book(permutation)
        assert sum(t['lots'] for t in book['trades']) == 200
        runs.append({'arrivalOrder': [int(o.owner,16) for o in permutation], 'continuousBook': book})
    assert {t['priceTicks'] for run in runs for t in run['continuousBook']['trades']} == {900,1100}
    return {'scope': 'Mechanism comparison on constructed identical input; not a live exchange benchmark',
            'orders': [asdict(o) for o in orders], 'fairBatch': expected, 'permutations': runs}


def verify():
    cases = {
      'normal': [order(1,True,200,1100),order(2,True,100,1000),order(3,False,200,900),order(4,False,100,1000)],
      'partial': [order(1,True,300,1100),order(2,True,100,1100),order(3,False,200,900)],
      'rounding': [order(1,True,3,1100),order(2,True,2,1100),order(3,False,2,900)],
      'no_cross': [order(1,True,100,900),order(2,False,100,1100)],
      'withheld': [order(1,True,300,1100),order(2,False,200,900,False)],
      'plateau': [order(1,True,1000,1100),order(2,False,1000,1000)],
    }
    cases['unfilled_quote'] = cases['plateau']+[order(3,True,100,1040)]
    outputs = {}
    for name, orders in cases.items():
        result = settle(orders)
        check(orders,result)
        assert (result['priceTicks'],result['volumeLots'],result['lowTicks'],result['highTicks']) == exhaustive(orders)
        outputs[name] = {'orders':[asdict(o) for o in orders], 'result':result}
    assert outputs['normal']['result']['priceTicks'] == 1000
    assert outputs['normal']['result']['volumeLots'] == 300
    assert outputs['partial']['result']['payouts'][order(1,True,1,1).owner]['fillLots'] == 150
    assert outputs['partial']['result']['payouts'][order(2,True,1,1).owner]['fillLots'] == 50
    assert outputs['rounding']['result']['payouts'][order(1,True,1,1).owner]['fillLots'] == 1
    assert outputs['rounding']['result']['payouts'][order(2,True,1,1).owner]['fillLots'] == 1
    assert outputs['plateau']['result']['priceTicks'] == outputs['unfilled_quote']['result']['priceTicks'] == 1050
    assert old_candidate_median(cases['plateau']) == 1000
    assert old_candidate_median(cases['unfilled_quote']) == 1040
    # Same underlying bid, split across addresses at the same price: price and volume invariant.
    split = [order(1,True,400,1100),order(3,True,600,1100),order(2,False,1000,1000)]
    assert settle(split)['priceTicks'] == 1050 and settle(split)['volumeLots'] == 1000
    # uint64 input cap / large integer totals (no exhaustive enumeration).
    large = [order(i,i%2==0,10**9,10**9) for i in range(1,33)]
    check(large,settle(large))
    rng = random.Random(20261017)
    for _ in range(10000):
        orders = [order(i,rng.choice([True,False]),rng.randint(1,100),rng.randint(1,30),rng.random()>.15)
                  for i in range(1,rng.randint(1,32)+1)]
        result = settle(orders)
        check(orders,result)
        assert (result['priceTicks'],result['volumeLots'],result['lowTicks'],result['highTicks']) == exhaustive(orders)
        for _ in range(3):
            rng.shuffle(orders)
            assert settle(orders) == result
    return {'status':'passed','seed':20261017,'randomCases':10000,'permutationComparisons':30000,
            'checks':['independent exhaustive integer-price oracle','base/quote conservation',
                      'limit prices','price priority','unrevealed exclusion','quantity bounds',
                      'permutation invariance','largest remainder example','unfilled quote example',
                      'same-price split price/volume','32 orders at maximum input magnitude'],
            'scope':'Python clearing model only; no Solidity, phase transitions, gas or deployed contract validation',
            'examples':outputs, 'comparisonDemo':comparison_demo()}

if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--verify',action='store_true')
    parser.add_argument('--output')
    args=parser.parse_args()
    if not args.verify: parser.error('Use --verify')
    report=verify()
    if args.output:
        with open(args.output,'w',encoding='utf-8') as f: json.dump(report,f,ensure_ascii=False,indent=2)
    print(json.dumps({k:v for k,v in report.items() if k not in {'examples','comparisonDemo'}},ensure_ascii=False,indent=2))
