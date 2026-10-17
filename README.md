# FairBatch — Monad 密封集合竞价与全链意图网格双引擎终端

> **线上实盘演示**：
> - **机制 02 · FairBatch 密封统一清算价集合竞价（Monad Testnet 10143）**：https://clob.reallier.com/fairbatch
> - **机制 01 · 全链连续限价订单簿 CLOB + AI 意图网格（对照终端）**：https://clob.reallier.com/
> - **协议规范与路演底稿**：[docs/Protocol-v03.md](docs/Protocol-v03.md) ｜ **Monad 运维手册**：[docs/Monad-Runbook.md](docs/Monad-Runbook.md) ｜ **交付记录**：[docs/Release-20261017.md](docs/Release-20261017.md)

FairBatch 是一套面向 **Monad (Chain ID: `10143`)** 构建的机构级全链交易与清算终端。项目在同一套单屏终端内提供 **「连续限价订单簿 (CLOB) + AI 意图原子网格」** 与 **「密封统一清算价集合竞价 (FairBatch v0.3)」** 双引擎同台对照，直击链上薄流动性市场中的 **PGA 排序抢跑（MEV Front-running）** 与 **高额链上排序 Gas 开销** 两大核心痛点。

---

## 一、 Monad Testnet (`10143`) 链上部署与公网实测证据

| 证据项 | 链上详情 / 仓库核验路径 |
|---|---|
| **部署网络** | **Monad Testnet**（Chain ID: `10143`，RPC: `https://testnet-rpc.monad.xyz`） |
| **FairBatch 核心合约** | `0x10886f059743e61585e4c762b459a9ecdcb61343`（配置见 [`public/fairbatch.json`](public/fairbatch.json)） |
| **测试资产合约** | `dMON` (`0x6b272a040e55792b6c2276d2e5c1f639f401a387`) / `dUSDC` (`0x1b37fb22607c954dc793fa5ca38f48c0a89df743`) |
| **公网第 4 轮用户委托承诺 Tx** | `0x6e590d7e5b1d21979af715c38bb63579019f3f3154061a70f98fba2e982fce2e`（Block `71758413`，EIP-712 委托密封下单，锁仓填充 8 dUSDC） |
| **公网第 4 轮见证清算 Tx** | `0x547adcbc01fd86b35e62166b392bf22f7c1352750d175b98e4508f10f5f9f860`（Block `71758701`，`ClearingVerified`，统一价 `1.00 dUSDC`，成交 `16.00 dMON`） |
| **链上资产守恒与独立复核** | [`docs/monad-public-verification.json`](docs/monad-public-verification.json)：5 笔订单全部到账 + 差价/超额锁仓精确退还，`baseLiability = 0`、`quoteLiability = 0`、`solvent = true` |
| **Gas 压测对比报告** | [`docs/protocol-benchmark.json`](docs/protocol-benchmark.json)（由 [`scripts/fairbatch-benchmark.ts`](scripts/fairbatch-benchmark.ts) 实测生成） |
| **自动化测试套件（35 项全通过）** | [`test/fairbatch.test.ts`](test/fairbatch.test.ts)、[`test/fairbatch-service.test.ts`](test/fairbatch-service.test.ts)、[`test/market.test.ts`](test/market.test.ts)、[`test/grid.test.ts`](test/grid.test.ts) 等共 8 个测试文件 |

---

## 二、 Why Monad：针对 Monad 底层执行与计费特性的原生设计

本项目并非简单将以太坊合约迁移至 Monad RPC，而是针对 **Monad 异步执行、Gas 计费规则、状态访问定价及储备余额机制** 做了深度协议适配：

1. **消除 Monad 默认 PGA（优先 Gas 拍卖）下的同块排序抢跑**：
   - Monad 客户端默认按总 Gas 价格降序排列交易（Priority Gas Auction）。在 400ms 极速出块下，传统连续订单簿（CLOB）中同一组订单仅因入块顺序不同，成交价与买方归属就会发生剧烈偏移（见终端内置 6 种到达顺序 `3! = 6` 同屏对照实验）。
   - **FairBatch 机制**：将报价收进固定窗口，通过 `keccak256("FairBatch:v0.3", chainId, contract, round, owner, isBuy, lots, ticks, salt)` 密封承诺与可选 2 的幂次锁仓填充（Escrow Padding）隐藏真实需求；揭示后按供需曲线最大交集手数 $V^*$ 与边际价格中点 $P^* = \lfloor(L + H)/2\rfloor$ 统一清算，**6 种到达顺序 100% 收敛至同一公平价格**。
2. **适配 Monad「按 `gas_limit` 收费」与「冷存储 `SLOAD` 8,100 gas」成本结构（结算 Gas 降低 51.78%）**：
   - Monad 因异步执行按交易设置的 **`gas_limit`（而非实际消耗 `gas_used`）** 收费，且冷存储访问（`8,100 gas`）是以太坊的近 4 倍、`ecRecover`（`6,000 gas`）为 2 倍。若在链上执行复杂的订单排序与冗余存储写入，会导致 `gas_limit` 膨胀，用户直接多付 MON。
   - **v0.3 见证式清算 (`settleWithWitness`)**：将排序计算外包给无特权求解器，求解器仅提交 1 字节/单的紧凑索引字节串；合约在链上通过 **O(n) 位图（Bitmap）** 校验完整性（`seen == expected`，漏单/重单立即 Revert）、方向与单调性，并采用**最小持久化账本**（仅写成交量 `fillLots`，实时推导应收 base/quote）。
   - **实测证据（[`docs/protocol-benchmark.json`](docs/protocol-benchmark.json)）**：32 笔逆序订单完整清算 Gas 从 v0.2 链上排序的 `2,566,288` 降至 v0.3 见证清算的 **`1,237,340`（节省 51.78%）**，纯计算阶段最高节省 **45.52%**；同时前端针对 Monad `10143` 将 `estimateGas` 安全缓冲严格收紧至 **`+10%`**，避免用户因虚高 `gas_limit` 多付费用。
3. **兼容 Monad 10 MON Reserve Balance（储备余额限制）**：
   - Monad 对余额低于 10 MON 的 EOA 限制每 3 个区块（约 1.2 秒）仅能发送 1 笔交易。
   - 在 **CLOB 引擎** 中，用户通过自然语言/AI 生成 8 档网格后由 `batchPlaceOrders` / `replaceOrders` **单笔交易原子挂出**；在 **FairBatch 引擎** 中，用户通过 **EIP-712 (`CommitIntent`) 签名委托代发**（支持 EOA 与 ERC-1271 合约钱包），无需连续发送多笔交易即可完成整轮竞价与自动清算到账。

---

## 三、 核心架构与代码索引

| 模块 | 关键源码路径 | 核心实现与验证 |
|---|---|---|
| **FairBatch 密封竞价合约** | [`contracts/FairBatch.sol`](contracts/FairBatch.sol)、[`contracts/BatchMath.sol`](contracts/BatchMath.sol) | Commit-Reveal、EIP-712 + ERC-1271 签名代发、O(n) 位图见证校验、双指针最大成交量 + 最大堆 Pro-Rata 余数分配、无许可超时自救 |
| **CLOB 全链订单簿合约** | [`contracts/OrderBook.sol`](contracts/OrderBook.sol)、[`contracts/DemoToken.sol`](contracts/DemoToken.sol) | 价格-时间优先（FIFO）、Maker 价格成交与买方差价退还、Post-only / IOC / MinFill、原子批量挂单与替换 |
| **前端双引擎交易终端** | [`src/App.tsx`](src/App.tsx)、[`src/fairbatch/App.tsx`](src/fairbatch/App.tsx)、[`src/components/`](src/components) | 100dvh 机构级单屏三栏终端、O(n log n) 供需阶梯曲线、6 种顺序同屏对照、恶意 Solver 漏单回滚实时验证、双算法浏览器独立复核 |
| **独立参考清算与网格算法** | [`src/fairbatch/protocol.ts`](src/fairbatch/protocol.ts)、[`src/grid.ts`](src/grid.ts)、[`src/analytics.ts`](src/analytics.ts) | 浏览器独立离散价格枚举清算引擎（与合约双指针交叉复核）、确定性整数预算网格分配、FIFO 已实现盈亏计算 |
| **Monad 签名服务与压测** | [`scripts/fairbatch-service.ts`](scripts/fairbatch-service.ts)、[`scripts/fairbatch-benchmark.ts`](scripts/fairbatch-benchmark.ts)、[`scripts/serve.ts`](scripts/serve.ts) | Monad Testnet 10143 真实私钥签名中继与 Keeper 自动揭示/清算、v0.2 vs v0.3 Gas 基准压测、DeepSeek Flash 意图解析代理与 RPC 安全白名单 |

---

## 四、 快速运行与独立复核

需要 Node.js 22.12+（已用 Node 26 验证）。

```sh
# 1. 安装依赖
npm ci

# 2. 编译合约并运行全部 35 项单元与集成测试（含全排列不变性穷举、恶意见证回滚、Chain 10143 签名闭环）
npm test

# 3. 复现 v0.2 vs v0.3 见证清算 Gas 压测报告
npm run fairbatch:benchmark

# 4. 独立复核 Monad Testnet (10143) 公网第 4 轮链上清算与偿付能力
npm run fairbatch:verify -- docs/monad-public-verification.json

# 5. 构建生产前端
npm run build
```

### 本地开发环境启动

```sh
npm run local  # 终端 1：启动本地演示链、部署 CLOB 与 FairBatch 合约并注入初始种子深度
npm run dev    # 终端 2：启动前端开发服务器 (http://127.0.0.1:5177)
```

- 访问 `http://127.0.0.1:5177/fairbatch` 体验 **密封集合竞价 · FairBatch**；
- 访问 `http://127.0.0.1:5177/` 体验 **连续订单簿 · AI 意图网格**。

### 部署至 Monad Testnet (`10143`)

准备持有测试网 MON 的部署私钥（勿提交入库），执行：

```sh
DEPLOYER_PRIVATE_KEY=0x... npm run fairbatch:deploy:testnet
DEPLOYER_PRIVATE_KEY=0x... npm run deploy:testnet
npm run build
```

脚本会强制校验 Chain ID **`10143`**，部署测试代币与核心合约，并输出公开清单与验证记录。详细运维与公网复现步骤见 [docs/Monad-Runbook.md](docs/Monad-Runbook.md) 与 [docs/Protocol-v03.md](docs/Protocol-v03.md)。
