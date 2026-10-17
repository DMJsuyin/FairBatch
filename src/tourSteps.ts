export type TourVisualNode = {
  code: string;
  label: string;
  sub: string;
  tone?: 'gold' | 'green' | 'rose' | 'neutral';
};

export type TourMetric = {
  label: string;
  value: string;
  tone?: 'gold' | 'green' | 'rose';
};

export type TourStep = {
  id: string;
  engine?: 'clob' | 'fairbatch';
  target: string;
  chapter: string;
  title: string;
  description: string;
  cue: string;
  visualTitle?: string;
  visualNodes?: TourVisualNode[];
  formula?: string;
  metrics?: TourMetric[];
  actionLabel?: string;
};

export const terminalTour: TourStep[] = [
  {
    id: 'market',
    engine: 'clob',
    target: 'market',
    chapter: '链上实时盘口概览',
    title: '一屏读取链上 BBO、价差与合约托管资产',
    description:
      '顶部行情带直接从 OrderBook 合约状态聚合最新成交价（LAST）、中间参考价（MID）、最优买卖一档（BBO）与有效挂单数，右侧同步显示个人合约可用余额与已实现 FIFO 收益。',
    cue: '买卖价差（Spread）同时以 Tick 与基点（bps）展示，直观反映当前链上订单簿的即时冲击成本。',
    visualTitle: '链上双边报价与价差结构 (BBO MICROSTRUCTURE)',
    visualNodes: [
      {code: 'BID 1', label: '最优买一 0.99', sub: '买方最高挂单边界', tone: 'green'},
      {code: 'SPREAD', label: '价差 0.02 (200 bps)', sub: 'MID = (Bid + Ask) / 2', tone: 'gold'},
      {code: 'ASK 1', label: '最优卖一 1.01', sub: '卖方最低挂单边界', tone: 'rose'},
    ],
    formula: 'Tick = 0.01 dUSDC  |  Lot = 0.01 dMON  |  Capacity = 128 Active Orders',
    metrics: [
      {label: '报价精度', value: '0.01 dUSDC', tone: 'gold'},
      {label: '最小手数', value: '0.01 dMON'},
      {label: '状态同步', value: '逐区块实盘读取', tone: 'green'},
    ],
  },
  {
    id: 'book',
    engine: 'clob',
    target: 'book',
    chapter: '全链 L2 深度订单簿',
    title: '10 档双边真实挂单，价格优先、同价 FIFO 撮合',
    description:
      '上方红区为卖盘（Asks），下方绿区为买盘（Bids），背景横向柱代表累计深度（Cumulative Depth）。点击任意一档价格或中间价，即可将价格一键带入右侧委托单。',
    cue: '当买方限价高于卖一价时，合约按更优的 Maker 挂单价成交，并将多锁定的 dUSDC 差价在同一笔交易内自动退回。',
    visualTitle: '价格优先 · 时间优先撮合流 (PRICE-TIME FIFO)',
    visualNodes: [
      {code: 'STEP 01', label: '遍历最优对手档', sub: '卖盘升序 / 买盘降序', tone: 'gold'},
      {code: 'STEP 02', label: '同价位队列 FIFO', sub: '先挂单者优先成交', tone: 'neutral'},
      {code: 'STEP 03', label: 'Maker 价结算退差', sub: '买方改善差价自动退回', tone: 'green'},
    ],
    formula: 'Refund_Buyer = (Limit_Price - Maker_Ask_Price) × Fill_Lots',
    metrics: [
      {label: '聚合档位', value: '买卖各 10 档'},
      {label: '单笔撮合上限', value: '最多匹配 32 笔', tone: 'gold'},
      {label: '自成交保护', value: '合约层强制拦截', tone: 'green'},
    ],
    actionLabel: '演练：点击带入最优买一价到委托栏',
  },
  {
    id: 'trade',
    engine: 'clob',
    target: 'execution',
    chapter: '受控边界单笔执行',
    title: 'Post-Only 只做挂单方 vs IOC 保护价立即吃单',
    description:
      '手动委托支持两种专业执行策略：限价挂单可开启 Post-Only（若立即吃单则整笔回滚，确保只做提供流动性的 Maker）；IOC 吃单则在保护价内立即撮合，未成交余量即刻释放。',
    cue: 'IOC 模式支持设置「最低成交量（Min Fill）」，若盘口深度不足导致成交低于阈值，合约将原子回滚以防滑点损耗。',
    visualTitle: '双模式执行边界保障 (EXECUTION GUARDRAILS)',
    visualNodes: [
      {code: 'POST-ONLY', label: '强制只做 Maker', sub: '跨盘立即成交则 Revert', tone: 'green'},
      {code: 'IOC LIMIT', label: '保护价内即时吃单', sub: '剩余未成交量自动释放', tone: 'gold'},
      {code: 'MIN FILL', label: '最低成交手数约束', sub: '深度不足整笔原子回滚', tone: 'rose'},
    ],
    formula: 'IOC: Fill >= MinFill &&ExecPrice <= LimitPrice  ⇒  Commit',
    metrics: [
      {label: '挂单模式', value: 'GTC / Post-Only', tone: 'green'},
      {label: '吃单模式', value: 'IOC + MinFill', tone: 'gold'},
      {label: '结算方式', value: '合约内部余额秒结'},
    ],
    actionLabel: '演练：切换查看 IOC 保护价吃单面板',
  },
  {
    id: 'grid',
    engine: 'clob',
    target: 'execution',
    chapter: '意图转确定性网格',
    title: '一句自然语言策略，拆解为多档双边原子网格',
    description:
      '输入交易意图或调整层数、区间、预算与方向偏置，通过「规则解析」或「AI 解析」生成确定性参数，预览每档买卖价格与资金占用后，由单笔链上交易原子批量挂出。',
    cue: 'AI 与规则引擎仅生成可读参数，绝不代签交易。勾选 replaceOrders 可在一笔交易内先清空旧挂单再部署新网格。',
    visualTitle: '意图到链上批量挂单流水线 (INTENT-TO-GRID PIPELINE)',
    visualNodes: [
      {code: '01 PARSE', label: '规则 / AI 意图解析', sub: '提取区间、层数与偏置', tone: 'gold'},
      {code: '02 ALLOC', label: '确定性步长拆单', sub: '严格对齐 0.01 Tick/Lot', tone: 'green'},
      {code: '03 BATCH', label: '单笔交易原子上链', sub: 'batchPlace / replaceOrders', tone: 'gold'},
    ],
    formula: '1 Tx = Cancel_Old(≤16) + Place_New_Grid(2..16 Post-Only Levels)',
    metrics: [
      {label: '网格层数', value: '2 ~ 16 档可调', tone: 'gold'},
      {label: '方向偏置', value: '偏多 / 中性 / 偏空'},
      {label: '原子性', value: '任一跨盘整批回滚', tone: 'green'},
    ],
    actionLabel: '演练：立即生成 8 档双边网格可视化预览',
  },
  {
    id: 'chart',
    engine: 'clob',
    target: 'chart',
    chapter: '实盘 K 线与 Arena 对手盘',
    title: '零预言机插值，纯链上 Trade 事件合成 1m K 线与 VWAP',
    description:
      '走势图完全由合约抛出的真实 Trade 事件实时聚合为 1 分钟 OHLC 蜡烛图与成交量加权均价（VWAP）。右上角集成 Arena 自动对手盘，一键触发最高 20 笔真实链上 IOC 交替吃单。',
    cue: '路演时点击图表右上角「Arena 交易流」，即可直观演示挂单被对手盘逐笔吃掉、K 线与成交流同步跳动的全过程。',
    visualTitle: '链上事件驱动行情合成 (ON-CHAIN EVENT AGGREGATION)',
    visualNodes: [
      {code: 'ARENA', label: '规则对手盘发单', sub: '独立测试账户 IOC 吃单', tone: 'gold'},
      {code: 'EVENT', label: 'OrderBook Trade', sub: '链上实盘撮合抛出事件', tone: 'green'},
      {code: 'OHLCV', label: '1m K线 + VWAP', sub: '前端实时聚合无中心化源', tone: 'neutral'},
    ],
    formula: 'VWAP = ∑(Fill_Price_i × Fill_Lots_i) / ∑(Fill_Lots_i)',
    metrics: [
      {label: '数据来源', value: '100% 链上 Trade 事件', tone: 'green'},
      {label: '支持视图', value: 'K线蜡烛图 / 分时均价'},
      {label: 'Arena 节流', value: '单轮最多 20 笔实盘', tone: 'gold'},
    ],
  },
  {
    id: 'receipts',
    engine: 'clob',
    target: 'activity',
    chapter: '全链路账本与资产核验',
    title: '当前委托、逐笔成交、交易回执与 FIFO 收益同屏穿透',
    description:
      '下方多标签工作台集中管理活动挂单（支持单笔或批量原子撤单）、全市场逐笔成交（Fills）、会话交易哈希与 Gas 消耗（Receipts），以及合约内可用/锁定资产与配对收益。',
    cue: '点击顶部引擎切换栏的「02 密封集合竞价 · FairBatch」，可无缝切入同平台的抗抢跑统一清算工作台。',
    visualTitle: '合约自托管资金状态机 (CUSTODY & PNL LEDGER)',
    visualNodes: [
      {code: 'FREE', label: '合约可用余额', sub: '随时下单或提取回钱包', tone: 'green'},
      {code: 'LOCKED', label: '挂单锁定资产', sub: '撤单或退差后即刻释放', tone: 'gold'},
      {code: 'FIFO PNL', label: '已配对实现盈亏', sub: '按成交事件先进先出核算', tone: 'neutral'},
    ],
    formula: 'Total_Custody = Free_Balance + ∑(Open_Order_Locked)',
    metrics: [
      {label: '批量撤单', value: '单笔最高撤销 16 单', tone: 'gold'},
      {label: '收益口径', value: '链上成交 FIFO 配对'},
      {label: '管理权限', value: '无 Admin 私钥后门', tone: 'green'},
    ],
    actionLabel: '演练：切入 FairBatch 密封集合竞价工作台',
  },
];

export const fairBatchTour: TourStep[] = [
  {
    id: 'round',
    engine: 'fairbatch',
    target: 'round',
    chapter: '批次生命周期与倒计时',
    title: '固定时间窗口收集报价，消除交易排序（MEV）抢跑优势',
    description:
      '每一轮竞价依次经历「01 密封提交 → 02 封盘揭示 → 03 统一清算 → 04 资产到账」四个确定性阶段。顶部状态条实时显示当前轮次编号、阶段进度、倒计时与核心清算指标。',
    cue: '在密封提交期（60s），到达区块的先后顺序不影响最终成交价与分配权，无需比拼 Gas 费抢跑。',
    visualTitle: '四阶段密封集合竞价状态机 (BATCH LIFECYCLE)',
    visualNodes: [
      {code: '01 COMMIT', label: '密封哈希提交 (60s)', sub: '仅上链承诺哈希与锁仓', tone: 'gold'},
      {code: '02 REVEAL', label: '公开真实限价 (60s)', sub: '校验盐值与哈希一致性', tone: 'green'},
      {code: '03 SETTLE', label: '求取统一清算价 P*', sub: '双指针扫描 + 差价退回', tone: 'gold'},
    ],
    formula: 'Phase ∈ {Commit(60s) → Reveal(60s) → Settle(120s) → Claim}',
    metrics: [
      {label: '单轮容量', value: '最多 32 笔有效单', tone: 'gold'},
      {label: '价格特权', value: '同批全员同一清算价', tone: 'green'},
      {label: '顺序依赖', value: '0 (同集合结果恒定)'},
    ],
  },
  {
    id: 'ticket',
    engine: 'fairbatch',
    target: 'ticket',
    chapter: '密码学密封委托单',
    title: '限价在封盘前保持哈希密封，支持 2^k 锁仓掩码与自动揭示',
    description:
      '买入填写最高可接受买价，卖出填写最低可接受卖价。提交时上链的是绑定 ChainID、合约、轮次与 32 字节随机盐的 Keccak-256 承诺哈希；开启「2^k 档位掩码」可进一步隐藏精确锁仓金额。',
    cue: '勾选「封盘后自动揭示」并保持页面开启，进入揭示期后浏览器会自动提交明文参数完成揭示，同时支持导出 JSON 凭据离线备份。',
    visualTitle: '抗重放哈希承诺与掩码锁仓 (CRYPTOGRAPHIC COMMIT)',
    visualNodes: [
      {code: 'SECRET', label: '本地生成 32B 盐值', sub: '限价与数量保存在本地', tone: 'gold'},
      {code: 'PADDING', label: '2^k 阶梯掩码锁仓', sub: '按 1/2/4/8 整数档锁仓', tone: 'neutral'},
      {code: 'COMMIT', label: 'Keccak256 哈希上链', sub: '防跨链、跨轮次重放', tone: 'green'},
    ],
    formula: 'H = keccak256(Domain, ChainId, Contract, Round, Owner, Side, Lots, Limit, Salt)',
    metrics: [
      {label: '隐私保护', value: '封盘前隐藏报价限价', tone: 'gold'},
      {label: '掩码退款', value: '多锁保证金结算全退', tone: 'green'},
      {label: '委托签名', value: 'EIP-712 免 Gas 代发'},
    ],
  },
  {
    id: 'clearing',
    engine: 'fairbatch',
    target: 'clearing',
    chapter: '统一清算供需交叉曲线',
    title: '买盘降序与卖盘升序交汇，唯一确定最大成交量 V* 与统一价 P*',
    description:
      '揭示期结束后，全部有效订单汇总为累计买盘需求曲线（绿）与累计卖盘供给曲线（红）。算法先通过双指针最大化成交量 V*，再取边际买卖价区间中点作为全员共享的唯一清算价 P*。',
    cue: '任何成交者的实际结算价绝不劣于其申报限价；买方限价高于 P* 的价差改善将随未成交部分一并原路退回。',
    visualTitle: '最大成交量与中点统一定价 (UNIFORM CLEARING P*)',
    visualNodes: [
      {code: 'MAX VOL', label: '双指针扫描求 V*', sub: '优先满足最优买卖报价', tone: 'green'},
      {code: 'BOUNDS', label: '提取边际区间 [L, H]', sub: '第 V* 手对应买卖限价', tone: 'neutral'},
      {code: 'MIDPOINT', label: '统一价 P* = ⌊(L+H)/2⌋', sub: '所有成交共享同一价格', tone: 'gold'},
    ],
    formula: 'P* = Marginal_Ask(L) + floor((Marginal_Bid(H) - Marginal_Ask(L)) / 2)',
    metrics: [
      {label: '定价复杂度', value: 'O(n) 双指针扫描', tone: 'green'},
      {label: '价格改善', value: '买卖双方共享中点盈余', tone: 'gold'},
      {label: '资金守恒', value: '两侧成交手数严格相等'},
    ],
  },
  {
    id: 'compare',
    engine: 'fairbatch',
    target: 'fb-dock',
    chapter: '顺序无关对照实验 & 防作恶验证',
    title: '6 种到达顺序对照实验 + O(n) 排序见证防漏单攻击核验',
    description:
      '下方多标签实验台集成四大核验工具：「链上承诺账本」实时读取合约订单；「顺序对照实验」验证 6 种交易到达顺序下 FairBatch 始终输出同一结果；「见证防作恶」支持一键模拟恶意漏单见证并触发合约位图回滚。',
    cue: '点击下方按钮可直接轮换 6 种上链排列顺序，向评委直观展示连续撮合的价格漂移 vs FairBatch 的绝对顺序无关性。',
    visualTitle: '连续撮合 vs FairBatch 顺序敏感度对比 (ORDER INDEPENDENCE)',
    visualNodes: [
      {code: 'CLOB 6!', label: '连续撮合：结果随顺序变', sub: '成交价在 90~110 间漂移', tone: 'rose'},
      {code: 'BATCH 6!', label: 'FairBatch：结果恒定唯一', sub: '6 种排列均以 100 成交', tone: 'green'},
      {code: 'WITNESS', label: 'O(n) 位图完整性校验', sub: '漏单或乱序立即 Revert', tone: 'gold'},
    ],
    formula: 'Bitmap_Seen == Expected_Mask  &&  Monotone_Sorted  ⇒  Valid_Witness',
    metrics: [
      {label: '实验样本', value: 'A买≤110 / B卖≥90 / C买≤100'},
      {label: '排列组合', value: '6 种到达顺序全覆盖', tone: 'gold'},
      {label: '客户端复核', value: '浏览器独立算法交叉验证', tone: 'green'},
    ],
    actionLabel: '演练：在实验台切换对比不同订单到达顺序',
  },
];
