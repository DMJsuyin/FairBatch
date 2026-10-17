#!/usr/bin/env bash
# 一键部署到 Monad 测试网，并把地址写进前端和机器人配置
# 用法：在 ~/sealbatch/.env 写 PRIVATE_KEY=0x...，然后 ./deploy.sh
set -euo pipefail
cd "$(dirname "$0")"
source .env
RPC="${RPC_URL:-https://testnet-rpc.monad.xyz}"
export WINDOW_BLOCKS="${WINDOW_BLOCKS:-16}" TIMEOUT_WINDOWS="${TIMEOUT_WINDOWS:-10}"
cd contracts
OUT=$(~/.foundry/bin/forge script script/Deploy.s.sol --rpc-url "$RPC" --broadcast --private-key "$PRIVATE_KEY" 2>&1)
echo "$OUT" | grep -E "SealBatch|BASE|QUOTE|genesisBlock|Error" || true
SB=$(echo "$OUT" | awk '/SealBatch 0x/{print $2}' | tail -1)
BASE=$(echo "$OUT" | awk '/BASE 0x/{print $2}' | tail -1)
QUOTE=$(echo "$OUT" | awk '/QUOTE 0x/{print $2}' | tail -1)
[ -n "$SB" ] || { echo "部署失败"; exit 1; }
cd ..
cat > deployment.json <<J
{"chainId":10143,"rpcUrl":"$RPC","sealBatch":"$SB","base":"$BASE","quote":"$QUOTE","windowBlocks":$WINDOW_BLOCKS,"timeoutWindows":$TIMEOUT_WINDOWS}
J
echo "已写入 deployment.json：$SB"
