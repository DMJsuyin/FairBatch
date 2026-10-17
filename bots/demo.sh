#!/usr/bin/env bash
# 路演前启动：给机器人发 gas → 后台跑 8 个交易机器人（1 个弃标者）+ keeper
# 停止：./demo.sh stop
set -euo pipefail
cd "$(dirname "$0")"
if [ "${1:-}" = "stop" ]; then pkill -f "node traders.mjs" || true; pkill -f "node keeper.mjs" || true; echo stopped; exit 0; fi
D=../deployment.json
export RPC_URL=$(python3 -I -c "import json;print(json.load(open('$D'))['rpcUrl'])")
export SB=$(python3 -I -c "import json;print(json.load(open('$D'))['sealBatch'])")
export CHAIN_ID=10143 FUNDER_PK=$(grep PRIVATE_KEY ../.env | cut -d= -f2) GRIEFERS=${GRIEFERS:-1}
node fund.mjs
nohup node traders.mjs > /tmp/sb_traders.log 2>&1 &
nohup node keeper.mjs > /tmp/sb_keeper.log 2>&1 &
echo "traders + keeper 已在后台运行；日志 /tmp/sb_traders.log /tmp/sb_keeper.log"
