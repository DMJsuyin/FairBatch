# SealBatch bots + reference checker

Node 18+ (ESM, viem) bots in `bots/`, pure-stdlib Python reference in `ref/`.
Run everything from the repo root `sealbatch/` unless noted.

```bash
cd bots && https_proxy=http://127.0.0.1:7897 http_proxy=http://127.0.0.1:7897 npm install   # once
```

## Env

| var | meaning | default |
|---|---|---|
| `RPC_URL` | JSON-RPC | `http://127.0.0.1:8545` |
| `CHAIN_ID` | chain id (Monad testnet = 10143) | `31337` |
| `SB` | SealBatch address | required |
| `FUNDER_PK` | funds bots with MON; bot keys derive from it: `keccak256(FUNDER_PK ‖ uint256(i))` | required |
| `KEEPER_PK` | keeper signer | `FUNDER_PK` |
| `BOT_COUNT` | trader bots | `8` |
| `MID_TICK` | center of the random-walk mid price (tick 20 = 100 SUSD) | `20` |
| `GRIEFERS` | first N bots commit but never reveal | `0` |
| `BOT_MON` | MON per bot (topped up if below half) | `0.3` |
| `POLL_MS` | block poll interval (min 300) | `300` |
| `LOG_CHUNK` | eth_getLogs block range per request | `100` |
| `KEEPER_LOOKBACK` | keeper scans at most this many blocks back on start | `3000` |

All RPC calls retry with exponential backoff (viem: 6 retries, 400ms·2ⁿ, covers 429/5xx/network).
Txs use explicit gas limits + a local per-account nonce counter (no estimation → no nonce gaps when sending concurrently).

## Local (anvil)

```bash
~/.foundry/bin/anvil --block-time 1 --port 8545 &
cd contracts && WINDOW_BLOCKS=4 TIMEOUT_WINDOWS=3 ~/.foundry/bin/forge script script/Deploy.s.sol \
  --rpc-url http://127.0.0.1:8545 --broadcast \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 && cd ..
export SB=0x5FbDB2315678afecb367f032d93F642f64180aa3   # printed by Deploy ("SealBatch ...")
export FUNDER_PK=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 GRIEFERS=1
```

## Monad testnet

```bash
export RPC_URL=https://testnet-rpc.monad.xyz CHAIN_ID=10143 SB=0x... FUNDER_PK=0x... GRIEFERS=1
# deployed with WINDOW_BLOCKS=16 (≈5 s windows at 0.31 s blocks)
```

## Run

```bash
cd bots
node fund.mjs                 # send MON to bots + onboard(address(0)) → 10 SBA + 1000 SUSD each (10-min faucet cooldown)
node traders.mjs              # long-running: commit in window k, reveal in k+1 (griefers never reveal)
node keeper.mjs               # long-running: settle (phase 2) / cancel (phase 3) / claim every committer
node keeper.mjs --once        # single pass
node keeper.mjs --from 123456 # scan Committed logs from a given block
```

Each bot commits only when its vault is free again (commit locks the whole vault until the keeper claims),
so a bot trades every ~3 windows. Traders + keeper must both run.

**Demo "keeper down" / timeout:** stop the keeper (Ctrl-C, or `node keeper.mjs --pause` which just exits).
Batches then stay unsettled; after `timeoutWindows` windows past reveal they reach phase 3 and anyone can
`cancel()` → everyone gets a full refund including bond. Restarting the keeper cancels + claims them.

## Scenarios (pitch demos — stop traders AND keeper first)

Own wallets (bot index 100+), funded automatically. Each prints tx hashes, chain result, Python-ref result, claims.

```bash
node scenario.mjs normal   # 甲 buy 2@22, 乙 buy 1@20, 丙 sell 3@18 → one price 99 SUSD (tick 18), V=3, == ref
node scenario.mjs reorder  # same orders forward vs. reversed commit+reveal order → identical Settled tuple
node scenario.mjs grief    # 丙 commits, never reveals → slashPool=1 SUSD, 甲/乙 each +0.5 SUSD in previewClaim
node scenario.mjs timeout  # commit+reveal, no settle → phase 3 → cancel → vault exactly restored (bond back)
node scenario.mjs all
```

(`timeout` waits `timeoutWindows+1` windows: ~20 s locally with 4-block windows / 3 timeout windows.)

## Reference checker

```bash
python3 -I ref/test_clearing.py                                   # unit + 2000-case fuzz
python3 -I ref/verify_chain.py --rpc $RPC_URL --sb $SB --last 20  # last 20 batches with commits
python3 -I ref/verify_chain.py --rpc $RPC_URL --sb $SB --batch 470 482 --json
```

`verify_chain.py` fetches Committed/Revealed/Settled/Cancelled logs (≤100-block chunks, retry/backoff),
recomputes clearing with `ref/clearing.py` (written independently from the spec) and prints
`batch | commits/reveals | chain | ref | ✅/❌` (slashPool checked too). Exit code 1 on any mismatch.
On Monad increase `--lookback` (default 3000 blocks ≈ 15 min) to look further back.
