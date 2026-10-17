# FairBatch & Monad CLOB Grid · 链上密封集合竞价与网格交易终端

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-22.12%2B-green.svg)](package.json)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.30-363636.svg)](contracts/)

> **在线演示入口**：
> - **FairBatch 密封集合竞价（主推 `/fairbatch`）**：`https://clob.reallier.com/fairbatch`
> - **CLOB 链上限价订单簿与网格终端（`/`）**：`https://clob.reallier.com/`
> - **详细技术机制与路演文档**：[docs/FairBatch.md](docs/FairBatch.md) ｜ [docs/Protocol-v03.md](docs/Protocol-v03.md)

---

## 1. 项目概述 (Project Overview)

本项目是面向 **Monad 高性能 EVM** 开发的去中心化交易协议与单页交易终端，包含两套独立的链上市场合约与前端交互界面：

1. **FairBatch v0.3 密封集合竞价（路由 `/fairbatch`）**：
   针对薄流动性或集中交易场景下“相同报价因进块先后顺序不同导致成交结果不同”的痛点，采用 **密封承诺（Commit）$\rightarrow$ 自动揭示（Reveal）$\rightarrow$ 统一清算价结算（Settle）$\rightarrow$ 资金领取/退款（Claim）** 四阶段机制。v0.3 引入了**无需信任求解器的排序见证验证（Sorting Witness）**、**EIP-712 签名委托提交**、**可选锁仓向上归档填充**与**最小持久化账本**，在保证链上确定性统一价与资产守恒的前提下，将 32 笔订单完整结算 Gas 降低了 **51.78%**。
2. **CLOB 全链上限价订单簿与意图转网格终端（路由 `/`）**：
   基于 Solidity 实现全链上限价订单簿（价格优先、同价 FIFO），支持限价单、Post-only、IOC、原子批量挂单/撤单/替换，内置**自然语言意图转确定性网格策略**及 **Arena 自动对手盘演示模式**。

---

## 2. 主要功能 (Key Features)

### 2.1 FairBatch 密封集合竞价 (`contracts/FairBatch.sol` & `BatchMath.sol`)
- **密封承诺与防重放保护**：客户端使用浏览器 CSPRNG 生成 32 字节高熵 `salt`，承诺哈希绑定 `DOMAIN ("FairBatch:v0.3")`、`chainId`、合约地址、轮次 ID、用户地址、方向、手数（`lots`）、价格刻度（`ticks`）与 `salt`，杜绝跨链、跨合约、跨轮次重放。
- **确定性统一清算价与最大余数分配**：
  - 买单降序、卖单升序扫描，求取最大可成交量 $V^*$；
  - 取第 $V^*$ 手对应的边际卖价 $L$ 与边际买价 $H$，按固定规则计算同轮唯一清算价：$P^* = L + \lfloor (H - L) / 2 \rfloor$；
  - 价格更优档位 100% 成交，边际同价档按申报数量比例分配整手数，余数通过最大堆按最大余数法（同余数按地址升序决胜）分配，**同一有效订单集的清算结果与提交先后顺序完全无关**。
- **无需信任求解器的排序见证 (`settleWithWitness`)**：
  开放求解器仅提交买卖订单编号序列（每单 1 字节，单轮最多 32 笔），合约在 $O(n)$ 时间内校验位图唯一性、方向一致性、价格/地址有序性与完整性（不漏单），校验通过后由合约双指针扫描清算；若无求解器，任何人仍可直接调用 `settle` 由合约自行排序清算。
- **EIP-712 签名委托与锁仓填充**：支持 `CommitIntent` 签名代发与 ERC-1271 合约钱包校验；支持按 `1/2/4/8...` 档位向上归档锁仓，避免锁仓金额精确暴露真实订单规模。
- **完备异常退出与双实现独立复算**：未揭示或到期未结算轮次可全额退回锁仓本金；前端浏览器与 Python 参考模型（`docs/fairbatch_reference.py`）独立复算供需曲线与每单分配，并与链上 `ClearingVerified` 指纹核对。

### 2.2 CLOB 链上订单簿与网格交易 (`contracts/OrderBook.sol`)
- **全链上订单簿撮合**：支持限价单（GTC）、Post-only、IOC（带最低成交量保护），Maker 价格成交并自动退还买方差价，拒绝自成交。
- **原子批量操作**：支持单笔交易原子批量挂单、批量撤单、取消并替换整组网格订单（每簿最多 128 笔有效挂单，单批最多 16 笔）。
- **意图转网格（Intent-to-Grid）**：支持自然语言规则解析与可选的兼容 OpenAI Chat Completions 接口的大模型解析，结合价格步长、数量步长、买入预算与卖出库存生成确定性网格预览。
- **实时行情与 Arena 演示模式**：实时渲染买卖 10 档聚合深度、由链上 `Trade` 事件聚合的 1 分钟 OHLC K 线、逐笔成交回执与已配对 FIFO 收益；内置 Arena 规则对手盘一键驱动链上真实交易。

---

## 3. 技术栈与目录结构 (Tech Stack & Structure)

### 技术栈
| 层级 | 技术选型 |
| :--- | :--- |
| **智能合约** | Solidity `0.8.30` (Shanghai EVM, `viaIR`, Optimizer 200)、OpenZeppelin Contracts (`5.6.1` / `5.0.2` EIP-712 & ECDSA) |
| **前端应用** | React `19.3`、TypeScript `5.9`、Vite `8.3`、Viem `2.57`、Lucide React、原生 CSS |
| **开发与测试网工具** | Node.js `22.12+`、`tsx`、Node Test Runner、Ganache `7.9` (Local EVM)、Python 3 (独立参考验证模型) |

### 目录结构
```text
monad-clob-grid/
├── contracts/                  # Solidity 智能合约源码
│   ├── FairBatch.sol           # FairBatch v0.3 密封集合竞价核心合约
│   ├── BatchMath.sol           # O(n) 排序见证校验、双指针清算与最大堆余数分配库
│   ├── OrderBook.sol           # 全链上限价订单簿与原子批量网格合约
│   └── DemoToken.sol           # 测试网 ERC-20 代币合约 (dMON / dUSDC，带公开 Faucet)
├── src/                        # 前端源码
│   ├── fairbatch/              # FairBatch (/fairbatch) 页面组件、EIP-712 客户端与独立复算器
│   ├── App.tsx                 # CLOB 网格终端 (/) 主界面
│   ├── MarketChart.tsx         # K 线与深度图组件
│   ├── grid.ts                 # 确定性网格参数分配与区间约束引擎
│   └── analytics.ts            # 链上事件聚合与 FIFO 收益核算
├── scripts/                    # 编译、本地链、部署、便捷服务与基准测试脚本
│   ├── compile.ts              # Solc 编译并输出 ABI/Bytecode 至 artifacts/
│   ├── local.ts                # 启动本地 EVM、部署合约并初始化种子订单
│   ├── serve.ts                # FairBatch 便捷代发服务与受限 RPC 转发
│   ├── deploy.ts               # CLOB 部署至 Monad Testnet 脚本
│   ├── fairbatch-deploy.ts     # FairBatch 部署脚本 (支持 Local / Monad Testnet)
│   ├── fairbatch-benchmark.ts  # v0.2 vs v0.3 Gas 基准对比脚本
│   └── fairbatch-inspect.ts    # 链上清算结果独立复核脚本
├── test/                       # 自动化单元测试与随机对照测试
│   ├── fairbatch.test.ts       # FairBatch 65 组随机订单、见证攻击、EIP-712、边界与守恒测试
│   ├── market.test.ts          # OrderBook 撮合、FIFO、IOC、批量原子性与资金守恒测试
│   ├── grid.test.ts            # 网格分配算法与预算约束测试
│   └── rpc-policy.test.ts      # 公共 RPC 安全白名单与限流策略测试
├── docs/                       # 协议规格、Python 独立参考模型与验证证据数据
│   ├── FairBatch.md            # FairBatch 实现说明与团队交接文档
│   ├── Protocol-v03.md         # FairBatch v0.3 技术机制、攻防问答与五分钟路演稿
│   ├── fairbatch_reference.py  # Python 独立参考清算实现 (10,000 组随机验证)
│   └── public-verification-v03.json # 公网环境链上验收与对账数据
├── deploy/                     # Systemd 线上服务单元配置 (clob-chain.service / clob-web.service)
└── LICENSE                     # MIT 开源许可证
```

---

## 4. 安装与运行步骤 (Installation & Usage)

### 4.1 环境要求
- **Node.js**：`>= 22.12.0`（已在 Node 22 / Node 26 下验证通过）
- **npm**：随 Node.js 附带

### 4.2 安装依赖
```bash
npm ci
```

### 4.3 启动本地完整开发环境

#### 方式 A：运行 FairBatch 密封集合竞价 + CLOB 终端（推荐完整体验）
分别在 3 个终端窗口中运行：
```bash
# 终端 1：启动本地 EVM 链 (127.0.0.1:8545)，自动编译并部署 CLOB 与 FairBatch 合约、播种初始数据
npm run local

# 终端 2：启动 FairBatch 便捷服务与 RPC 转发 (端口 5197)
npm run fairbatch:api

# 终端 3：启动 Vite 前端开发服务器 (http://127.0.0.1:5177)
npm run dev
```
启动后在浏览器访问：
- **FairBatch 密封集合竞价终端**：`http://127.0.0.1:5177/fairbatch`
- **CLOB 网格交易终端**：`http://127.0.0.1:5177/`

### 4.4 编译、测试与基准复核命令
```bash
# 一键执行：编译合约 + 运行全部自动化测试 + 生产前端构建检查
npm run check

# 单独运行合约编译
npm run compile

# 运行全部测试套件 (CLOB + FairBatch + Grid + RPC Policy)
npm test

# 运行 FairBatch v0.2 vs v0.3 Gas 基准对比
npm run fairbatch:benchmark

# 独立复核公网链上清算数据
npm run fairbatch:verify -- docs/public-verification-v03.json
```

### 4.5 可选 AI 模型配置（仅用于 CLOB 意图解析）
如需启用大模型自然语言解析（未配置时默认使用确定性规则解析，不影响任何核心交易功能）：
1. 在项目根目录创建 `.env.local`，配置兼容 OpenAI Chat Completions 的接口地址、模型名称与服务端 API Key；
2. 重启 `npm run dev`，在 `/` 页面点击「AI 解析」即可（API Key 仅保留在本地开发服务端，不打包进前端构建产物）。

---

## 5. 演示账号与在线体验说明 (Demo Accounts & Walkthrough)

本项目**免注册、免登录**，内置**一键测试钱包生成与水龙头（Faucet）初始化**，无需预先准备私钥或助记词即可完整体验：

1. **在线演示地址**：
   - FairBatch：`https://clob.reallier.com/fairbatch`
   - CLOB 网格：`https://clob.reallier.com/`
2. **一键获取演示账号**：
   - 在 **CLOB (`/`)** 页面点击顶部 **「使用测试钱包，开始交易」**：浏览器会在当前会话自动生成本地签名私钥，并自动发放测试 Gas 与初始测试代币（`dMON` / `dUSDC`）。随后点击「规则解析」$\rightarrow$「签名并挂出」即可一键铺设 8 档链上网格单，点击「Arena」即可触发对手盘自动吃单成交。
   - 在 **FairBatch (`/fairbatch`)** 页面：可直接使用内置测试钱包或连接自有浏览器 EVM 钱包（如 MetaMask），一键开启新轮次、选择限价与数量（支持勾选向上归档填充锁仓）并签名提交；支持随时导出/导入揭示凭据、切换 6 种订单到达顺序查看机制对照，以及点击「验证漏单攻击」直观查看合约对残缺排序见证的链上回滚校验。

---

## 6. 部署方式 (Deployment Guide)

### 6.1 部署至 Monad Testnet (`chainId: 10143`)

1. **部署 CLOB 订单簿与测试代币**：
   准备一个已领取 Monad 测试网 `MON` 的独立部署账户，在环境变量中设置 `DEPLOYER_PRIVATE_KEY`（可选设置 `MONAD_RPC_URL`，默认使用官方测试网 RPC）：
   ```bash
   export DEPLOYER_PRIVATE_KEY=0x你的测试网部署私钥
   npm run deploy:testnet
   npm run build
   ```
   脚本会强制校验 `chainId === 10143`，部署 `dMON`、`dUSDC` 与 `OrderBook` 合约，并将合约地址写入 `deployments/monad-testnet.json`。

2. **部署 FairBatch 密封集合竞价合约至 Monad Testnet**：
   ```bash
   npm run fairbatch:testnet
   ```
   该命令从本机 `.local/fairbatch-testnet-wallet.json` 读取部署账户（首次运行若不存在会自动生成并提示充值测试 MON，该文件仅保存在本机，不进入代码仓库），部署完成后输出清单至 `public/fairbatch-testnet.json`。

### 6.2 线上服务器与 Cloudflare Tunnel 部署（Systemd）

项目在 `deploy/` 目录下提供了生产演示环境所需的 Systemd 服务配置（[`deploy/clob-chain.service`](deploy/clob-chain.service) 与 [`deploy/clob-web.service`](deploy/clob-web.service)）：

```bash
# 1. 在服务器目录 (如 /data/app-stacks/monad-clob-grid) 安装依赖并构建前端
npm ci
npm run build

# 2. 安装并启动 Systemd 服务
sudo cp deploy/clob-chain.service deploy/clob-web.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now clob-chain clob-web

# 3. 查看运行状态与健康检查
curl http://127.0.0.1:5187/health
journalctl -u clob-chain -u clob-web -f
```
- **`clob-chain`**：在 `127.0.0.1:8547` 运行本地演示 EVM 节点，启动时自动编译、部署合约并播种初始深度。
- **`clob-web`**：提供前端静态资源、受白名单与速率限制保护的 `/rpc` 转发（禁止解锁账户与管理方法，仅放行目标合约的客户端签名交易）以及测试水龙头/对手盘接口。

---

## 7. 实现边界与安全说明 (Limitations & Security Assumptions)

- **诚实隐私边界**：FairBatch 的哈希承诺（Commit Hash）不是零知识加密；揭示阶段后订单原文即公开。可选锁仓填充用于模糊订单精确规模，但交易方向与钱包地址仍链上可见，不宣称“全隐私暗池”或“彻底消除一切 MEV”。
- **未揭示退回策略**：当前 `FairBatch.sol` 对未揭示订单不实施罚没，揭示截止后可退回本金，因此不宣称消除“选择性不揭示（免费期权）”博弈。
- **有界容量与精度**：
  - `FairBatch`：单轮最多接纳 32 个地址（每地址每轮 1 单）；`1 lot = 0.01 dMON`，`1 tick = 0.01 dUSDC / dMON`。
  - `OrderBook`：每簿最多 128 笔有效挂单，单次批量挂单最多 16 笔，单笔吃单最多匹配 32 个 Maker；价格 Tick 为 `0.01 dUSDC / dMON`，数量 Lot 为 `0.01 dMON`。
- **代币支持范围**：仅支持标准、精确到账且无转账税/弹性供应（Non-rebasing）的 ERC-20 代币；所有测试代币均无任何真实货币价值。

---

## 8. 许可证信息 (License)

本项目基于 **[MIT License](LICENSE)** 开源许可发布。详情请参阅仓库根目录下的 [LICENSE](LICENSE) 文件。
