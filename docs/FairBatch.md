# FairBatch 实现与团队接续

当前协议 v0.3，算法与密码学的完整说明及五分钟路演稿见 [Protocol-v03.md](Protocol-v03.md)。


## 现在做成了什么

聚焦薄流动性市场中的「报价相同、到达顺序不同，成交结果却不同」。产品让用户只提交限价与数量，在一个短窗口里汇集订单后，统一确定成交价格和分配结果。

交易页面 `/fairbatch`，原有 CLOB 保留在 `/`，两个市场使用不同合约。用户可用测试钱包，也可连接自己的 EVM 钱包。主流程是密封提交 → 自动揭示 → 合约统一清算 → 成交资产与退款到账。可导出、导入揭示凭据，查看历史轮次和供需曲线，切换六种顺序看机制对照。

## 合约与算法

- `contracts/FairBatch.sol`：承诺、锁仓、揭示、结算、领取、过期退款；没有管理员提款或升级入口。
- `contracts/BatchMath.sol`：支持 O(n) 排序见证验证与 O(n log n) 最坏分配，保留链上排序备用路径；单轮最多 32 个地址，每个地址一单；单位均为整数。
- 1 lot = 0.01 dMON，1 tick = 0.01 dUSDC / dMON。因此 quote 金额 = lots × ticks × 100（dUSDC 为 6 位小数）。
- 买单降序、卖单升序扫描，计算最大可成交量 V*。
- 取第 V* 手的边际卖价 L、边际买价 H，统一价 P* = L + floor((H−L)/2)。无成交时 P*=0。
- 价格优先；边际同价订单按数量分配整手数。剩余手数按最大余数分配，相同余数按 owner 地址升序决胜。
- 哈希包含 domain、chainId、合约地址、轮次、owner、方向、数量、限价与 32 字节盐。不能跨链、跨合约、跨轮次重放。
- 买方最低锁 lots×limit×100，卖方最低锁 lots×1e16；可选择向上归档填充锁仓。成交后按实际统一价计算退款。
- settle 仅写入成交量与轮次结果，应收金额在合约内按需推导，不转币；claimFor / claimMany 只能付给订单 owner。转账错误不会回滚已经单独完成的 settle。
- commit 60 秒，reveal 60 秒，settle grace 120 秒；端点均为半开区间。到期后只能退款。
- 未揭示订单不参与清算，在揭示截止后可全额退款；没有实施罚没。不要把当前版本讲成可以消除选择性不揭示博弈。

## 自动化与去中心化路径

`fairbatch-service.ts` 是可替代的便捷服务。它可帮用户发 EIP-712 签名授权的 commitFor、revealFor、settleWithWitness、claimFor，使用合约检查过的参数。用户密封提交时不上传明文；浏览器到揭示阶段才把凭据交给服务。服务只掌握自己的四个对手盘订单凭据。

前端直接读合约。便捷服务不可用时，连接的钱包可直接调用相同函数。到期不依赖服务，可直接 claimFor。Local EVM 的后台会定期挖空块，让倒计时运行；Monad 公链无需这一步。

## 产品叙事

五分钟演示先讲一个具体冲突：A 最高愿付 110，B 最低愿收 90，C 最高愿付 100。每人 1 单位，六种到达顺序下连续撮合会出现不同价格与买方；相同完整订单集的 FairBatch 始终让 A/B 以 100 成交。然后现场开一轮、下单、展示自动揭示、统一成交与原路退款。

准确表述：密封限价而非全隐私；同一有效订单集顺序无关，而非任何博弈策略都无影响；单市场有界清算，而非宣称本合约已经证明 Monad 并行吞吐。方向与抵押金额始终可见。对手盘在列表明确标注。

## 本地运行

Node 22+，npm ci 后：

```sh
# 终端 1：启动 EVM，编译并部署 CLOB + FairBatch
npm run local
# 终端 2：便捷服务 / RPC 转发
npm run fairbatch:api
# 终端 3：开发前端
npm run dev
```

打开 http://127.0.0.1:5177/fairbatch 。如本地链已运行，`npm run fairbatch:deploy` 单独部署新批量市场。已有链无需重启。

## 验证与测试网部署

`npm run compile && npm test && npm run build`。FairBatch 专项：`node --import tsx --test test/fairbatch.test.ts`。专项测试需先 compile。

65 组随机订单用独立整数价格穷举 oracle 检查最大成交量，反向排列逐单检查分配不变；另测最大参数、同价比例/余数、错误盐、重复提交、跨轮次哈希、时间端点、提前退款、超时退款及逐资产守恒。Python 参考实现及 10,000 组随机验证报告见本目录；它与链上测试是两个不同证据层。

测试网命令 `npm run fairbatch:testnet` 从本机 `.local/fairbatch-testnet-wallet.json` 读取部署账户；首次运行自动生成。文件格式为 address/privateKey，仅保存本机，不入代码包。输出 `public/fairbatch-testnet.json`。目标 chainId=10143。尚未获得测试 MON 时不能把 Local EVM 成交描述为 Monad 公链成交。

当前公开网址 https://clob.reallier.com/fairbatch 由 Server 78 提供，Cloudflare 代理；网络以 `/fairbatch.json` 返回为准。代码包包含源代码和可复算材料，不含私钥、node_modules、运行时账本。

旧版计算基准（新旧完整比较见 protocol-benchmark.json）：32 笔订单、同价、最大数量/价格参数，`compute` 调用估算为 159,558 gas（Local EVM，solc 0.8.30）。此数值包含调用输入，不包含 settle 的写入账本开销，不能据此宣称真实主网 TPS。见 `clearing-gas.json`。

## v0.2 历史公网验收记录

Server 78 / chainId 31337，第 2 轮 5 笔订单全部揭示、清算并到账。总成交 16 dMON，统一价 1.00 dUSDC。用户买入 5 dMON（限价 1.03），收到 5 dMON 与 0.15 dUSDC 退款；结算完成后两种资产 liability 均为零。完整可复算数据见 `public-verification.json`。

## v0.3 接续提示

签名委托、排序见证与最小账本已实现，验收入口为 `docs/Protocol-v03.md`。新旧完整 Gas 对照见 `docs/protocol-benchmark.json`。部署必须切换新合约，旧合约不可升级，迁移前先确认旧市场已完成领取。

Linux 安装说明：Ganache 发布包里的嵌套 fsevents 是 Chokidar 的可选 macOS 依赖。锁文件保留其 `optional: true`，使 `npm ci` 在 Linux 正常跳过，勿用 macOS npm 安装后生成的错误 extraneous 标记覆盖它。

## v0.3 本次公网验收

新合约 `0x6c79e58f893daba460823c54307baa45e998df19`，chainId 31337。第 1 轮 5 笔全部揭示并领取，成交总量 16 dMON、统一价 1.00。测试买单以 EIP-712 委托提交，锁仓填充到 8 dUSDC；收到 5 dMON 与 3 dUSDC 退款。链上 `IntentExecuted` 和 `ClearingVerified(usedWitness=true)` 事件均已核验，独立结果哈希一致，两种 liability 为零。见 `public-verification-v03.json`。


## Monad 运行闭环（2026-10-17）

以上 Local EVM 记录保留作历史基准。当前公网 FairBatch 已切至 Monad Testnet（10143），合约 `0x10886f059743e61585e4c762b459a9ecdcb61343`；第 2 轮五单全部揭示、清算、领取，买单收到 5 dMON + 3 dUSDC 退款，负债归零。服务、图表与体验交接见 `Monad-Runbook.md`，实际链上记录见 `monad-verification.json`。
