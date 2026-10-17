"""Verify on-chain SealBatch settlements against the independent Python reference.

python3 -I ref/verify_chain.py --rpc URL --sb 0xSealBatch (--batch N [N ...] | --last N [--lookback BLOCKS]) [--json]

Pure stdlib: JSON-RPC over urllib, logs decoded by hand.
"""
import argparse
import json
import os
import sys
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from clearing import clear  # noqa: E402

# cast sig-event ...
T_REVEALED = "0x6efad988a6acc580ead6974947dba30bb2b49da27fae79ff7f61b623d36d7ce9"  # Revealed(uint256,address,bool,uint128,uint8)
T_SETTLED = "0x062af90ff81dab4805453e1e8173c1ba61c66f22af8abaf5422d077831092392"  # Settled(uint256,uint8,uint128,uint8,uint8,uint128,uint128,uint128)
T_COMMITTED = "0x26a454697a4923cb3646779d831b5e4696bd3fab14b67dd6dfe23d72354f57dd"  # Committed(uint256,address,bytes32)
T_CANCELLED = "0xc41d93b8bfbf9fd7cf5bfe271fd649ab6a6fec0ea101c23b82a2a28eca2533a9"  # Cancelled(uint256)
SEL = {"bond": "0x64c9ec6f", "genesisBlock": "0x4cdc9c63", "windowBlocks": "0xa448db80",
       "currentWindow": "0xba0bafb4"}

CHUNK = 100


class RPC:
    def __init__(self, url):
        self.url, self.id = url, 0

    def call(self, method, params, retries=6):
        for attempt in range(retries):
            self.id += 1
            body = json.dumps({"jsonrpc": "2.0", "id": self.id, "method": method, "params": params}).encode()
            req = urllib.request.Request(self.url, body, {"Content-Type": "application/json"})
            try:
                with urllib.request.urlopen(req, timeout=30) as r:
                    resp = json.loads(r.read())
                if "error" in resp:
                    raise RuntimeError(resp["error"])
                return resp["result"]
            except Exception as e:  # rate limit / transient
                if attempt == retries - 1:
                    raise
                time.sleep(0.5 * 2 ** attempt)

    def view(self, sb, name):
        return int(self.call("eth_call", [{"to": sb, "data": SEL[name]}, "latest"]), 16)

    def logs(self, sb, topics, frm, to):
        out = []
        b = frm
        while b <= to:
            e = min(b + CHUNK - 1, to)
            out += self.call("eth_getLogs", [{"address": sb, "topics": topics, "fromBlock": hex(b), "toBlock": hex(e)}])
            b = e + 1
            time.sleep(0.05)
        return out


def words(data):
    d = data[2:]
    return [int(d[i:i + 64], 16) for i in range(0, len(d), 64)]


def batch_topic(b):
    return "0x" + hex(b)[2:].rjust(64, "0")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rpc", required=True)
    ap.add_argument("--sb", required=True)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--batch", type=int, nargs="+")
    g.add_argument("--last", type=int)
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--lookback", type=int, default=3000, help="blocks scanned to find recent batches for --last")
    a = ap.parse_args()
    rpc = RPC(a.rpc)
    sb = a.sb.lower()
    gen, w, bond = rpc.view(sb, "genesisBlock"), rpc.view(sb, "windowBlocks"), rpc.view(sb, "bond")
    latest = int(rpc.call("eth_blockNumber", []), 16)
    cur = (latest - gen) // w
    if a.batch:
        batches = a.batch
    else:  # last N batches that had at least one commit and are past their reveal window
        commits = rpc.logs(sb, [T_COMMITTED], max(gen, latest - a.lookback), latest)
        ids = sorted({int(l["topics"][1], 16) for l in commits if int(l["topics"][1], 16) <= cur - 2})
        batches = ids[-a.last:]
    if not batches:
        print("no batches")
        return
    frm = gen + min(batches) * w
    topic1 = [batch_topic(b) for b in batches]
    raw = rpc.logs(sb, [[T_REVEALED, T_SETTLED, T_COMMITTED, T_CANCELLED], topic1], frm, latest)
    data = {b: dict(orders=[], commits=0, settled=None, cancelled=False) for b in batches}
    for lg in raw:
        t0, b = lg["topics"][0], int(lg["topics"][1], 16)
        if b not in data:
            continue
        if t0 == T_REVEALED:
            isBuy, qty, tick = words(lg["data"])
            data[b]["orders"].append(dict(owner="0x" + lg["topics"][2][-40:], isBuy=bool(isBuy), qty=qty, tick=tick))
        elif t0 == T_COMMITTED:
            data[b]["commits"] += 1
        elif t0 == T_CANCELLED:
            data[b]["cancelled"] = True
        elif t0 == T_SETTLED:
            data[b]["settled"] = words(lg["data"])
    rows = []
    for b in batches:
        d = data[b]
        if d["commits"] == 0 and d["settled"] is None:
            continue
        r = clear(d["orders"])
        ref = [r["priceTick"], r["volume"], r["rationedSide"], r["marginalTick"], r["rNum"], r["rDen"],
               (d["commits"] - len(d["orders"])) * bond]
        if d["settled"] is not None:
            status = "ok" if d["settled"] == ref else "MISMATCH"
        else:
            status = "cancelled" if d["cancelled"] else "pending"
        rows.append(dict(batch=b, commits=d["commits"], reveals=len(d["orders"]), chain=d["settled"], ref=ref,
                         status=status))
    if a.json:
        print(json.dumps(rows, indent=1))
    else:
        fmt = lambda v: "-" if v is None else f"P={v[0]} V={v[1]/1e18:g} side={v[2]} m={v[3]} r={v[4]/1e18:g}/{v[5]/1e18:g} slash={v[6]/1e18:g}"
        icon = {"ok": "✅", "MISMATCH": "❌", "cancelled": "⏹ cancelled", "pending": "⏳ pending"}
        print(f"{'batch':>6} | {'c/r':>5} | {'chain':<52} | {'ref':<52} |")
        for x in rows:
            print(f"{x['batch']:>6} | {x['commits']:>2}/{x['reveals']:<2} | {fmt(x['chain']):<52} | {fmt(x['ref']):<52} | {icon[x['status']]}")
        ok = sum(x["status"] == "ok" for x in rows)
        bad = sum(x["status"] == "MISMATCH" for x in rows)
        print(f"settled ok={ok} mismatch={bad} other={len(rows) - ok - bad}")
    sys.exit(1 if any(x["status"] == "MISMATCH" for x in rows) else 0)


if __name__ == "__main__":
    main()
