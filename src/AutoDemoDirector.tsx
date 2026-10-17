import {useCallback, useEffect, useRef, useState} from 'react';
import {
  Activity,
  CheckCircle2,
  ChevronRight,
  FastForward,
  Film,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
  SkipBack,
  SkipForward,
  Sparkles,
  Volume2,
  VolumeX,
  X,
  Zap,
} from 'lucide-react';
import './autoDemo.css';

export interface ClobDemoBridge {
  ensureDemoReady: () => Promise<void>;
  setTab: (tab: 'grid' | 'trade') => void;
  setBottom: (bottom: 'orders' | 'fills' | 'receipts' | 'account') => void;
  pickBookPrice: (side: 'bid' | 'ask') => void;
  fillAndPreviewGrid: () => void;
  deployGridPreview: () => Promise<void>;
  prepareIocTicket: () => void;
  submitIocOrder: () => Promise<void>;
  pulseArenaOnce: () => Promise<void>;
  refresh: () => Promise<void>;
}

export interface FairBatchDemoBridge {
  configureTicket: (opts: {
    buy?: boolean;
    price?: string;
    qty?: string;
    padding?: boolean;
  }) => void;
  setDockTab: (tab: 'orders' | 'compare' | 'witness' | 'algorithm') => void;
  setCompare: (idx: number) => void;
  challengeSolver: () => Promise<void>;
  refresh: () => Promise<void>;
}

declare global {
  interface Window {
    __CLOB_DEMO_BRIDGE__?: ClobDemoBridge;
    __FB_DEMO_BRIDGE__?: FairBatchDemoBridge;
  }
}

export interface AutoDemoSubCue {
  atMs: number;
  narration: string;
  cursorTarget?: string;
  cursorLabel?: string;
  run?: () => void | Promise<void>;
}

export interface AutoDemoStage {
  id: string;
  code: string;
  act: string;
  actTitle: string;
  engine: 'clob' | 'fairbatch';
  title: string;
  subtitle: string;
  targetSelector: string;
  dockSide: 'left' | 'right';
  durationMs: number;
  formula: string;
  nodes: Array<{
    code: string;
    label: string;
    sub: string;
    tone: 'gold' | 'buy' | 'sell';
  }>;
  cues: AutoDemoSubCue[];
}

const DEMO_STAGES: AutoDemoStage[] = [
  {
    id: 'stage-01-overview',
    code: '01',
    act: 'ACT I · 双引擎机构级架构',
    actTitle: '全链订单簿与密封集合竞价一体化终端',
    engine: 'clob',
    title: '一屏双引擎架构与实时链上盘口遥测',
    subtitle: '顶部状态带实时聚合链上最新成交、BBO 最优买卖盘、价差基点与区块高度',
    targetSelector: '[data-tour="market"]',
    dockSide: 'right',
    durationMs: 14000,
    formula: 'Engine ∈ {01 Continuous FIFO CLOB, 02 Sealed Uniform FairBatch}',
    nodes: [
      {code: 'ENGINE 01', label: '连续限价订单簿', sub: '毫秒级价格-时间优先', tone: 'buy'},
      {code: 'INTENT GRID', label: '确定性意图网格', sub: '自然语言转原子批量挂单', tone: 'gold'},
      {code: 'ENGINE 02', label: '密封集合竞价', sub: 'Commit-Reveal 零抢跑清算', tone: 'buy'},
    ],
    cues: [
      {
        atMs: 300,
        narration:
          '欢迎来到 FairBatch 机构级全链交易终端。本平台将「连续限价订单簿、确定性意图网格、以及抗 MEV 密封集合竞价」浓缩于同一单屏工作台。',
        cursorTarget: '.brand-lockup',
        cursorLabel: '一体化双引擎交易终端',
      },
      {
        atMs: 5200,
        narration:
          '顶部实时行情带直接从链上合约聚合最新成交价（LAST）、中间参考价（MID）、最优买卖一档（BBO）与有效挂单容量。',
        cursorTarget: '[data-tour="market"] .ticker-metric:nth-of-type(4)',
        cursorLabel: '实时读取链上 BBO 与价差',
      },
      {
        atMs: 10000,
        narration:
          '右上角实时显示当前连接的区块链节点与最新区块高度，所有状态均源自实盘区块同步。',
        cursorTarget: '.chain-telemetry',
        cursorLabel: '同步实盘区块状态',
        run: () => window.__CLOB_DEMO_BRIDGE__?.refresh(),
      },
    ],
  },
  {
    id: 'stage-02-account',
    code: '02',
    act: 'ACT I · 双引擎机构级架构',
    actTitle: '零私钥托管与一键测试账户注资',
    engine: 'clob',
    title: '一键初始化演示账户与合约自托管入金',
    subtitle: '浏览器本地生成会话密钥，自动完成测试币水龙头申领与 OrderBook 合约存入',
    targetSelector: '[data-tour="activity"]',
    dockSide: 'right',
    durationMs: 17000,
    formula: 'Custody Invariant: UserFunds == FreeBalance + LockedOrderCollateral',
    nodes: [
      {code: 'SESSION KEY', label: '本地会话钱包', sub: '浏览器内存生成私钥', tone: 'gold'},
      {code: 'FAUCET & DEPOSIT', label: '自动申领并入金', sub: '5,000 dMON + 5,000 dUSDC', tone: 'buy'},
      {code: 'SELF-CUSTODY', label: '合约独立记账', sub: '无管理员后门可随时提取', tone: 'buy'},
    ],
    cues: [
      {
        atMs: 400,
        narration:
          '现在开始全流程实盘操作。首先初始化演示交易账户：系统在本地生成会话钱包，自动领取测试 Gas 并向合约存入 5,000 dMON 与 5,000 dUSDC。',
        cursorTarget: '[data-tour="wallet"]',
        cursorLabel: '自动初始化账户并存入测试资产',
        run: () => {
          window.__CLOB_DEMO_BRIDGE__?.setBottom('account');
          void window.__CLOB_DEMO_BRIDGE__?.ensureDemoReady();
        },
      },
      {
        atMs: 6800,
        narration:
          '切换到「合约托管资产与盈亏」面板：可以看到 5,000 dUSDC 与 5,000 dMON 已实时进入 OrderBook 合约可用余额。',
        cursorTarget: '.activity-tabs button:nth-of-type(4)',
        cursorLabel: '查看合约托管资产与 FIFO 盈亏',
        run: () => window.__CLOB_DEMO_BRIDGE__?.setBottom('account'),
      },
      {
        atMs: 12200,
        narration:
          '合约严格区分「可用余额」与「挂单锁定」，并按先进先出（FIFO）原则独立核算已实现配对收益，不含任何特权管理员接口。',
        cursorTarget: '.account-dock-grid',
        cursorLabel: '校验自托管资产与 FIFO 收益核算',
      },
    ],
  },
  {
    id: 'stage-03-orderbook',
    code: '03',
    act: 'ACT I · 双引擎机构级架构',
    actTitle: '全链价格-时间优先 (FIFO) 订单簿',
    engine: 'clob',
    title: '双边十档实时深度簿与盘口毫秒级联动',
    subtitle: '上红下绿十档聚合深度、多空失衡度指示条，点击任意档位即可带入委托价',
    targetSelector: '[data-tour="book"]',
    dockSide: 'left',
    durationMs: 16000,
    formula: 'Priority: Price-Time FIFO | Cap: 128 Active Orders | Tick: 0.01 dUSDC',
    nodes: [
      {code: 'ASKS (SELL)', label: '卖盘十档深度', sub: '1.01 → 1.10 dUSDC 递增', tone: 'sell'},
      {code: 'SPREAD / MID', label: '中间价与价差', sub: 'MID 1.00 · SPRD 0.02', tone: 'gold'},
      {code: 'BIDS (BUY)', label: '买盘十档深度', sub: '0.99 → 0.90 dUSDC 递减', tone: 'buy'},
    ],
    cues: [
      {
        atMs: 400,
        narration:
          '中间栏为全链双边十档订单簿。卖盘按价格递增排列，买盘按价格递减排列，背景横条直观反映每一档的累计挂单深度。',
        cursorTarget: '[data-tour="book"] .mid-price',
        cursorLabel: '审视中间参考价与买卖价差',
      },
      {
        atMs: 5800,
        narration:
          '点击买一档（0.99 dUSDC），价格自动回填至右侧交易面板，方便交易员快速挂出被动做市单。',
        cursorTarget: '[data-tour="book"] .book-rows.bids .book-row:first-child',
        cursorLabel: '点击买一档 0.99 dUSDC 回填价格',
        run: () => window.__CLOB_DEMO_BRIDGE__?.pickBookPrice('bid'),
      },
      {
        atMs: 11000,
        narration:
          '再点击卖一档（1.01 dUSDC），委托价即时切换为对手盘最优卖价，底部失衡度条实时监控买卖双方流动性占比。',
        cursorTarget: '[data-tour="book"] .book-rows.asks .book-row:last-child',
        cursorLabel: '点击卖一档 1.01 dUSDC 联动报单',
        run: () => window.__CLOB_DEMO_BRIDGE__?.pickBookPrice('ask'),
      },
    ],
  },
  {
    id: 'stage-04-grid-preview',
    code: '04',
    act: 'ACT II · 意图驱动确定性原子网格',
    actTitle: '自然语言策略意图 → 确定性多档拆单',
    engine: 'clob',
    title: '自然语言意图解析与预算守恒网格生成',
    subtitle: '将模糊交易意图转化为严格对齐最小步长（0.01 dUSDC）与预算上限的 8 档双边挂单',
    targetSelector: '[data-tour="execution"]',
    dockSide: 'left',
    durationMs: 19000,
    formula: '∀i: Price_i mod 0.01 == 0  ∧  Σ BuyQuote ≤ 500 dUSDC  ∧  Σ SellBase ≤ 300 dMON',
    nodes: [
      {code: '01 INTENT', label: '自然语言策略描述', sub: '震荡偏多 ±4% 8层网格', tone: 'gold'},
      {code: '02 VALIDATE', label: '确定性步长与预算分配', sub: '杜绝 AI 幻觉越界下单', tone: 'buy'},
      {code: '03 PREVIEW', label: '生成 8 档挂单明细', sub: '逐档核验价格与数量', tone: 'buy'},
    ],
    cues: [
      {
        atMs: 400,
        narration:
          '切入右侧「意图网格 · GRID」引擎。交易员无需手动逐笔计算网格档位，只需输入自然语言策略意图：震荡偏多、±4% 区间铺设 8 层网格。',
        cursorTarget: '.execution-tabs button:first-child',
        cursorLabel: '切换至意图网格引擎',
        run: () => window.__CLOB_DEMO_BRIDGE__?.setTab('grid'),
      },
      {
        atMs: 6200,
        narration:
          '系统通过确定性规则或 AI 辅助解析参数，并对每个档位执行 Tick 步长对齐、最小手数检查与买卖预算上限裁剪。',
        cursorTarget: '#intent',
        cursorLabel: '解析策略意图：买入预算 500 USDC / 卖出 300 MON',
      },
      {
        atMs: 12000,
        narration:
          '点击「生成网格挂单预览」，立即进入 02 档位核验视图：8 笔买卖限价单的价格、数量与资金占用全部清晰列出，确保绝不越界执行。',
        cursorTarget: '[data-tour="execution"] .primary-button',
        cursorLabel: '生成 8 档确定性网格预览',
        run: () => window.__CLOB_DEMO_BRIDGE__?.fillAndPreviewGrid(),
      },
    ],
  },
  {
    id: 'stage-05-grid-deploy',
    code: '05',
    act: 'ACT II · 意图驱动确定性原子网格',
    actTitle: '单笔交易原子部署多档网格挂单',
    engine: 'clob',
    title: '8 笔网格挂单原子上链与交易回执存证',
    subtitle: '调用合约 batchPlaceOrders 单笔交易一次性写入全部网格档位，消除半边成交敞口',
    targetSelector: '[data-tour="activity"]',
    dockSide: 'right',
    durationMs: 18000,
    formula: 'batchPlaceOrders(Order[8]) → Single Atomic Tx | All Rest on Book or Revert',
    nodes: [
      {code: 'BATCH TX', label: '单笔原子签名', sub: 'batchPlaceOrders 一次提交', tone: 'gold'},
      {code: 'OPEN ORDERS', label: '当前委托实时入簿', sub: '8 笔双边挂单同步生效', tone: 'buy'},
      {code: 'RECEIPT LOG', label: '链上回执与 Gas 审计', sub: '真实 Tx Hash 可溯源', tone: 'buy'},
    ],
    cues: [
      {
        atMs: 400,
        narration:
          '核验无误后，点击「原子提交 8 笔网格挂单」。合约通过 batchPlaceOrders 在单笔交易内原子写入全部 8 个档位，彻底消除传统逐笔挂单的半边风险。',
        cursorTarget: '[data-tour="execution"] .primary-button',
        cursorLabel: '点击：原子提交 8 笔网格挂单上链',
        run: () => void window.__CLOB_DEMO_BRIDGE__?.deployGridPreview(),
      },
      {
        atMs: 7500,
        narration:
          '交易已在链上确认！底部自动展开「当前委托 · OPEN ORDERS」，可以看到刚刚批量部署的多档买卖限价单已全部在订单簿中挂出。',
        cursorTarget: '.activity-tabs button:first-child',
        cursorLabel: '核验链上当前挂单列表',
        run: () => window.__CLOB_DEMO_BRIDGE__?.setBottom('orders'),
      },
      {
        atMs: 13000,
        narration:
          '切入「链上交易回执 · RECEIPTS」，每一笔授权、入金与批量网格挂单均记录了真实的交易哈希、状态与 Gas 消耗。',
        cursorTarget: '.activity-tabs button:nth-of-type(3)',
        cursorLabel: '查看链上交易回执与 Gas 消耗',
        run: () => window.__CLOB_DEMO_BRIDGE__?.setBottom('receipts'),
      },
    ],
  },
  {
    id: 'stage-06-ioc-arena',
    code: '06',
    act: 'ACT II · 意图驱动确定性原子网格',
    actTitle: '跨价 IOC 吃单与实盘 Arena 对手盘交锋',
    engine: 'clob',
    title: 'IOC 立即成交跨价扫单与实时 K 线演化',
    subtitle: '保护限价内立即吃单并自动释放未成交余量，配合 Arena 对手盘触发连续实盘撮合',
    targetSelector: '[data-tour="chart"]',
    dockSide: 'right',
    durationMs: 19000,
    formula: 'IOC Execution: Fill ≤ LimitPrice | Unfilled Lots Released Immediately',
    nodes: [
      {code: 'IOC SWEEP', label: '跨价主动吃单', sub: '立即消耗对手盘最优档', tone: 'buy'},
      {code: 'ARENA BOT', label: '对手盘交替撮合', sub: '连续触发链上真实成交', tone: 'gold'},
      {code: 'OHLCV + VWAP', label: 'K 线与 FIFO 收益更新', sub: '逐笔 Fills 实时聚合', tone: 'buy'},
    ],
    cues: [
      {
        atMs: 400,
        narration:
          '接下来演示主动吃单与连续行情演化。右侧切换至「手动委托 · ORDER」，选择 IOC 立即成交模式，报入 1.02 dUSDC 跨价买单。',
        cursorTarget: '.execution-tabs button:nth-of-type(2)',
        cursorLabel: '切换至手动委托 · IOC 模式',
        run: () => window.__CLOB_DEMO_BRIDGE__?.prepareIocTicket(),
      },
      {
        atMs: 5500,
        narration:
          '提交 IOC 买单上链！合约立即按卖一档最优价（1.01 dUSDC）撮合成交，并将价差改善部分与未成交余量原路释放回可用余额。',
        cursorTarget: '[data-tour="execution"] .primary-button',
        cursorLabel: '提交 IOC 跨价买单并立即成交',
        run: () => void window.__CLOB_DEMO_BRIDGE__?.submitIocOrder(),
      },
      {
        atMs: 11500,
        narration:
          '同时触发「Arena 对手盘」注入链上交互流量：左侧 K 线图、VWAP 均价线与底部「市场逐笔成交 · FILLS」随实盘区块同步跳动。',
        cursorTarget: '[data-tour="chart"] .arena-inline-btn',
        cursorLabel: '触发 Arena 实盘对手盘成交脉冲',
        run: () => {
          window.__CLOB_DEMO_BRIDGE__?.setBottom('fills');
          void window.__CLOB_DEMO_BRIDGE__?.pulseArenaOnce();
        },
      },
    ],
  },
  {
    id: 'stage-07-switch-fairbatch',
    code: '07',
    act: 'ACT III · 密码学密封集合竞价 (FAIRBATCH)',
    actTitle: '从连续撮合无缝切入抗 MEV 密封集合竞价',
    engine: 'fairbatch',
    title: '原地切换至 FairBatch 密封集合竞价终端',
    subtitle: '针对大额机构调仓与开盘定价，用固定时间窗口密封竞价彻底消除抢跑与夹子攻击',
    targetSelector: '[data-tour="round"]',
    dockSide: 'right',
    durationMs: 15000,
    formula: 'Batch Lifecycle: 01 Commit(60s) → 02 Reveal(60s) → 03 Settle(P*) → 04 Claim',
    nodes: [
      {code: '01 COMMIT', label: '密封哈希提交', sub: '仅上链承诺哈希与保证金', tone: 'gold'},
      {code: '02 REVEAL', label: '封盘统一揭示', sub: '校验盐值还原真实限价', tone: 'buy'},
      {code: '03 SETTLE', label: '唯一清算价 P*', sub: '同批全员同价成交退差额', tone: 'buy'},
    ],
    cues: [
      {
        atMs: 300,
        narration:
          '连续订单簿适合高频做市，但在大额机构调仓时容易遭受 MEV 抢跑。点击顶部导航「02 密封集合竞价 · FairBatch」，在同一终端内原地切换引擎。',
        cursorTarget: '.fb-mode-nav .fb-mode-link:nth-of-type(2)',
        cursorLabel: '原地切换至 02 密封集合竞价引擎',
      },
      {
        atMs: 5800,
        narration:
          '顶部状态带清晰展示每一轮集合竞价的四个确定性阶段：01 密封提交、02 封盘揭示、03 统一清算、04 资产到账。',
        cursorTarget: '[data-tour="round"] .fb-steps',
        cursorLabel: '审视四阶段密封竞价状态机',
      },
      {
        atMs: 10800,
        narration:
          '在密封期内，所有参与者在同一时间窗口提交报价哈希，上链先后顺序完全不影响最终成交价与分配权，从根源上终结 Gas 竞速战。',
        cursorTarget: '[data-tour="round"] .fb-round-kpis',
        cursorLabel: '核验本轮密封数、揭示数与统一清算价 P*',
      },
    ],
  },
  {
    id: 'stage-08-sealed-commit',
    code: '08',
    act: 'ACT III · 密码学密封集合竞价 (FAIRBATCH)',
    actTitle: 'Keccak-256 承诺与 2^k 档位掩码锁仓',
    engine: 'fairbatch',
    title: '密码学密封委托单与保证金掩码防侧信道泄露',
    subtitle: '浏览器本地生成 256 位随机盐计算承诺哈希，支持按 2^k 整数档位向上掩码锁仓',
    targetSelector: '[data-tour="ticket"]',
    dockSide: 'right',
    durationMs: 18000,
    formula: 'C = Keccak256("FairBatch:v0.3", chainId, contract, round, owner, side, lots, ticks, salt)',
    nodes: [
      {code: 'SALT 256-BIT', label: '本地随机盲化盐', sub: '256 位高熵随机数防彩虹表', tone: 'gold'},
      {code: '2^K PADDING', label: '2^k 整数档位掩码', sub: '隐藏精确锁仓金额上限', tone: 'buy'},
      {code: 'EIP-712 RELAY', label: '意图签名或直连上链', sub: '封盘后自动揭示报价明文', tone: 'buy'},
    ],
    cues: [
      {
        atMs: 400,
        narration:
          '左侧为「密封委托单 · SEALED TICKET」。我们设定买入限价 1.04 dUSDC、数量 8 dMON，此时基础需锁定保证金为 8.32 dUSDC。',
        cursorTarget: '[data-tour="ticket"] .fb-input-grid',
        cursorLabel: '设定密封买单：限价 1.04 dUSDC × 8 dMON',
        run: () =>
          window.__FB_DEMO_BRIDGE__?.configureTicket({
            buy: true,
            price: '1.04',
            qty: '8',
            padding: false,
          }),
      },
      {
        atMs: 6500,
        narration:
          '若观察者通过链上 ERC-20 转账金额反推买单限价怎么办？勾选「隐藏精确锁仓量（2^k 档位掩码）」，锁仓额立即向上对齐至 16.00 dUSDC！',
        cursorTarget: '[data-tour="reveal"] .fb-padding-opt',
        cursorLabel: '开启 2^k 档位掩码：8.32 → 16.00 dUSDC',
        run: () =>
          window.__FB_DEMO_BRIDGE__?.configureTicket({
            buy: true,
            price: '1.04',
            qty: '8',
            padding: true,
          }),
      },
      {
        atMs: 12800,
        narration:
          '所有超额掩码资金与价格改善差额，在统一清算后均由智能合约按精确定理 100% 原路退回用户账户。',
        cursorTarget: '[data-tour="ticket"] .fb-estimate',
        cursorLabel: '结算后多退少补，掩码差额 100% 原路退回',
      },
    ],
  },
  {
    id: 'stage-09-clearing-curve',
    code: '09',
    act: 'ACT III · 密码学密封集合竞价 (FAIRBATCH)',
    actTitle: '统一清算供需交集曲线与 O(n) 见证防作恶',
    engine: 'fairbatch',
    title: '揭示期供需阶梯交集求解唯一清算价 P* 与防漏单挑战',
    subtitle: '最大化匹配成交量 V* 并在边际重叠区间取中点 P*，客户端独立复算并支持一键验证漏单回滚',
    targetSelector: '[data-tour="clearing"]',
    dockSide: 'left',
    durationMs: 17000,
    formula: 'V(p) = min(Demand(p), Supply(p))  ⇒  P* = ⌊(L + H) / 2⌋ = 1.00 dUSDC',
    nodes: [
      {code: 'DEMAND / SUPPLY', label: '累计买盘与卖盘曲线', sub: '绿线需求 vs 红线供给交集', tone: 'buy'},
      {code: 'UNIFORM P*', label: '唯一统一清算价', sub: 'P* = 1.00 dUSDC · V* = 16 dMON', tone: 'gold'},
      {code: 'WITNESS AUDIT', label: '防漏单位图校验', sub: '篡改或漏单 100% 触发 Revert', tone: 'sell'},
    ],
    cues: [
      {
        atMs: 400,
        narration:
          '封盘揭示后，中部画布实时绘制累计买盘需求曲线（绿）与累计卖盘供给曲线（红）。两条阶梯曲线的交集确定了唯一统一清算价 P* = 1.00 dUSDC。',
        cursorTarget: '[data-tour="clearing"] .fb-curve-wrap',
        cursorLabel: '审视供需交集曲线与唯一清算价 P* = 1.00',
      },
      {
        atMs: 6500,
        narration:
          '右侧审计面板显示：浏览器本地 TypeScript 独立复算的边际区间 [0.99, 1.01] 与链上合约结算结果 100% 严格吻合。',
        cursorTarget: '.fb-audit-card',
        cursorLabel: '客户端零信任独立复算：100% 匹配链上结果',
      },
      {
        atMs: 11500,
        narration:
          '如果清算人故意漏报一笔已揭示订单企图操纵价格？点击「测试恶意漏单回滚」，合约位图校验立即拦截并返回 incomplete witness！',
        cursorTarget: '.fb-inline-audit-btn',
        cursorLabel: '点击验证：合约立即拦截恶意漏单见证',
        run: () => void window.__FB_DEMO_BRIDGE__?.challengeSolver(),
      },
    ],
  },
  {
    id: 'stage-10-invariance-proof',
    code: '10',
    act: 'ACT III · 密码学密封集合竞价 (FAIRBATCH)',
    actTitle: '6! 排列顺序无关性数学对照实验与闭环总结',
    engine: 'fairbatch',
    title: '6! 到达顺序全排列对照实验与确定性规范闭环',
    subtitle: '直观证明同一批订单在 6 种不同到达顺序下，FairBatch 始终输出唯一恒定清算价 1.00 dUSDC',
    targetSelector: '[data-tour="fb-dock"]',
    dockSide: 'right',
    durationMs: 18000,
    formula: '∀π ∈ S_n : FairBatchClear(Orders ∘ π) ≡ FairBatchClear(Orders) = 1.00 dUSDC',
    nodes: [
      {code: 'CLOB VARIANCE', label: '连续撮合顺序敏感', sub: '价格随排序在 0.90~1.10 剧烈摇摆', tone: 'sell'},
      {code: '6! PERMUTATIONS', label: '全排列顺序无关实验', sub: '遍历 A/B/C 全部 6 种到达顺序', tone: 'gold'},
      {code: 'FAIRBATCH P*', label: '集合竞价恒定输出', sub: 'P* 恒等于 1.00 dUSDC', tone: 'buy'},
    ],
    cues: [
      {
        atMs: 400,
        narration:
          '最后看底部验证坞的「顺序无关对照实验 6!」。同一组买单 A(1.10)、卖单 B(0.90)、买单 C(1.00)，我们依次切换它们到达区块的排列顺序。',
        cursorTarget: '[data-tour="fb-dock"] .fb-dock-tabs button:nth-of-type(2)',
        cursorLabel: '打开 6! 顺序无关性数学对照实验',
        run: () => {
          window.__FB_DEMO_BRIDGE__?.setDockTab('compare');
          window.__FB_DEMO_BRIDGE__?.setCompare(0);
        },
      },
      {
        atMs: 5500,
        narration:
          '切换排列 B → A → C 与 C → B → A：传统连续订单簿的成交价在 0.90 与 1.10 之间剧烈波动 20%，而 FairBatch 恒定输出 P* = 1.00 dUSDC！',
        cursorTarget: '[data-tour="fb-dock"] .fb-permutations',
        cursorLabel: '遍历不同到达顺序：FairBatch 价格恒定 1.00',
        run: () => {
          window.__FB_DEMO_BRIDGE__?.setCompare(2);
          setTimeout(() => window.__FB_DEMO_BRIDGE__?.setCompare(5), 2400);
        },
      },
      {
        atMs: 12000,
        narration:
          '再切入「O(n) 见证防作恶核验」与「确定性清算规范」：全链连续订单簿、确定性意图网格与抗 MEV 密封集合竞价三大闭环演示完毕！',
        cursorTarget: '[data-tour="fb-dock"] .fb-dock-tabs button:nth-of-type(3)',
        cursorLabel: '核验 O(n) 见证与确定性清算规范 · 全流程演练完成',
        run: () => {
          window.__FB_DEMO_BRIDGE__?.setDockTab('witness');
          setTimeout(() => window.__FB_DEMO_BRIDGE__?.setDockTab('algorithm'), 2800);
        },
      },
    ],
  },
];

interface AutoDemoDirectorProps {
  engine: 'clob' | 'fairbatch';
  onSwitchEngine: (next: 'clob' | 'fairbatch') => void;
}

export default function AutoDemoDirector({
  engine,
  onSwitchEngine,
}: AutoDemoDirectorProps) {
  const [active, setActive] = useState(false);
  const [paused, setPaused] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [speed, setSpeed] = useState<1 | 1.5 | 2>(1);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [stageIdx, setStageIdx] = useState(0);
  const [cueIdx, setCueIdx] = useState(0);
  const [stageElapsedMs, setStageElapsedMs] = useState(0);
  const [actBanner, setActBanner] = useState<{act: string; title: string} | null>(null);

  // Target spotlight rect
  const [spotRect, setSpotRect] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);

  // Virtual cursor state
  const [cursorPos, setCursorPos] = useState<{
    x: number;
    y: number;
    label: string;
    clicking: boolean;
    visible: boolean;
  }>({
    x: 720,
    y: 450,
    label: '',
    clicking: false,
    visible: false,
  });

  const firedCuesRef = useRef<Set<string>>(new Set());
  const lastActRef = useRef<string>('');

  const stage = DEMO_STAGES[stageIdx] || DEMO_STAGES[0];
  const currentCue = stage.cues[cueIdx] || stage.cues[0];

  const totalDurationMs = DEMO_STAGES.reduce((acc, s) => acc + s.durationMs, 0);
  const completedStagesMs = DEMO_STAGES.slice(0, stageIdx).reduce(
    (acc, s) => acc + s.durationMs,
    0
  );
  const overallElapsedMs = completed
    ? totalDurationMs
    : Math.min(totalDurationMs, completedStagesMs + stageElapsedMs);
  const overallProgress = Math.min(
    100,
    Math.round((overallElapsedMs / totalDurationMs) * 100)
  );

  const speakText = useCallback(
    (text: string) => {
      if (!voiceEnabled || typeof window === 'undefined' || !('speechSynthesis' in window)) {
        return;
      }
      try {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'zh-CN';
        u.rate = speed === 1 ? 1.08 : speed === 1.5 ? 1.35 : 1.6;
        window.speechSynthesis.speak(u);
      } catch {
        // ignore speech synthesis errors
      }
    },
    [voiceEnabled, speed]
  );

  const startDemo = useCallback(() => {
    firedCuesRef.current.clear();
    lastActRef.current = '';
    setStageIdx(0);
    setCueIdx(0);
    setStageElapsedMs(0);
    setCompleted(false);
    setPaused(false);
    setActive(true);
  }, []);

  const stopDemo = useCallback(() => {
    setActive(false);
    setPaused(false);
    setCompleted(false);
    setActBanner(null);
    setCursorPos(prev => ({...prev, visible: false, clicking: false}));
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }, []);

  // Auto-start if URL has ?autodemo=1
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('autodemo') === '1') {
      startDemo();
    }
  }, [startDemo]);

  // Listen for custom start event from header button in either engine
  useEffect(() => {
    const handler = () => {
      if (active && !completed) {
        setPaused(p => !p);
      } else {
        startDemo();
      }
    };
    window.addEventListener('monad-dex:toggle-autodemo', handler);
    return () => window.removeEventListener('monad-dex:toggle-autodemo', handler);
  }, [active, completed, startDemo]);

  // Broadcast state to header trigger pill
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('monad-dex:autodemo-state', {
        detail: {
          active,
          paused,
          completed,
          stageIdx,
          totalStages: DEMO_STAGES.length,
          overallProgress,
        },
      })
    );
  }, [active, paused, completed, stageIdx, overallProgress]);

  // Switch engine when stage requires it & trigger Act Banner on act transitions
  useEffect(() => {
    if (!active) return;
    if (stage.engine !== engine) {
      onSwitchEngine(stage.engine);
    }
    if (lastActRef.current !== stage.act) {
      lastActRef.current = stage.act;
      setActBanner({act: stage.act, title: stage.actTitle});
      const t = setTimeout(() => setActBanner(null), 2100);
      return () => clearTimeout(t);
    }
  }, [active, stage, engine, onSwitchEngine]);

  // Measure spotlight target rect continuously
  useEffect(() => {
    if (!active) return;
    const updateRect = () => {
      const el = document.querySelector(stage.targetSelector) as HTMLElement | null;
      if (!el) {
        setSpotRect(null);
        return;
      }
      const r = el.getBoundingClientRect();
      const pad = 4;
      setSpotRect({
        top: Math.max(4, r.top - pad),
        left: Math.max(4, r.left - pad),
        width: Math.min(window.innerWidth - 8, r.width + pad * 2),
        height: Math.min(window.innerHeight - 8, r.height + pad * 2),
      });
    };
    updateRect();
    const id = setInterval(updateRect, 220);
    window.addEventListener('resize', updateRect);
    return () => {
      clearInterval(id);
      window.removeEventListener('resize', updateRect);
    };
  }, [active, stage.targetSelector, engine, stageIdx, cueIdx]);

  // Execute a cue (move virtual cursor + ripple + run action + speak narration)
  const triggerCue = useCallback(
    (sIdx: number, cIdx: number) => {
      const st = DEMO_STAGES[sIdx];
      const cue = st?.cues[cIdx];
      if (!st || !cue) return;
      const key = `${sIdx}:${cIdx}`;
      if (firedCuesRef.current.has(key)) return;
      firedCuesRef.current.add(key);

      setCueIdx(cIdx);
      speakText(cue.narration);

      // Move cursor to target element if present
      setTimeout(() => {
        const targetEl = (
          cue.cursorTarget
            ? document.querySelector(cue.cursorTarget)
            : document.querySelector(st.targetSelector)
        ) as HTMLElement | null;

        if (targetEl) {
          const r = targetEl.getBoundingClientRect();
          const x = Math.round(r.left + Math.min(r.width * 0.5, 140));
          const y = Math.round(r.top + Math.min(r.height * 0.5, 28));
          setCursorPos({
            x: Math.max(40, Math.min(window.innerWidth - 40, x)),
            y: Math.max(24, Math.min(window.innerHeight - 40, y)),
            label: cue.cursorLabel || st.title,
            clicking: false,
            visible: true,
          });

          // Trigger click ripple & highlight after cursor arrives
          setTimeout(() => {
            setCursorPos(prev => ({...prev, clicking: true}));
            targetEl.classList.add('autodemo-target-pulse');
            if (cue.run) {
              void cue.run();
            }
            setTimeout(() => {
              setCursorPos(prev => ({...prev, clicking: false}));
              targetEl.classList.remove('autodemo-target-pulse');
            }, 650);
          }, 520);
        } else if (cue.run) {
          void cue.run();
        }
      }, 120);
    },
    [speakText]
  );

  // Main playback ticker
  useEffect(() => {
    if (!active || paused || completed) return;
    const intervalMs = 100;
    const timer = setInterval(() => {
      setStageElapsedMs(prev => {
        const next = prev + intervalMs * speed;
        const currentStage = DEMO_STAGES[stageIdx];
        if (!currentStage) return prev;

        // Check if any cue should fire at `next`
        for (let i = 0; i < currentStage.cues.length; i++) {
          if (next >= currentStage.cues[i].atMs) {
            const key = `${stageIdx}:${i}`;
            if (!firedCuesRef.current.has(key)) {
              triggerCue(stageIdx, i);
            }
          }
        }

        if (next >= currentStage.durationMs) {
          if (stageIdx + 1 < DEMO_STAGES.length) {
            setStageIdx(s => s + 1);
            setCueIdx(0);
            return 0;
          } else {
            setCompleted(true);
            setCursorPos(c => ({...c, visible: false}));
            return currentStage.durationMs;
          }
        }
        return next;
      });
    }, intervalMs);

    return () => clearInterval(timer);
  }, [active, paused, completed, speed, stageIdx, triggerCue]);

  const jumpToStage = (idx: number) => {
    const clamped = Math.max(0, Math.min(DEMO_STAGES.length - 1, idx));
    // Clear fired cues for target stage
    for (let i = 0; i < 10; i++) {
      firedCuesRef.current.delete(`${clamped}:${i}`);
    }
    setCompleted(false);
    setStageIdx(clamped);
    setCueIdx(0);
    setStageElapsedMs(0);
  };

  if (!active) return null;

  const formatClock = (ms: number) => {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const stageProgress = Math.min(
    100,
    Math.round((stageElapsedMs / stage.durationMs) * 100)
  );

  return (
    <div className="autodemo-layer" aria-live="polite">
      {/* Act Transition Banner */}
      {actBanner && (
        <div className="autodemo-act-banner">
          <span className="autodemo-act-eyebrow">{actBanner.act}</span>
          <strong>{actBanner.title}</strong>
        </div>
      )}

      {/* 4-Corner HUD Spotlight Frame with Laser Scanline */}
      {spotRect && !completed && (
        <div
          className="autodemo-spotlight"
          style={{
            top: `${spotRect.top}px`,
            left: `${spotRect.left}px`,
            width: `${spotRect.width}px`,
            height: `${spotRect.height}px`,
          }}
        >
          <i className="ad-corner tl" />
          <i className="ad-corner tr" />
          <i className="ad-corner bl" />
          <i className="ad-corner br" />
          <div className="autodemo-scanline" />
          <div className="autodemo-spot-badge">
            <span className="ad-badge-pulse" />
            <b>STAGE {stage.code}/10</b>
            <span>{stage.title}</span>
          </div>
        </div>
      )}

      {/* Animated Virtual Laser Cursor & Shockwave Ripple */}
      {cursorPos.visible && !completed && (
        <div
          className={`autodemo-cursor ${cursorPos.clicking ? 'clicking' : ''}`}
          style={{
            transform: `translate3d(${cursorPos.x}px, ${cursorPos.y}px, 0)`,
          }}
        >
          <div className="autodemo-cursor-ring" />
          <div className="autodemo-cursor-dot" />
          {cursorPos.clicking && (
            <>
              <span className="autodemo-ripple r1" />
              <span className="autodemo-ripple r2" />
            </>
          )}
          {cursorPos.label && (
            <div className="autodemo-cursor-tag">
              <Zap size={10} />
              <span>{cursorPos.label}</span>
            </div>
          )}
        </div>
      )}

      {/* FrameForge-Style VisibleDemoOverlay HUD (Auto-Dodges Spotlighted Column) */}
      <aside
        className={`autodemo-hud-panel dock-${stage.dockSide}`}
        data-testid="visible-demo-overlay"
      >
        <div className="autodemo-hud-header">
          <div className="autodemo-hud-title">
            <span className={`ad-status-dot ${completed ? 'passed' : paused ? 'paused' : 'running'}`} />
            <div>
              <div className="ad-hud-main-title">
                <Film size={13} />
                <span>全流程实盘自动演练</span>
                <em className={`ad-status-pill ${completed ? 'passed' : paused ? 'paused' : 'running'}`}>
                  {completed ? 'PASSED · 已完成' : paused ? 'PAUSED · 已暂停' : 'LIVE · 演练中'}
                </em>
              </div>
              <small>
                {stage.act} · 耗时 {formatClock(overallElapsedMs)} / {formatClock(totalDurationMs / speed)}
              </small>
            </div>
          </div>

          <button
            type="button"
            className="ad-hud-close"
            onClick={stopDemo}
            aria-label="退出演示"
            title="退出全流程演示 (Esc)"
          >
            <X size={14} />
          </button>
        </div>

        {/* Overall Progress Bar */}
        <div className="autodemo-hud-progress">
          <div
            className="autodemo-hud-progress-fill"
            style={{width: `${overallProgress}%`}}
          />
        </div>

        {/* Transport & Speed Controls */}
        <div className="autodemo-hud-controls">
          <button
            type="button"
            className="ad-ctrl-btn"
            onClick={() => jumpToStage(stageIdx - 1)}
            disabled={stageIdx === 0}
            title="上一阶段"
          >
            <SkipBack size={12} />
          </button>

          <button
            type="button"
            className="ad-ctrl-btn primary"
            onClick={() => (completed ? startDemo() : setPaused(p => !p))}
          >
            {completed ? (
              <>
                <RotateCcw size={12} />
                <span>重新演练</span>
              </>
            ) : paused ? (
              <>
                <Play size={12} />
                <span>继续演练</span>
              </>
            ) : (
              <>
                <Pause size={12} />
                <span>暂停</span>
              </>
            )}
          </button>

          <button
            type="button"
            className="ad-ctrl-btn"
            onClick={() => jumpToStage(stageIdx + 1)}
            disabled={stageIdx >= DEMO_STAGES.length - 1}
            title="下一阶段"
          >
            <SkipForward size={12} />
          </button>

          <button
            type="button"
            className="ad-ctrl-btn speed"
            onClick={() => setSpeed(s => (s === 1 ? 1.5 : s === 1.5 ? 2 : 1))}
            title="切换演示节奏倍速"
          >
            <FastForward size={11} />
            <span>{speed === 1 ? '1.0x 录屏' : `${speed}x 倍速`}</span>
          </button>

          <button
            type="button"
            className={`ad-ctrl-btn ${voiceEnabled ? 'voice-on' : ''}`}
            onClick={() => {
              const next = !voiceEnabled;
              setVoiceEnabled(next);
              if (!next && 'speechSynthesis' in window) {
                window.speechSynthesis.cancel();
              }
            }}
            title="开启/关闭中文语音播报"
          >
            {voiceEnabled ? <Volume2 size={12} /> : <VolumeX size={12} />}
          </button>
        </div>

        {/* 10-Stage Live Route / Pipeline Checklist */}
        <div className="autodemo-stage-list">
          {DEMO_STAGES.map((st, idx) => {
            const isPassed = completed || idx < stageIdx;
            const isRunning = !completed && idx === stageIdx;
            return (
              <button
                key={st.id}
                type="button"
                className={`autodemo-stage-item ${
                  isRunning ? 'running' : isPassed ? 'passed' : 'queued'
                }`}
                onClick={() => jumpToStage(idx)}
              >
                <span className="ad-stage-idx">
                  {isPassed ? <CheckCircle2 size={12} /> : st.code}
                </span>
                <div className="ad-stage-copy">
                  <div className="ad-stage-row">
                    <strong>{st.title}</strong>
                    <em>{st.engine === 'clob' ? 'CLOB' : 'BATCH'}</em>
                  </div>
                  {isRunning && (
                    <div className="ad-stage-subbar">
                      <div style={{width: `${stageProgress}%`}} />
                    </div>
                  )}
                </div>
                <ChevronRight size={12} className="ad-stage-arrow" />
              </button>
            );
          })}
        </div>
      </aside>

      {/* Bottom Broadcast Teleprompter & Mechanism Lower-Third */}
      <section
        className={`autodemo-teleprompter ${
          !completed &&
          (stage.targetSelector.includes('bottom-dock') ||
            stage.targetSelector.includes('activity') ||
            stage.targetSelector.includes('fb-dock'))
            ? 'pos-top'
            : ''
        }`}
        aria-label="实时演示讲解字幕与机制图解"
      >
        <div className="autodemo-tp-top">
          <div className="autodemo-tp-meta">
            <span className="ad-tp-act">{stage.act}</span>
            <span className="ad-tp-step">
              STAGE {stage.code} / 10 · {stage.title}
            </span>
          </div>

          <div className="autodemo-tp-nodes">
            {stage.nodes.map((n, idx) => (
              <div key={n.code} className="ad-tp-node-wrap">
                <div className={`ad-tp-node tone-${n.tone}`}>
                  <small>{n.code}</small>
                  <strong>{n.label}</strong>
                  <span>{n.sub}</span>
                </div>
                {idx < stage.nodes.length - 1 && (
                  <span className="ad-tp-node-arrow">→</span>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="autodemo-tp-body">
          <div className="autodemo-tp-narration">
            <span className="ad-mic-badge">
              {completed ? <ShieldCheck size={14} /> : <Sparkles size={14} />}
              <b>{completed ? '演练完成' : `讲解 ${cueIdx + 1}/${stage.cues.length}`}</b>
            </span>
            <p>
              {completed
                ? '全流程 10 大实盘环节已全部验证通过：连续限价订单簿（FIFO）、自然语言确定性原子网格、以及抗 MEV 密封集合竞价（FairBatch）均已完成链上闭环。'
                : currentCue?.narration}
            </p>
          </div>

          <div className="autodemo-tp-formula">
            <code>{stage.formula}</code>
          </div>
        </div>
      </section>
    </div>
  );
}

/** Header button component that can be dropped into both CLOB and FairBatch topbars */
export function AutoDemoHeaderButton() {
  const [state, setState] = useState<{
    active: boolean;
    paused: boolean;
    completed: boolean;
    stageIdx: number;
    totalStages: number;
    overallProgress: number;
  }>({
    active: false,
    paused: false,
    completed: false,
    stageIdx: 0,
    totalStages: 10,
    overallProgress: 0,
  });

  useEffect(() => {
    const onState = (e: Event) => {
      const custom = e as CustomEvent;
      if (custom.detail) setState(custom.detail);
    };
    window.addEventListener('monad-dex:autodemo-state', onState);
    return () => window.removeEventListener('monad-dex:autodemo-state', onState);
  }, []);

  return (
    <button
      type="button"
      className={`autodemo-trigger-btn ${state.active ? 'active' : ''}`}
      onClick={() => window.dispatchEvent(new CustomEvent('monad-dex:toggle-autodemo'))}
      title="一键启动 ~3 分钟全流程实盘自动演示（含动效框选、自动交互与同步讲解字幕）"
    >
      <span className="autodemo-trigger-icon">
        {state.active && !state.paused && !state.completed ? (
          <Activity size={12} className="spin-pulse" />
        ) : (
          <Play size={11} />
        )}
      </span>
      <span className="autodemo-trigger-label">
        {state.active
          ? state.completed
            ? '演练完成 · 重播'
            : `演练中 ${String(state.stageIdx + 1).padStart(2, '0')}/${state.totalStages} (${state.overallProgress}%)`
          : '一键全流程演示'}
      </span>
    </button>
  );
}
