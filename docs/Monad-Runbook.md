# FairBatch：Monad 运行与体验闭环

## 当前架构

FairBatch `/fairbatch` 使用 Monad Testnet（10143）；CLOB `/` 保留独立的 Local EVM（31337）作为机制对照。两者的余额与合约不互通。AI 网格解析继续使用 Server 78 的 DeepSeek Flash。

- FairBatch：`0x10886f059743e61585e4c762b459a9ecdcb61343`
- dMON：`0x0ae51f8a0ccf83e116565dbf152ca0a1e69edca8`
- dUSDC：`0x28e57a47993bda6ad1eaa89ea48b58e0978a8812`
- 每轮：60 秒提交、60 秒揭示、120 秒清算宽限。
- 测试代币由各自 faucet() 领取；原生 MON 用于 Gas。

## 服务配置

`clob-web` 额外读取 `.local/fairbatch-runtime.env`，保持 `.local/intent-model.env` 不变：

```dotenv
FAIRBATCH_MANIFEST=public/fairbatch-testnet.json
FAIRBATCH_RPC=https://testnet-rpc.monad.xyz
FAIRBATCH_SIGNER_FILE=.local/fairbatch-testnet-wallet.json
FAIRBATCH_BOTS_FILE=.local/fairbatch-testnet-bots.json
FAIRBATCH_STATE_FILE=.local/fairbatch-testnet-service.json
```

签名文件只留在本机及 78 的 `.local/`，权限 0600，不放入源码包。生成的公开 manifest 可以随部署分发。

服务不再依赖 Monad 不支持的 `eth_accounts`、`evm_mine`。四个对手盘分别持有测试资产与签名密钥，使用 EIP-712 授权代发者提交；Gas 集中由中继钱包支付。用户凭据只在揭示期提交，服务不提前收集用户明文报价。对手盘每提交一笔就让出代发队列，用户请求可穿插执行；Gas、nonce 与估算并发批量读取，私钥本地签名后直接广播，减少远程 RPC 往返。

Keeper 持久化对手盘揭示凭据和待处理轮次，重启后继续揭示、清算、领取。清算使用排序见证，合约自行验证、定价、分配。服务不可用时，可勾选「钱包直接提交」，自行揭示、清算、领取或在超时后退款。

用户首次准备资产时可申请一次有限额度的测试 Gas 赞助；服务按地址和每日总额度记账，保留清算资金。不需要重复领取资产或授权的已有钱包无需重复申请 Gas。MON 不足时使用官方水龙头；这不改变合约的无许可操作能力。

## 迁移和重跑

```sh
npm ci
npm run compile
npm run fairbatch:testnet
npm test
npm run build
```

部署脚本检查链 ID，并把交易哈希、部署地址和构造参数指纹写入 `.local/fairbatch-deploy-10143.json`。重新运行复用已部署合约，继续未完成的对手盘准备。更换协议或构造参数需显式使用新 checkpoint，不能默默混用。

在测试网 E2E 前确保原生测试 MON 足够。可向开发者水龙头 `https://agents.devnads.com/v1/faucet` POST `{"chainId":10143,"address":"部署钱包公开地址"}`；以交易收据确认到账。不要上传私钥。

```sh
FAIRBATCH_ORIGIN=https://clob.reallier.com npm run fairbatch:smoke
```

该检查只接受 10143，会实际使用测试资产：准备钱包 → 开轮 → 签名承诺 → 揭示 → 等待 Keeper 清算 → 验证五单领取、买单收到 5 dMON + 3 dUSDC 退款、两种资产负债归零。结果保存到 `docs/monad-verification.json`。运行时应避免其他人向同一轮提交订单，因脚本预期的是固定五单场景。

## 图表与首次体验

- 供需图按实际报价断点排序；买单在限价后一 tick 退出，卖单在限价处进入。复杂度 O(n log n)，绘图点数 O(n)，与价格跨度无关。
- 先准备钱包、Gas、测试资产和授权，再开启短窗口。已结算、已封盘、历史轮次分别显示可执行的下一步。
- 结果卡明确区分「可领」与「已到账」，同时列出成交资产、退款以及原因。买单退款拆为未成交部分、成交价差、额外锁仓；卖单退款为未售出资产和额外锁仓。
- 测试覆盖小区间逐价对照、十亿 tick 跨度、阶段动作与退款分解守恒。

## Monad 适配实测

小额测试钱包在本次公共 RPC 上使用默认 EIP-1559 费用时出现余额不足拒绝，显式 legacy gasPrice 成功。测试网合约写入采用实测可用格式。原生 MON 转账需等待前笔发送交易离开异步执行窗口，避免 reserve-balance 规则导致充值交易回滚；参考 https://docs.monad.xyz/developer-essentials/reserve-balance 。

不要把旧的本地 EVM Gas 基准称为 Monad TPS 基准。当前合约没有修改算法、手续费或清算规则，本轮主要补齐运行链路、图表性能与产品体验。
