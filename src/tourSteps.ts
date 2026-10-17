export type TourStep = {
  id: string;
  target: string;
  chapter: string;
  title: string;
  description: string;
  cue: string;
};

export const terminalTour: TourStep[] = [
  {id:'market',target:'market',chapter:'认识市场',title:'先看市场，再做决定',description:'最新成交、买卖价差和有效挂单集中在这里。右侧区块号随链上同步更新，让你知道当前看到的是哪一刻的市场。',cue:'关注买卖价差：它反映立即交易时两侧报价的距离。'},
  {id:'book',target:'book',chapter:'理解流动性',title:'每一档价格，都有真实挂单',description:'红色是卖单，绿色是买单；背景深度表示该档数量。交易按价格优先、同价时间优先撮合。',cue:'退出导览后，点击任意报价，可将价格带入手动委托。'},
  {id:'trade',target:'execution',chapter:'控制成交边界',title:'把可接受的价格写进订单',description:'限价委托可以留在订单簿等待成交；保护价吃单（IOC）只在你的边界内立即撮合，剩余部分自动取消。',cue:'Post-only 保证只挂单；IOC 的最低成交数量用于避免过少成交。'},
  {id:'grid',target:'execution',chapter:'从意图到订单',title:'一句策略，拆成多档网格',description:'输入交易意图，或直接调整区间、层数和资金。先预览每档价格与数量，核对资金占用，再签名批量执行。',cue:'规则解析与 AI 解析都只生成参数。网格是一次性批量挂单，成交后不会自动补单。'},
  {id:'chart',target:'chart',chapter:'观察执行效果',title:'让成交过程看得见',description:'走势图来自实际链上成交。Arena 可提供规则驱动的对手盘，方便演示订单成交与行情变化。',cue:'需要演示成交时，退出导览后点击「运行」；一轮最多 20 笔，可随时停止。'},
  {id:'receipts',target:'activity',chapter:'核验每笔交易',title:'从操作一直追溯到链上回执',description:'当前委托用于查看和撤销挂单，市场成交展示撮合结果。交易回执保留本次会话的操作状态、Gas 用量与交易哈希。',cue:'「已确认」才代表链上完成。没有提交过交易时，回执区域会显示空状态。'},
  {id:'account',target:'account',chapter:'管理交易资金',title:'可用与锁定，分开看清',description:'挂单占用的资产会进入锁定状态，撤单后释放。资金管理负责钱包与订单簿合约间的充值和提取。',cue:'收益按 FIFO 配对成交计算，未扣 Gas；未连接钱包时，个人资产显示为横线。'},
  {id:'wallet',target:'wallet',chapter:'开始你的演示',title:'连接钱包，走一遍完整流程',description:'准备好后，使用浏览器钱包或演示钱包：设置策略 → 核对预览 → 签名执行 → 查看回执。也可以继续了解 FairBatch 的密封集合竞价。',cue:'导览到这里完成。关闭后恢复原来的交易视图，所有表单输入都会保留。'},
];

export const fairBatchTour: TourStep[] = [
  {id:'round',target:'round',chapter:'认识交易轮次',title:'同一批报价，一起参与清算',description:'每轮依次经过密封提交、封盘揭示、统一清算和资产到账。这里展示当前阶段与倒计时，也可以切换历史轮次。',cue:'先确认轮次与阶段。只有密封提交阶段接受新订单。'},
  {id:'ticket',target:'ticket',chapter:'设置价格边界',title:'只需说清：买多少，最多多少钱',description:'买入填最高可接受价，卖出填最低可接受价。每轮每个钱包一笔订单，提交前可以看到本笔需要锁定的资产。',cue:'限价是成交边界，不是最终成交价；清算后，价差与未成交部分会返还。'},
  {id:'reveal',target:'reveal',chapter:'密封与揭示',title:'先锁定承诺，再公开报价',description:'提交时上链的是哈希承诺，限价在封盘前保持密封。自动揭示开启且页面保持打开时，应用会在揭示期提交订单详情。',cue:'方向与锁仓金额仍可在链上查看。订单凭据可导出备份、导入恢复，请在真实操作前保存。'},
  {id:'clearing',target:'clearing',chapter:'统一清算',title:'供需相遇，形成一个成交价',description:'揭示后的有效订单汇总成供需曲线。算法先求最大可成交量，再从可行价格区间确定统一成交价。',cue:'密封阶段不展示限价；看到供需曲线后，结合已揭示数量判断信息是否完整。'},
  {id:'allocation',target:'algorithm',chapter:'解释分配规则',title:'为什么成交这些数量？有规则可查',description:'更优报价优先成交。同价竞争剩余数量时，按订单数量比例分配，余数大的优先补一手；同余数按地址确定。',cue:'这里解释最大成交量、统一定价和同价分配，帮助评委理解结果如何得出。'},
  {id:'compare',target:'compare',chapter:'验证机制差异',title:'只换提交顺序，观察结果变化',description:'这组固定三单实验对照连续撮合与 FairBatch。连续撮合的成交价或买方可能随顺序改变；本例的批量清算结果保持一致。',cue:'退出导览后，点击六种排列亲自比较。这是固定样例实验，不是实时成交数据。'},
  {id:'mine',target:'my-order',chapter:'查看我的结果',title:'成交多少，剩余资金去了哪里',description:'我的订单显示密封、揭示、清算与到账状态。清算后可核对实际成交量，以及应收或已收的两种资产。',cue:'若显示等待领取，使用「领取资产」完成到账；恢复凭据后也能查看对应订单。'},
  {id:'orders',target:'orders',chapter:'核对链上证据',title:'每一笔订单，都可对照验证',description:'本轮订单表直接读取合约，列出方向、揭示后的限价、成交数量与状态。自动对手盘会单独标记，便于区分演示参与者。',cue:'从限价出发，对照统一成交价、分配规则和到账结果，完成一次可解释的交易演示。'},
];
