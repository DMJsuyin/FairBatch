> 新增 FairBatch 密封集合竞价：页面 `/fairbatch`，实现说明、算法、验证与启动命令见 [docs/FairBatch.md](docs/FairBatch.md)。原 CLOB 保留在 `/`。

# CLOB / Grid · Monad 链上网格交易终端

Solidity 全链限价订单簿 + 单页交易终端 + 意图转网格。无登录，钱包签名，链上撮合和资金结算。面向 Monad 黑客松的交易应用。当前站点连接 Local Testnet；Monad Testnet 部署脚本见下文。

## 快速运行

需要 Node.js 22.12+（已用 Node 26 验证）。

```sh
npm ci
npm run local  # 保持运行：本地链、部署、测试资金与真实链上种子成交
```

另开终端：

```sh
npm run dev
```

打开 http://127.0.0.1:5177 ，点「使用测试钱包，开始交易」→「规则解析」→检查八档价格与数量→「签名并挂出」。在「我的挂单」撤单；「手动交易」支持限价和带价格保护的 IOC 吃单；「充值 / 提取」管理合约余额。Arena 每轮最多执行 20 笔真实本地交易，由规则驱动的对手盘提供成交。

```sh
npm test       # 资金守恒、FIFO、部分成交、批量原子性、边界与网格约束
npm run build  # TypeScript + 生产前端
```

## 已实现

- 价格优先、同价 FIFO，maker 价格成交，买方差价退款。
- 限价 / Post-only / IOC / 最低成交量；拒绝自成交。
- 原子批量挂单、批量撤单、取消并替换整组订单。
- 合约充值、提现；无管理员、无升级入口、无链下撮合依赖。
- 10 档聚合深度、由 Trade 事件生成的 1 分钟 OHLC、逐笔成交及交易回执。
- 确定性网格分配：价格步长、数量步长、买入预算、卖出库存与区间约束。
- 自然语言规则解析，以及可选的兼容 Chat Completions 接口的大模型解析。两者明确区分。
- 已配对买卖的 FIFO 收益，排除未知外部库存成本，未扣 Gas。

## AI 配置（可选）

复制 `.env.example` 为 `.env.local`，配置模型地址与名称，必要时填服务端密钥，重启开发服务器。页面点「AI 解析」。未配置时可使用规则解析。模型输出仍需经过范围校验、用户预览与钱包签名。密钥不进入前端构建。

AI 代理仅为本地开发服务器端点。静态站点部署可继续使用规则解析；若要线上 AI，需要自行部署受限的模型代理。合约交易不依赖模型。

## Monad 测试网

使用独立、已领取测试 MON 的部署钱包。在本机环境设置 `DEPLOYER_PRIVATE_KEY`，不要提交或粘贴私钥。可通过 `MONAD_RPC_URL` 指定 RPC。

```sh
npm run deploy:testnet
npm run build
```

脚本会强制检查 chain ID **10143**，部署两种无价值测试币和订单簿，将公开地址写入 `deployments/monad-testnet.json` 与前端配置。连接浏览器钱包后领取测试代币、授权并充值即可下单。当前测试网脚本使用钱包签名；快捷测试钱包与 Arena 对手盘目前在 Local Testnet 提供。

官方网络说明：https://docs.monad.xyz/developer-essentials/testnet

## 实现边界与安全假设

- 每个市场独立合约；同一市场仍有共享状态竞争。批量挂单是一笔原子交易，不代表 EVM 内部并行。
- 原型每簿最多 128 笔有效挂单，批次最多 16 笔，每单最多匹配 32 个 maker。达到撮合上限的 GTC 回滚，IOC 释放余款。
- 价格 tick 为 0.01 dUSDC / dMON，数量 lot 为 0.01 dMON。全部结算使用整数，限价和 lot 上限均为 1e9。
- 只支持标准、精确转账且不 rebasing 的 ERC20。测试币 faucet 对任何人开放。
- 网格为一次性批量挂单；成交后可重新生成并提交网格。卖单必须事先持有基础资产。价格档位不足时调整买卖层数，无法容纳全部层数则拒绝生成，不扩张指定区间。
- 页面首次最多读取最近 5,000 个块的历史并标明截断；收益只代表所读取事件内可配对的成交。历史记录和账户完整收益需要后续归档索引。
- Local Testnet 使用 Ganache，节点监听 127.0.0.1，经站点 RPC 提供交易能力。随机钱包和链状态在链服务重启后重置。前端静态构建不包含 Ganache。

## 目录与团队交接

| 路径 | 内容 / 建议负责人 |
|---|---|
| `contracts/OrderBook.sol`、`scripts/` | 程序：合约、部署、钱包链路 |
| `src/grid.ts`、`src/analytics.ts` | 大数据：参数分配、策略对照、成本与收益口径 |
| `src/App.tsx`、`src/style.css` | 产品：单页终端、路演与可解释预览 |
| `test/` | 资产守恒与机制边界验收 |

参考机制与差异说明：链上订单簿、网格与反向补单已有先例，例如 https://docs.kuru.io/concepts/flip-orders 。本项目不主张首创 CLOB 或「绝不撞车」；关注可审查的意图约束、原子网格和链上演示证据。

## Server 78 / Cloudflare 演示部署

公开入口：`https://clob.reallier.com`。当前连接 Local Testnet（chainId 31337），使用 dMON / dUSDC 测试资产。链服务重启后重新部署；快捷钱包保存在当前浏览器会话中。

访客点击「使用测试钱包，开始交易」，浏览器生成签名密钥，领取测试 Gas 并初始化测试资产；网格挂单、撮合和撤单均提交到该演示 EVM。AI 模型接口尚未配置，规则解析可用；Arena 提供规则驱动的自动对手盘。

部署路径 `/data/app-stacks/monad-clob-grid`，Node 22.12+。执行 `npm ci`、`npm run build`，按环境调整 `deploy/*.service` 后安装到 `/etc/systemd/system/`，执行 `systemctl daemon-reload && systemctl enable --now clob-chain clob-web`。服务用户需有项目目录写权限。

- `clob-chain`：RPC 只监听 `127.0.0.1:8547`，启动时编译、部署、播种订单。
- `clob-web`：私网 `192.168.39.78:5187`，提供静态页面、受限 `/rpc` 与演示领取/对手盘接口。
- Cloudflare Tunnel：`clob.reallier.com` → `http://192.168.39.78:5187`，自动配置 DNS；不暴露 8547。
- `/health` 返回实际演示链状态。`journalctl -u clob-chain -u clob-web` 查看日志。
- 公共 RPC 禁用解锁账户交易及管理方法，只接受目标合约白名单内的客户端签名交易；请求有体积、Gas 和频率限制。钱包签名与提交交易可直接通过网页完成。
- 停用：`systemctl disable --now clob-web clob-chain`，在 Cloudflare 删除本项目专用路由和 DNS。

源码包不含私钥、环境密钥、node_modules、生成的部署地址或 Git 历史。未向 GitHub 发布。

## FairBatch v0.3 协议升级

算法、密码学、Gas 对比和五分钟讲解见 [技术机制与路演底稿](docs/Protocol-v03.md)。运行 `npm run fairbatch:benchmark` 可重新编译 v0.2 基线并比较完整清算/领取成本；`npm run fairbatch:verify -- docs/public-verification-v03.json` 可独立复核公网结果。
