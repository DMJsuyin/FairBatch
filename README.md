└── README.md
```
### 运行合约测试与验证
[`contracts/test/SealBatch.t.sol`](contracts/test/SealBatch.t.sol) 已内置对 PRD 核心验收项的自动化验证（包括正常交叉 `test_simpleCross`、买卖边际配给 `test_buyRationed` / `test_sellRationed`、无交叉全额退款 `test_noCross_refundsAll`、偶数平局取低中位 `test_tieMedian`、Fuzz 顺序无关性 `testFuzz_orderIndependence`、Fuzz 资产守恒 `testFuzz_conservation`、弃标罚没补偿 `test_griefSlashCompensates`、超时整轮取消 `test_timeoutCancel` 及异常拒绝测试 `test_rejects`）：
```bash
cd contracts
forge test -vvv
```
### 部署到 Monad Testnet
```bash
cd contracts
forge script script/Deploy.s.sol:Deploy --rpc-url <MONAD_TESTNET_RPC> --private-key <PRIVATE_KEY> --broadcast
```
---
## 👥 4. 团队角色与分工 (Team Roles & Workflow)
项目采用 **产品 + 程序 + 数据 + 队长** 协同与交叉验证机制：
| 角色 | 核心职责 | 关键交付物 |
| :--- | :--- | :--- |
| **产品负责人 (Product Lead)** | 定义用户承诺与边界、把控四阶段界面状态与克制文案、执行 5+ 独立交易者用户访谈（验证真实痛点与等待容忍度）、主导 5 分钟路演叙事 | 产品规格冻结、4 类手算标准用例、独立用户访谈记录、路演演示脚本 |
| **程序开发 (Smart Contract & Frontend)** | 实现 [`SealBatch.sol`](contracts/src/SealBatch.sol) 合约（金库锁仓、SessionKey、41 档统一价清算、弃标罚没与超时取消）、搭建单页四模块交易终端与测试网闭环 | Monad Testnet 已部署合约、公网可访问前端、多钱包真实交易哈希证据 |
| **数据与模型验证 (Data & Reference Model)** | 编写独立于合约的参考清算计算器（复算统一价、成交量、Pro-Rata 与罚没分红）、记录 Gas 消耗与同条件竞品（Kuru/聚合器）净到账对比 | 独立参考计算器、链上与模型 100% 对账表、Gas 与操作耗时实测报告 |
| **队长 (Team Lead)** | 统筹时间线推进（规则冻结 $\rightarrow$ 并行开发 $\rightarrow$ 对抗测试 $\rightarrow$ 冻结复核）、汇总链上证据与备用演示视频并完成最终提交 | 完整开源仓库、测试网交易证据清单、MOJO 平台提交凭据 |
---
## ✅ 5. 交付验收清单 (Acceptance Criteria)
- [x] **正常成交与四类标准用例测试**：覆盖正常交叉、买/卖部分成交配给、多解平局取中位、无交叉全额退款（见 [`SealBatch.t.sol`](contracts/test/SealBatch.t.sol)）。
- [x] **顺序无关性验证 (`testFuzz_orderIndependence`)**：固定同一组已揭示订单，打乱提交与揭示先后顺序，最终清算价、总成交量与各人成交量 100% 一致。
- [x] **资产守恒与价格边界保护 (`testFuzz_conservation`)**：验证合约余额恒大于等于所有负债，任何买方成交价 $\le$ 限价、卖方成交价 $\ge$ 限价。
- [x] **异常安全退出 (`test_timeoutCancel`, `test_rejects`)**：完整覆盖错误 `salt`、跨批重放、重复揭示/领取、无对手零成交、弃标罚没补偿、无人结算超时整轮取消。
- [ ] **Monad Testnet 真实多钱包交易证据与公网终端提交**：部署测试网并附公开交易哈希与参考模型对账表。
