import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  Activity,
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  ChartNoAxesCombined,
  Check,
  ChevronRight,
  CircleHelp,
  Copy,
  ExternalLink,
  FileText,
  History,
  Layers3,
  LoaderCircle,
  LogOut,
  Pause,
  Play,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Wallet,
  X,
} from 'lucide-react';
import MarketChart from './MarketChart';
import Dialog from './Dialog';
import DemoTour from './DemoTour';
import {terminalTour, type TourStep} from './tourSteps';
import type {Address, Hash} from 'viem';
import {
  createMarket,
  errorMessage,
  tokenAmount,
  zeroSnapshot,
  type Deployment,
  type Entry,
  type Market,
  type Snapshot,
} from './chain';
import {bookAbi, tokenAbi} from './abi';
import {allocateGrid, defaultIntent, parseIntent, validateIntent, type GridIntent} from './grid';
import {realizedPnl} from './analytics';

const fmt = (v: number, d = 2) =>
  v.toLocaleString('en-US', {minimumFractionDigits: d, maximumFractionDigits: d});
const amount = (v: bigint, decimals = 6) => Number(v) / 10 ** decimals;
const short = (s: string) => `${s.slice(0, 6)}…${s.slice(-4)}`;

type Tx = {hash: Hash; label: string; status: 'pending' | 'success' | 'failed'; gas?: string};
type BookLevel = {price: bigint; lots: bigint; cumLots: bigint};

function levels(rows: readonly Entry[]): BookLevel[] {
  const grouped: {price: bigint; lots: bigint}[] = [];
  for (const row of rows) {
    const last = grouped.at(-1);
    if (last?.price === row.price) last.lots += row.lots;
    else grouped.push({price: row.price, lots: row.lots});
  }
  const top10 = grouped.slice(0, 10);
  let running = 0n;
  return top10.map(item => {
    running += item.lots;
    return {price: item.price, lots: item.lots, cumLots: running};
  });
}

export default function App() {
  const [market, setMarket] = useState<Market>();
  const [snapshot, setSnapshot] = useState<Snapshot>(zeroSnapshot);
  const [account, setAccount] = useState<Address>();
  const [wallet, setWallet] = useState<any>();
  const [bootError, setBootError] = useState('');
  const [syncError, setSyncError] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [txs, setTxs] = useState<Tx[]>([]);
  const [tab, setTab] = useState<'trade' | 'grid'>('grid');
  const [bottom, setBottom] = useState<'orders' | 'fills' | 'receipts'>('orders');
  const [side, setSide] = useState(true);
  const [kind, setKind] = useState<'limit' | 'ioc'>('limit');
  const [price, setPrice] = useState('1.00');
  const [quantity, setQuantity] = useState('10');
  const [minFill, setMinFill] = useState('0');
  const [postOnly, setPostOnly] = useState(true);
  const [intentText, setIntentText] = useState(
    '震荡偏多，±4% 区间铺 8 层网格，买入预算 500 USDC，卖出库存 300 MON。'
  );
  const [intent, setIntent] = useState<GridIntent>(defaultIntent);
  const [preview, setPreview] = useState<ReturnType<typeof allocateGrid>>();
  const [intentSource, setIntentSource] = useState('');
  const [intentBusy, setIntentBusy] = useState(false);
  const [replace, setReplace] = useState(false);
  const [dialog, setDialog] = useState<'wallet' | 'about'>();
  const [workspaceView, setWorkspaceView] = useState<'terminal' | 'grid' | 'history'>('terminal');
  const [funding, setFunding] = useState(false);
  const [fundBase, setFundBase] = useState(false);
  const [fundAmount, setFundAmount] = useState('500');
  const [arena, setArena] = useState(false);
  const [arenaCount, setArenaCount] = useState(0);

  const arenaStop = useRef(true);
  const busyLock = useRef(false);
  const refreshLock = useRef(false);
  const mounted = useRef(true);
  const tourSnapshot = useRef<{
    tab: 'trade' | 'grid';
    bottom: 'orders' | 'fills' | 'receipts';
    workspaceView: 'terminal' | 'grid' | 'history';
  } | null>(null);

  useEffect(() => {
    mounted.current = true;
    let live = true;
    fetch('/deployment.json', {cache: 'no-store'})
      .then(async r => {
        if (!r.ok) throw new Error('未找到部署信息。请稍后刷新重试，或联系维护人员。');
        return r.json();
      })
      .then((d: Deployment) => {
        if (live) setMarket(createMarket(d));
      })
      .catch(e => {
        if (live) setBootError(errorMessage(e));
      });
    return () => {
      live = false;
      mounted.current = false;
      arenaStop.current = true;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!market || refreshLock.current) return;
    refreshLock.current = true;
    try {
      const s = await market.snapshot(account);
      if (mounted.current) {
        setSnapshot(s);
        setSyncError('');
      }
    } catch (e) {
      if (mounted.current) setSyncError(errorMessage(e));
    } finally {
      refreshLock.current = false;
    }
  }, [market, account]);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 2500);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    const p = (window as any).ethereum;
    if (!p?.on) return;
    const reset = () => {
      setAccount(undefined);
      setWallet(undefined);
      setNotice('钱包账户或网络已变化，请重新连接。');
      arenaStop.current = true;
    };
    p.on('accountsChanged', reset);
    p.on('chainChanged', reset);
    return () => {
      p.removeListener?.('accountsChanged', reset);
      p.removeListener?.('chainChanged', reset);
    };
  }, []);

  const bids = useMemo(() => levels(snapshot.bids), [snapshot.bids]);
  const asks = useMemo(() => levels(snapshot.asks), [snapshot.asks]);
  const mid =
    bids[0] && asks[0]
      ? (bids[0].price + asks[0].price) / 2n
      : snapshot.fills.at(-1)?.price || bids[0]?.price || asks[0]?.price || 0n;
  const last = snapshot.fills.at(-1)?.price;
  const own = [...snapshot.bids, ...snapshot.asks].filter(
    o => o.owner.toLowerCase() === account?.toLowerCase()
  );
  const pnl = account
    ? realizedPnl(snapshot.fills, account)
    : {pnl: 0n, closedLots: 0n, unmatchedSells: 0n};
  const baseLocked = own
    .filter(o => !o.isBuy)
    .reduce((v, o) => v + o.lots * 10n ** 16n, 0n);
  const quoteLocked = own
    .filter(o => o.isBuy)
    .reduce((v, o) => v + o.lots * o.price * 100n, 0n);
  const hasTestWallet = !!(market?.d.demoAccount || market?.d.demoHosted);
  const networkLabel =
    market?.d.chainId === 31337 ? 'Server 78 演示链' : market?.d.network || '连接中';
  const canTrade = !!wallet && !busy && !syncError && snapshot.block > 0n;
  const maxCumDepth = Math.max(
    1,
    ...bids.map(o => Number(o.cumLots)),
    ...asks.map(o => Number(o.cumLots))
  );
  const spreadTicks = bids[0] && asks[0] ? Number(asks[0].price - bids[0].price) : null;
  const spreadBps =
    spreadTicks !== null && mid > 0n ? ((spreadTicks / Number(mid)) * 10000).toFixed(0) : null;

  async function action(label: string, fn: () => Promise<void>) {
    if (busyLock.current) return;
    busyLock.current = true;
    setBusy(label);
    setNotice('');
    try {
      await fn();
      await refresh();
      setNotice(`${label}完成`);
    } catch (e) {
      setNotice(errorMessage(e));
    } finally {
      busyLock.current = false;
      setBusy('');
    }
  }

  async function write(
    label: string,
    functionName: string,
    args: any[],
    address = market!.d.book,
    abi: any = bookAbi,
    w = wallet
  ) {
    let hash: Hash | undefined;
    try {
      const r = await market!.write(w, address, abi, functionName, args, h => {
        hash = h;
        setTxs(v => [{hash: h, label, status: 'pending' as const}, ...v].slice(0, 30));
      });
      setTxs(v =>
        v.map(t =>
          t.hash === hash ? {...t, status: 'success', gas: r.gasUsed.toString()} : t
        )
      );
      return r;
    } catch (e) {
      if (hash)
        setTxs(v => v.map(t => (t.hash === hash ? {...t, status: 'failed'} : t)));
      throw e;
    }
  }

  async function connect(local = false) {
    if (!market) return;
    await action('连接钱包', async () => {
      if (local && market.d.demoHosted) {
        const w = market.hostedWallet();
        const a = w.account.address;
        const r = await fetch('/api/demo/fund', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({address: a}),
        });
        if (!r.ok) throw new Error((await r.json()).error);
        setAccount(a);
        setWallet(w);
        for (const [token, isBase, value] of [
          [market.d.base, true, 5000n * 10n ** 18n],
          [market.d.quote, false, 5000n * 10n ** 6n],
        ] as const) {
          const free = await market.client.readContract({
            address: market.d.book,
            abi: bookAbi,
            functionName: isBase ? 'baseFree' : 'quoteFree',
            args: [a],
          });
          if (free === 0n) {
            await write('领取测试资产', 'faucet', [], token, tokenAbi, w);
            await write(
              '授权测试资产',
              'approve',
              [market.d.book, value],
              token,
              tokenAbi,
              w
            );
            await write(
              '存入测试资产',
              'deposit',
              [isBase, value],
              market.d.book,
              bookAbi,
              w
            );
          }
        }
        return;
      }
      if (local && market.d.demoAccount) {
        setAccount(market.d.demoAccount);
        setWallet(market.localWallet(market.d.demoAccount));
        return;
      }
      const p = (window as any).ethereum;
      if (!p) throw new Error('未检测到浏览器钱包，可使用测试钱包直接交易。');
      const [a] = (await p.request({method: 'eth_requestAccounts'})) as Address[];
      try {
        await p.request({
          method: 'wallet_switchEthereumChain',
          params: [{chainId: `0x${market.d.chainId.toString(16)}`}],
        });
      } catch (e: any) {
        if (e.code !== 4902) throw e;
        await p.request({
          method: 'wallet_addEthereumChain',
          params: [
            {
              chainId: `0x${market.d.chainId.toString(16)}`,
              chainName: market.d.network,
              nativeCurrency: market.chain.nativeCurrency,
              rpcUrls: [market.d.rpc],
            },
          ],
        });
      }
      setAccount(a);
      setWallet(market.injectedWallet(p, a));
    });
  }

  async function order() {
    await action('提交订单', async () => {
      const p = Number(price);
      const q = Number(quantity);
      const minimum = Number(minFill);
      if (
        !Number.isFinite(p) ||
        !Number.isFinite(q) ||
        p <= 0 ||
        q <= 0 ||
        Math.abs(p * 100 - Math.round(p * 100)) > 1e-6 ||
        Math.abs(q * 100 - Math.round(q * 100)) > 1e-6
      )
        throw new Error('价格与数量必须为正数，最多保留两位小数');
      if (
        kind === 'ioc' &&
        (!Number.isFinite(minimum) ||
          minimum < 0 ||
          minimum > q ||
          Math.abs(minimum * 100 - Math.round(minimum * 100)) > 1e-6)
      )
        throw new Error('最低成交数量须在 0 与下单数量之间，最多两位小数');
      await write('下单', 'placeOrder', [
        {
          isBuy: side,
          price: BigInt(Math.round(p * 100)),
          lots: BigInt(Math.round(q * 100)),
          ioc: kind === 'ioc',
          postOnly: kind === 'limit' && postOnly,
          minFill: kind === 'ioc' ? BigInt(Math.round(minimum * 100)) : 0n,
        },
      ]);
    });
  }

  async function generate(useAI = false) {
    setIntentBusy(true);
    setNotice('');
    setPreview(undefined);
    try {
      let x: GridIntent;
      let source: string;
      if (useAI) {
        const r = await fetch('/api/intent', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({text: intentText, defaults: intent}),
        });
        const json = await r.json();
        if (!r.ok) throw new Error(json.error || '模型服务不可用');
        x = validateIntent(json.intent);
        source = json.source;
      } else {
        x = parseIntent(intentText, intent);
        source = '规则解析 · 确定性计算';
      }
      setIntent(x);
      setPreview(allocateGrid(x, mid));
      setIntentSource(source);
    } catch (e) {
      setNotice(errorMessage(e));
    } finally {
      setIntentBusy(false);
    }
  }

  function editIntent(key: keyof GridIntent, value: number | string) {
    setIntent(v => ({...v, [key]: value}));
    setPreview(undefined);
  }

  async function deployGrid() {
    if (!preview) return;
    await action(replace ? '替换网格' : '批量挂单', async () => {
      if (replace) {
        if (own.length > 16)
          throw new Error('单次最多替换 16 笔订单，请先分批撤单');
        await write('替换网格', 'replaceOrders', [
          own.map(o => o.id),
          preview.orders,
        ]);
      } else {
        await write('网格挂单', 'batchPlaceOrders', [preview.orders]);
      }
      setPreview(undefined);
      setBottom('orders');
    });
  }

  async function funds(mode: 'deposit' | 'withdraw' | 'faucet') {
    await action(
      mode === 'deposit' ? '充值' : mode === 'withdraw' ? '提取' : '领取测试币',
      async () => {
        const token = fundBase ? market!.d.base : market!.d.quote;
        if (mode === 'faucet') {
          await write('测试币水龙头', 'faucet', [], token, tokenAbi);
          return;
        }
        const value = tokenAmount(fundAmount, fundBase);
        if (value <= 0n) throw new Error('请输入大于零的金额');
        if (mode === 'deposit') {
          const allowance = await market!.client.readContract({
            address: token,
            abi: tokenAbi,
            functionName: 'allowance',
            args: [account!, market!.d.book],
          });
          if (allowance < value)
            await write(
              '授权充值额度',
              'approve',
              [market!.d.book, value],
              token,
              tokenAbi
            );
        }
        await write(mode === 'deposit' ? '充值' : '提取', mode, [fundBase, value]);
      }
    );
  }

  async function toggleArena() {
    if (arena) {
      arenaStop.current = true;
      return;
    }
    if (
      !market ||
      (!market.d.arenaAccount && !market.d.demoHosted) ||
      market.d.chainId !== 31337
    )
      return;
    arenaStop.current = false;
    setArena(true);
    setArenaCount(0);
    let count = 0;
    const actor = market.d.demoHosted
      ? undefined
      : market.localWallet(market.d.arenaAccount!);
    try {
      while (!arenaStop.current && count < 20) {
        if (market.d.demoHosted) {
          const r = await fetch('/api/demo/arena', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: '{}',
          });
          const data = await r.json();
          if (!r.ok) throw new Error(data.error);
          setTxs(v =>
            [
              {
                hash: data.hash,
                label: 'Arena 测试成交',
                status: 'success' as const,
                gas: data.gas,
              },
              ...v,
            ].slice(0, 30)
          );
          count++;
          setArenaCount(count);
          await refresh();
          await new Promise(resolve => setTimeout(resolve, 1800));
          continue;
        }
        const s = await market.snapshot();
        const buy = count % 2 === 0;
        const top = (buy ? s.asks : s.bids)[0];
        if (!top) throw new Error('对应方向订单簿已空，演示暂停');
        await write(
          'Arena 测试成交',
          'placeOrder',
          [
            {
              isBuy: buy,
              price: top.price,
              lots: top.lots < 100n ? top.lots : 100n,
              postOnly: false,
              ioc: true,
              minFill: 1n,
            },
          ],
          market.d.book,
          bookAbi,
          actor
        );
        count++;
        setArenaCount(count);
        await refresh();
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    } catch (e) {
      setNotice(errorMessage(e));
    } finally {
      setArena(false);
      arenaStop.current = true;
    }
  }

  const txLink = (hash: string) =>
    market?.d.chainId === 10143
      ? `https://testnet.monadscan.com/tx/${hash}`
      : undefined;
  const totalVolume = snapshot.fills.reduce(
    (sum, fill) => sum + Number(fill.lots) / 100,
    0
  );
  const buyDepth = bids.reduce((sum, row) => sum + Number(row.lots), 0);
  const sellDepth = asks.reduce((sum, row) => sum + Number(row.lots), 0);

  function navigate(view: 'terminal' | 'grid' | 'history') {
    setWorkspaceView(view);
    if (view === 'grid') {
      setTab('grid');
      document.getElementById('execution')?.scrollIntoView({behavior: 'smooth', block: 'nearest'});
    } else if (view === 'history') {
      setBottom('fills');
      document.getElementById('activity')?.scrollIntoView({behavior: 'smooth', block: 'nearest'});
    } else {
      window.scrollTo({top: 0, behavior: 'smooth'});
    }
  }

  function handleTourStart() {
    tourSnapshot.current = {tab, bottom, workspaceView};
  }
  function handleTourStep(step: TourStep) {
    if (step.id === 'trade') setTab('trade');
    else if (step.id === 'grid') setTab('grid');
    else if (step.id === 'receipts') setBottom('receipts');
  }
  function handleTourFinish() {
    if (tourSnapshot.current) {
      setTab(tourSnapshot.current.tab);
      setBottom(tourSnapshot.current.bottom);
      setWorkspaceView(tourSnapshot.current.workspaceView);
      tourSnapshot.current = null;
    }
  }

  function openFunding() {
    setNotice('');
    setFunding(true);
  }
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice('已复制到剪贴板');
    } catch {
      setNotice('复制未成功，请手动选择并复制。');
    }
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#terminal">
        跳至交易终端工作区
      </a>

      {/* Institutional Top Navigation Bar (TradingVane / VECTOR AppShell Standard) */}
      <header className="topbar">
        <div className="topbar-left">
          <a className="brand-lockup" href="#terminal" aria-label="CLOB Grid 终端首页">
            <span className="brand-badge">R</span>
            <div className="brand-text">
              <div className="brand-title">
                CLOB<span>/</span>GRID
                <em className="brand-tag">INSTITUTIONAL</em>
              </div>
              <div className="brand-sub">MONAD 全链订单簿与确定性网格终端</div>
            </div>
          </a>

          <nav className="mode-nav" aria-label="交易机制切换">
            <a href="/" className="mode-link active" aria-current="page">
              <span className="mode-idx">01</span>
              <span>连续订单簿 · 意图网格</span>
            </a>
            <a href="/fairbatch" className="mode-link">
              <span className="mode-idx">02</span>
              <span>FairBatch · 密封集合竞价</span>
            </a>
          </nav>

          <div className="section-jump" role="navigation" aria-label="工作区快捷定位">
            <button
              className={workspaceView === 'terminal' ? 'active' : ''}
              onClick={() => navigate('terminal')}
            >
              <ChartNoAxesCombined size={13} />
              <span>盘口与走势</span>
            </button>
            <button
              className={workspaceView === 'grid' ? 'active' : ''}
              onClick={() => navigate('grid')}
            >
              <SlidersHorizontal size={13} />
              <span>策略执行</span>
            </button>
            <button
              className={workspaceView === 'history' ? 'active' : ''}
              onClick={() => navigate('history')}
            >
              <History size={13} />
              <span>委托与回执</span>
            </button>
          </div>
        </div>

        <div className="header-right">
          <DemoTour
            name="CLOB / Grid"
            steps={terminalTour}
            dark
            onStart={handleTourStart}
            onStep={handleTourStep}
            onFinish={handleTourFinish}
            nextTour={{
              href: '/fairbatch?tour=1',
              label: '前往 FairBatch 密封集合竞价导览',
            }}
          />

          <div className="chain-telemetry" title="链上节点状态与最新同步区块">
            <i
              className={
                bootError || syncError
                  ? 'dot danger'
                  : snapshot.block
                    ? 'dot'
                    : 'dot waiting'
              }
            />
            <span className="telemetry-net">{networkLabel}</span>
            <span className="telemetry-sep">|</span>
            <span className="telemetry-block">
              BLK #{snapshot.block ? fmt(Number(snapshot.block), 0) : '—'}
            </span>
            <button
              className="icon-button"
              aria-label="刷新链上状态"
              title="立即同步区块状态"
              onClick={() => refresh()}
            >
              <RefreshCw size={12} />
            </button>
          </div>

          <button
            className="ghost-pill"
            onClick={() => setDialog('about')}
            aria-label="产品与网络说明"
          >
            <ShieldCheck size={13} />
            <span>合约与机制</span>
          </button>

          {account && (
            <button
              className="ghost-pill gold-outline"
              disabled={!canTrade}
              onClick={openFunding}
            >
              <ArrowLeftRight size={13} />
              <span>充提 / 水龙头</span>
            </button>
          )}

          <button
            className={`wallet-button ${account ? 'connected' : ''}`}
            data-tour="wallet"
            disabled={!market || !!busy}
            onClick={() => setDialog('wallet')}
          >
            <Wallet size={13} />
            <span>{account ? short(account) : '连接钱包'}</span>
            <ChevronRight size={12} />
          </button>
        </div>
      </header>

      <div className="page-content" id="terminal">
        {(bootError || syncError) && (
          <div className="error-banner" role="alert">
            <Activity size={15} />
            <span>
              {bootError || syncError}
              {syncError && ' · 已暂停下单，正在自动重连节点。'}
            </span>
            <button onClick={() => (bootError ? window.location.reload() : refresh())}>
              立即重试
            </button>
          </div>
        )}

        {/* High-Density Institutional Market Ticker Strip */}
        <section className="market-strip" data-tour="market" aria-label="市场概览">
          <div className="pair-cell">
            <div className="token-badge">M</div>
            <div>
              <div className="pair-title-row">
                <h2>
                  dMON<span>/dUSDC</span>
                </h2>
                <span className="instrument-tag">SPOT · CLOB</span>
              </div>
              <small>PRICE-TIME PRIORITY · 0.01 TICK · ATOMIC BATCH</small>
            </div>
          </div>

          <div className="ticker-metric primary-price">
            <small>最新成交价 (LAST)</small>
            <strong className="buy">
              {last ? fmt(Number(last) / 100) : '—'}
              <span>dUSDC</span>
            </strong>
          </div>

          <div className="ticker-metric">
            <small>中间参考价 (MID)</small>
            <strong>
              {mid ? fmt(Number(mid) / 100) : '—'}
              <span>dUSDC</span>
            </strong>
          </div>

          <div className="ticker-metric">
            <small>最优买一 / 卖一 (BBO)</small>
            <strong>
              <em className="buy">{bids[0] ? fmt(Number(bids[0].price) / 100) : '—'}</em>
              <span> / </span>
              <em className="sell">{asks[0] ? fmt(Number(asks[0].price) / 100) : '—'}</em>
            </strong>
          </div>

          <div className="ticker-metric">
            <small>买卖价差 (SPREAD)</small>
            <strong>
              {spreadTicks !== null ? fmt(spreadTicks / 100) : '—'}
              {spreadBps && <span>({spreadBps} bps)</span>}
            </strong>
          </div>

          <div className="ticker-metric">
            <small>链上有效挂单 (ACTIVE)</small>
            <strong>
              {snapshot.block ? snapshot.bids.length + snapshot.asks.length : '—'}
              <span>/ 128 笔</span>
            </strong>
          </div>

          <div className="ticker-metric volume-stat">
            <small>{snapshot.partialHistory ? '近期链上成交量' : '累计链上成交量'}</small>
            <strong>
              {snapshot.block ? fmt(totalVolume) : '—'}
              <span>dMON ({snapshot.fills.length} 笔)</span>
            </strong>
          </div>

          <div className="ticker-status">
            <button className="environment-note" onClick={() => setDialog('about')}>
              <ShieldCheck size={13} />
              <span>测试资产 · 链上实盘撮合</span>
            </button>
          </div>
        </section>

        {/* Main 3-Column Institutional Terminal Grid */}
        <main className="terminal-layout">
          <div className="workspace">
            <div className="market-panels">
              {/* Left-Center: Market Chart + Arena Engine */}
              <section className="panel chart-panel" data-tour="chart">
                <div className="panel-header">
                  <div className="tv-h">
                    <h2>市场成交走势 · MARKET CHART</h2>
                  </div>
                  <span className="panel-meta">dMON / dUSDC · ON-CHAIN TRADE EVENTS</span>
                </div>

                <MarketChart snapshot={snapshot} />

                <div className="chart-footer">
                  <span>
                    <i className="dot" />
                    数据源自链上 OrderBook 合约 Trade 事件，无预言机或中心化撮合插值
                  </span>
                  <span>
                    {snapshot.partialHistory ? '近期窗口' : '部署以来'} {snapshot.fills.length} 笔成交
                    <span className="separator">|</span>
                    时区 {Intl.DateTimeFormat().resolvedOptions().timeZone}
                  </span>
                </div>

                <div className="arena-bar">
                  <div className="arena-icon">
                    <Activity size={15} />
                  </div>
                  <div className="arena-copy">
                    <div className="arena-title-row">
                      <strong>Arena 自动对手盘引擎</strong>
                      <span className="small-tag">REAL ON-CHAIN IOC</span>
                      {arena && <span className="live-badge">运行中 {arenaCount}/20</span>}
                    </div>
                    <small>
                      独立测试账户按规则交替发起 IOC 吃单（每轮最多 20 笔），实时驱动链上撮合与 K 线演进
                    </small>
                  </div>
                  <button
                    disabled={
                      (!market?.d.arenaAccount && !market?.d.demoHosted) || !!syncError
                    }
                    className={arena ? 'outline-button danger-outline' : 'arena-button'}
                    onClick={() => toggleArena()}
                  >
                    {arena ? <Pause size={13} /> : <Play size={13} />}
                    <span>{arena ? `停止交易流 (${arenaCount}/20)` : '启动 Arena 交易流'}</span>
                  </button>
                </div>
              </section>

              {/* Center: L2 Order Book */}
              <section className="panel book-panel" data-tour="book">
                <div className="panel-header">
                  <div className="tv-h">
                    <h2>订单簿 · ORDER BOOK</h2>
                  </div>
                  <span className="small-tag">10 LEVELS</span>
                </div>

                <div className="book-head">
                  <span>价格(dUSDC)</span>
                  <span>数量(dMON)</span>
                  <span>累计(dMON)</span>
                </div>

                <div className="book-rows asks">
                  {asks
                    .slice()
                    .reverse()
                    .map(o => (
                      <button
                        key={String(o.price)}
                        className="book-row sell"
                        aria-label={`以卖单价格 ${fmt(Number(o.price) / 100)} 填入委托`}
                        onClick={() => {
                          setPrice((Number(o.price) / 100).toFixed(2));
                          setTab('trade');
                        }}
                      >
                        <span
                          className="depth"
                          style={{width: `${(Number(o.cumLots) / maxCumDepth) * 100}%`}}
                        />
                        <span className="price-col">{fmt(Number(o.price) / 100)}</span>
                        <span className="qty-col">{fmt(Number(o.lots) / 100)}</span>
                        <span className="cum-col">{fmt(Number(o.cumLots) / 100)}</span>
                      </button>
                    ))}
                  {!asks.length && (
                    <p className="empty-small">
                      {snapshot.block ? '卖盘暂无挂单' : '正在同步卖盘深度…'}
                    </p>
                  )}
                </div>

                <div
                  className="mid-price"
                  role="button"
                  tabIndex={0}
                  title="点击将中间价填入委托单"
                  onClick={() => {
                    if (mid) {
                      setPrice((Number(mid) / 100).toFixed(2));
                      setTab('trade');
                    }
                  }}
                  onKeyDown={e => {
                    if ((e.key === 'Enter' || e.key === ' ') && mid) {
                      e.preventDefault();
                      setPrice((Number(mid) / 100).toFixed(2));
                      setTab('trade');
                    }
                  }}
                >
                  <div className="mid-main">
                    <strong>{mid ? fmt(Number(mid) / 100) : '—'}</strong>
                    <span className="mid-tag">MID</span>
                  </div>
                  <span className="mid-spread">
                    SPRD {spreadTicks !== null ? fmt(spreadTicks / 100) : '—'}
                  </span>
                </div>

                <div className="book-rows bids">
                  {bids.map(o => (
                    <button
                      key={String(o.price)}
                      className="book-row buy"
                      aria-label={`以买单价格 ${fmt(Number(o.price) / 100)} 填入委托`}
                      onClick={() => {
                        setPrice((Number(o.price) / 100).toFixed(2));
                        setTab('trade');
                      }}
                    >
                      <span
                        className="depth"
                        style={{width: `${(Number(o.cumLots) / maxCumDepth) * 100}%`}}
                      />
                      <span className="price-col">{fmt(Number(o.price) / 100)}</span>
                      <span className="qty-col">{fmt(Number(o.lots) / 100)}</span>
                      <span className="cum-col">{fmt(Number(o.cumLots) / 100)}</span>
                    </button>
                  ))}
                  {!bids.length && (
                    <p className="empty-small">
                      {snapshot.block ? '买盘暂无挂单' : '正在同步买盘深度…'}
                    </p>
                  )}
                </div>

                <div className="depth-summary">
                  <div className="depth-labels">
                    <span className="buy">
                      BID{' '}
                      {buyDepth + sellDepth
                        ? fmt((buyDepth / (buyDepth + sellDepth)) * 100, 0)
                        : '50'}
                      %
                    </span>
                    <span className="depth-center">失衡度 IMBALANCE</span>
                    <span className="sell">
                      {buyDepth + sellDepth
                        ? fmt((sellDepth / (buyDepth + sellDepth)) * 100, 0)
                        : '50'}
                      % ASK
                    </span>
                  </div>
                  <div className="depth-ratio">
                    <i
                      style={{
                        width: `${
                          buyDepth + sellDepth
                            ? (buyDepth / (buyDepth + sellDepth)) * 100
                            : 50
                        }%`,
                      }}
                    />
                  </div>
                </div>
              </section>
            </div>

            {/* Bottom Ledger: Open Orders, Market Fills, Tx Receipts */}
            <section
              className="panel activity-panel"
              id="activity"
              data-tour="activity"
              aria-label="交易记录"
            >
              <div className="panel-header tabs">
                <div className="activity-tabs" role="tablist" aria-label="交易记录类型">
                  <button
                    role="tab"
                    aria-selected={bottom === 'orders'}
                    className={bottom === 'orders' ? 'active' : ''}
                    onClick={() => setBottom('orders')}
                  >
                    <span>当前委托 · OPEN ORDERS</span>
                    <b>{own.length}</b>
                  </button>
                  <button
                    role="tab"
                    aria-selected={bottom === 'fills'}
                    className={bottom === 'fills' ? 'active' : ''}
                    onClick={() => setBottom('fills')}
                  >
                    <span>市场逐笔成交 · FILLS</span>
                    <b>{snapshot.fills.length}</b>
                  </button>
                  <button
                    role="tab"
                    aria-selected={bottom === 'receipts'}
                    className={bottom === 'receipts' ? 'active' : ''}
                    onClick={() => setBottom('receipts')}
                  >
                    <span>链上交易回执 · RECEIPTS</span>
                    <b>{txs.length}</b>
                    {txs.some(t => t.status === 'pending') && <i className="dot waiting" />}
                  </button>
                </div>

                {bottom === 'orders' && own.length > 0 && (
                  <button
                    className="outline-button compact-btn danger-outline cancel-all"
                    disabled={!canTrade}
                    onClick={() =>
                      action('批量撤单', async () => {
                        await write('批量撤单', 'batchCancel', [
                          own.slice(0, 16).map(o => o.id),
                        ]);
                      })
                    }
                  >
                    原子撤销{own.length > 16 ? '前 16 笔' : `全部 (${own.length})`}
                  </button>
                )}
              </div>

              <div
                className="table-scroll"
                role="tabpanel"
                aria-label={
                  bottom === 'orders'
                    ? '当前委托'
                    : bottom === 'fills'
                      ? '市场成交'
                      : '交易回执'
                }
              >
                {bottom === 'orders' ? (
                  <table>
                    <thead>
                      <tr>
                        <th>订单 ID</th>
                        <th>方向</th>
                        <th>委托限价 (dUSDC)</th>
                        <th>剩余数量 (dMON)</th>
                        <th>合约锁定资产</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {own.map(o => (
                        <tr key={String(o.id)}>
                          <td className="mono-id">#{String(o.id).padStart(4, '0')}</td>
                          <td>
                            <span className={`side-label ${o.isBuy ? 'buy' : 'sell'}`}>
                              {o.isBuy ? 'BUY · 买入' : 'SELL · 卖出'}
                            </span>
                          </td>
                          <td className={o.isBuy ? 'buy' : 'sell'}>
                            {fmt(Number(o.price) / 100)}
                          </td>
                          <td>{fmt(Number(o.lots) / 100)}</td>
                          <td>
                            {o.isBuy
                              ? `${fmt(Number(o.lots * o.price) / 10000)} dUSDC`
                              : `${fmt(Number(o.lots) / 100)} dMON`}
                          </td>
                          <td>
                            <button
                              className="table-action-btn"
                              disabled={!canTrade}
                              onClick={() =>
                                action('撤单', async () => {
                                  await write('撤单', 'cancel', [o.id]);
                                })
                              }
                            >
                              撤单
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : bottom === 'fills' ? (
                  <table>
                    <thead>
                      <tr>
                        <th>成交时间</th>
                        <th>主动方向 (TAKER)</th>
                        <th>成交价 (dUSDC)</th>
                        <th>成交量 (dMON)</th>
                        <th>成交额 (dUSDC)</th>
                        <th>链上交易哈希</th>
                      </tr>
                    </thead>
                    <tbody>
                      {snapshot.fills
                        .slice(-35)
                        .reverse()
                        .map(f => (
                          <tr key={`${f.hash}:${f.index}`}>
                            <td>{new Date(f.time * 1000).toLocaleTimeString('en-GB')}</td>
                            <td>
                              <span className={`side-label ${f.takerBuy ? 'buy' : 'sell'}`}>
                                {f.takerBuy ? 'TAKER BUY · 主动买' : 'TAKER SELL · 主动卖'}
                              </span>
                            </td>
                            <td className={f.takerBuy ? 'buy' : 'sell'}>
                              {fmt(Number(f.price) / 100)}
                            </td>
                            <td>{fmt(Number(f.lots) / 100)}</td>
                            <td>{fmt((Number(f.price) * Number(f.lots)) / 10000)}</td>
                            <td>
                              {txLink(f.hash) ? (
                                <a
                                  className="hash-link"
                                  href={txLink(f.hash)}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {short(f.hash)} <ExternalLink size={11} />
                                </a>
                              ) : (
                                <button
                                  className="hash-link"
                                  title={f.hash}
                                  onClick={() => copy(f.hash)}
                                >
                                  {short(f.hash)} <Copy size={11} />
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>执行指令</th>
                        <th>链上状态</th>
                        <th>Gas 消耗</th>
                        <th>交易哈希</th>
                      </tr>
                    </thead>
                    <tbody>
                      {txs.map(t => (
                        <tr key={t.hash}>
                          <td>{t.label}</td>
                          <td>
                            <span
                              className={`side-label ${
                                t.status === 'success'
                                  ? 'buy'
                                  : t.status === 'failed'
                                    ? 'sell'
                                    : 'waiting-tag'
                              }`}
                            >
                              {t.status === 'success'
                                ? 'CONFIRMED · 已确认'
                                : t.status === 'failed'
                                  ? 'FAILED · 失败'
                                  : 'PENDING · 待确认'}
                            </span>
                          </td>
                          <td>{t.gas ? fmt(Number(t.gas), 0) : '—'}</td>
                          <td>
                            {txLink(t.hash) ? (
                              <a
                                className="hash-link"
                                href={txLink(t.hash)}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {short(t.hash)} <ExternalLink size={11} />
                              </a>
                            ) : (
                              <button
                                className="hash-link"
                                title={t.hash}
                                onClick={() => copy(t.hash)}
                              >
                                {short(t.hash)} <Copy size={11} />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {((bottom === 'orders' && !own.length) ||
                  (bottom === 'fills' && !snapshot.fills.length) ||
                  (bottom === 'receipts' && !txs.length)) && (
                  <div className="table-empty">
                    <span className="empty-icon">
                      {bottom === 'receipts' ? (
                        <FileText size={18} />
                      ) : (
                        <Layers3 size={18} />
                      )}
                    </span>
                    <strong>
                      {bottom === 'orders'
                        ? account
                          ? '当前账户无活动挂单'
                          : '未连接交易钱包'
                        : bottom === 'fills'
                          ? '等待订单簿首笔撮合成交'
                          : '当前会话暂无链上交易回执'}
                    </strong>
                    <p>
                      {bottom === 'orders'
                        ? account
                          ? '可在右侧通过「意图网格」一键原子挂出多档双边限价单，或手动提交单笔限价委托。'
                          : '连接浏览器钱包或一键初始化测试钱包（自动领币并授权存入合约），即可提交网格与限价单。'
                        : bottom === 'fills'
                          ? '可点击上方「启动 Arena 交易流」触发链上规则对手盘，观察实时撮合。'
                          : '每笔挂单、撤单、充提操作均会在此记录链上交易哈希与 Gas 消耗。'}
                    </p>
                    {bottom === 'orders' && !account && (
                      <button
                        className="outline-button gold-outline"
                        onClick={() => setDialog('wallet')}
                      >
                        连接钱包或启用测试账户 <ArrowRight size={12} />
                      </button>
                    )}
                  </div>
                )}
              </div>
            </section>

            {/* Account Custody & FIFO PnL Bar */}
            <section
              className="account-strip"
              data-tour="account"
              aria-label="账户概览"
            >
              <div className="account-label">
                <div className="tv-h">
                  <strong>合约账户资产 · ACCOUNT</strong>
                </div>
                <span>链上托管 · 随时提取</span>
              </div>

              <div className="account-cell">
                <small>可用报价资产 (FREE dUSDC)</small>
                <strong>{account ? fmt(amount(snapshot.quoteFree)) : '—'}</strong>
                <span>挂单锁定 {account ? fmt(amount(quoteLocked)) : '—'} dUSDC</span>
              </div>

              <div className="account-cell">
                <small>可用基础资产 (FREE dMON)</small>
                <strong>{account ? fmt(amount(snapshot.baseFree, 18)) : '—'}</strong>
                <span>挂单锁定 {account ? fmt(amount(baseLocked, 18)) : '—'} dMON</span>
              </div>

              <div className="account-cell">
                <small>{snapshot.partialHistory ? '近期配对收益 (FIFO)' : '已配对实现收益 (FIFO PnL)'}</small>
                <strong className={pnl.pnl >= 0n ? 'buy' : 'sell'}>
                  {account
                    ? `${pnl.pnl > 0n ? '+' : ''}${fmt(amount(pnl.pnl), 4)} dUSDC`
                    : '—'}
                </strong>
                <span title="按 FIFO 配对买卖成交；未扣 Gas，不计外部转入资产成本。">
                  已平仓 {fmt(Number(pnl.closedLots) / 100)} dMON · 未计 Gas
                </span>
              </div>

              <div className="account-actions">
                <button
                  className="outline-button gold-outline"
                  onClick={() => (account ? openFunding() : setDialog('wallet'))}
                >
                  <ArrowLeftRight size={13} />
                  <span>{account ? '资金划转 / 水龙头' : '连接钱包管理资产'}</span>
                </button>
              </div>
            </section>
          </div>

          {/* Right Column: Order & Intent Grid Execution Workbench */}
          <aside
            className="panel execution-panel"
            id="execution"
            data-tour="execution"
            aria-label="交易与策略编辑"
          >
            <div className="execution-tabs" role="tablist" aria-label="交易方式">
              <button
                role="tab"
                aria-selected={tab === 'grid'}
                className={tab === 'grid' ? 'active' : ''}
                onClick={() => setTab('grid')}
              >
                <SlidersHorizontal size={14} />
                <span>意图网格 · GRID</span>
              </button>
              <button
                role="tab"
                aria-selected={tab === 'trade'}
                className={tab === 'trade' ? 'active' : ''}
                onClick={() => setTab('trade')}
              >
                <ArrowLeftRight size={14} />
                <span>手动委托 · ORDER</span>
              </button>
            </div>

            {tab === 'trade' ? (
              <div className="execution-body" role="tabpanel" aria-label="手动交易">
                <div className="trade-heading">
                  <div className="tv-h">
                    <h2>单笔链上委托 · DIRECT ORDER</h2>
                  </div>
                  <span className="small-tag">CLOB SPOT</span>
                </div>

                <div className="segmented">
                  <button
                    aria-pressed={side}
                    className={side ? 'buy active' : ''}
                    onClick={() => setSide(true)}
                  >
                    买入 dMON · BUY
                  </button>
                  <button
                    aria-pressed={!side}
                    className={!side ? 'sell active' : ''}
                    onClick={() => setSide(false)}
                  >
                    卖出 dMON · SELL
                  </button>
                </div>

                <div className="order-types">
                  <button
                    className={kind === 'limit' ? 'active' : ''}
                    aria-pressed={kind === 'limit'}
                    onClick={() => setKind('limit')}
                  >
                    限价挂单 · LIMIT
                  </button>
                  <button
                    className={kind === 'ioc' ? 'active' : ''}
                    aria-pressed={kind === 'ioc'}
                    onClick={() => setKind('ioc')}
                  >
                    保护价吃单 · IOC
                  </button>
                </div>

                <div className="field">
                  <div className="field-label-row">
                    <span>
                      {kind === 'limit'
                        ? '委托限价 (LIMIT PRICE)'
                        : side
                          ? '最高保护买价 (MAX BUY)'
                          : '最低保护卖价 (MIN SELL)'}
                    </span>
                    <div className="quick-price-chips">
                      {bids[0] && (
                        <button
                          type="button"
                          onClick={() =>
                            setPrice((Number(bids[0].price) / 100).toFixed(2))
                          }
                        >
                          买一
                        </button>
                      )}
                      {mid > 0n && (
                        <button
                          type="button"
                          onClick={() => setPrice((Number(mid) / 100).toFixed(2))}
                        >
                          中间价
                        </button>
                      )}
                      {asks[0] && (
                        <button
                          type="button"
                          onClick={() =>
                            setPrice((Number(asks[0].price) / 100).toFixed(2))
                          }
                        >
                          卖一
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="input-box">
                    <input
                      aria-label="委托价格"
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={price}
                      onChange={e => setPrice(e.target.value)}
                    />
                    <span>dUSDC</span>
                  </div>
                </div>

                <label className="field">
                  <span className="field-label-row">委托数量 (QUANTITY)</span>
                  <div className="input-box">
                    <input
                      aria-label="下单数量"
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={quantity}
                      onChange={e => setQuantity(e.target.value)}
                    />
                    <span>dMON</span>
                  </div>
                </label>

                {kind === 'limit' ? (
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={postOnly}
                      onChange={e => setPostOnly(e.target.checked)}
                    />
                    <span>只做挂单方 (Post-only · 立即吃单则回滚)</span>
                    <em>MAKER ONLY</em>
                  </label>
                ) : (
                  <label className="field">
                    <span className="field-label-row">最低成交量保护 (MIN FILL)</span>
                    <div className="input-box">
                      <input
                        aria-label="最低成交数量"
                        type="number"
                        min="0"
                        step="0.01"
                        value={minFill}
                        onChange={e => setMinFill(e.target.value)}
                      />
                      <span>dMON</span>
                    </div>
                  </label>
                )}

                <div className="order-summary">
                  <div className="summary-row">
                    <span>{side ? '预估最大占用' : '委托锁定数量'}</span>
                    <strong>
                      {side
                        ? `${fmt(Number(price) * Number(quantity))} dUSDC`
                        : `${fmt(Number(quantity))} dMON`}
                    </strong>
                  </div>
                  <div className="summary-row">
                    <span>合约可用余额</span>
                    <strong>
                      {account
                        ? `${fmt(
                            amount(
                              side ? snapshot.quoteFree : snapshot.baseFree,
                              side ? 6 : 18
                            )
                          )} ${side ? 'dUSDC' : 'dMON'}`
                        : '未连接钱包'}
                    </strong>
                  </div>
                  <div className="summary-row">
                    <span>撮合规则</span>
                    <strong>价格优先 · 同价 FIFO</strong>
                  </div>
                </div>

                <button
                  className={`primary-button ${side ? 'buy-button' : 'sell-button'}`}
                  disabled={account ? !canTrade : !market || !!busy}
                  onClick={() => (account ? order() : setDialog('wallet'))}
                >
                  {busy ? (
                    <LoaderCircle className="spin" size={15} />
                  ) : (
                    <ArrowRight size={15} />
                  )}
                  <span>
                    {busy ||
                      (account
                        ? `${side ? '提交买入委托' : '提交卖出委托'} · dMON`
                        : '连接钱包以执行交易')}
                  </span>
                </button>

                <p className="explanation">
                  {kind === 'limit'
                    ? '限价单按价格与时间优先撮合；买方以更优 Maker 价成交时，差价自动退回合约可用余额。'
                    : 'IOC 订单仅在保护价内立即吃单，未成交余量即刻释放；若实际成交低于最低成交量，整笔交易原子回滚。'}
                </p>
              </div>
            ) : (
              <div className="execution-body grid-body" role="tabpanel" aria-label="意图网格">
                <div className="strategy-heading">
                  <div className="tv-h">
                    <h2>意图转确定性网格 · INTENT ENGINE</h2>
                  </div>
                  <p>自然语言或结构化参数 → 确定性多档拆单 → 单笔交易原子上链</p>
                </div>

                <div className="strategy-steps" aria-label="策略流程">
                  <span className="done">
                    <b>01</b>策略设定
                  </span>
                  <i />
                  <span className={preview ? 'done' : ''}>
                    <b>02</b>档位核验
                  </span>
                  <i />
                  <span>
                    <b>03</b>原子签名
                  </span>
                </div>

                {!preview && (
                  <>
                    <label className="intent-label" htmlFor="intent">
                      <span>策略意图描述 (NATURAL LANGUAGE INTENT)</span>
                      <em>支持双向预算与区间</em>
                    </label>
                    <textarea
                      id="intent"
                      aria-label="交易策略意图"
                      value={intentText}
                      onChange={e => {
                        setIntentText(e.target.value);
                        setPreview(undefined);
                      }}
                      rows={3}
                    />

                    <div className="parse-actions">
                      <button
                        className="outline-button gold-outline"
                        disabled={!mid || intentBusy}
                        onClick={() => generate(false)}
                      >
                        {intentBusy ? (
                          <LoaderCircle size={13} className="spin" />
                        ) : (
                          <Layers3 size={13} />
                        )}
                        <span>规则解析</span>
                      </button>
                      <button
                        className="ai-button"
                        disabled={!mid || intentBusy}
                        onClick={() => generate(true)}
                      >
                        <Sparkles size={13} />
                        <span>AI 解析</span>
                      </button>
                    </div>

                    <div className="form-section-label">
                      <span>网格量化参数 (GRID PARAMETERS)</span>
                      <span>步长对齐 0.01</span>
                    </div>

                    <div className="parameter-grid">
                      <label className="field">
                        <span>网格层数 (2-16)</span>
                        <div className="input-box">
                          <input
                            aria-label="网格层数"
                            type="number"
                            min="2"
                            max="16"
                            value={intent.levels}
                            onChange={e =>
                              editIntent('levels', Number(e.target.value))
                            }
                          />
                          <span>层</span>
                        </div>
                      </label>
                      <label className="field">
                        <span>单侧区间 (1-30%)</span>
                        <div className="input-box">
                          <input
                            aria-label="单侧区间"
                            type="number"
                            min="1"
                            max="30"
                            step="0.5"
                            value={intent.rangeBps / 100}
                            onChange={e =>
                              editIntent('rangeBps', Number(e.target.value) * 100)
                            }
                          />
                          <span>%</span>
                        </div>
                      </label>
                      <label className="field">
                        <span>买盘总预算</span>
                        <div className="input-box">
                          <input
                            aria-label="买入预算"
                            type="number"
                            min="0"
                            value={intent.budgetQuote}
                            onChange={e =>
                              editIntent('budgetQuote', Number(e.target.value))
                            }
                          />
                          <span>dUSDC</span>
                        </div>
                      </label>
                      <label className="field">
                        <span>卖盘总库存</span>
                        <div className="input-box">
                          <input
                            aria-label="卖出库存"
                            type="number"
                            min="0"
                            value={intent.baseInventory}
                            onChange={e =>
                              editIntent('baseInventory', Number(e.target.value))
                            }
                          />
                          <span>dMON</span>
                        </div>
                      </label>
                    </div>

                    <label className="bias-field">
                      <span>库存方向偏置 (BIAS)</span>
                      <select
                        aria-label="方向偏好"
                        value={intent.bias}
                        onChange={e => editIntent('bias', e.target.value)}
                      >
                        <option value="bullish">偏多 · 加密买盘层数</option>
                        <option value="neutral">中性 · 买卖对称分布</option>
                        <option value="bearish">偏空 · 加密卖盘层数</option>
                      </select>
                    </label>

                    <button
                      className="primary-button preview-button"
                      disabled={!mid || intentBusy}
                      onClick={() => {
                        try {
                          setPreview(allocateGrid(intent, mid));
                          setIntentSource('手动参数 · 确定性分配');
                          setNotice('');
                        } catch (e) {
                          setNotice(errorMessage(e));
                        }
                      }}
                    >
                      <span>生成网格挂单预览</span>
                      <ArrowRight size={14} />
                    </button>
                  </>
                )}

                {preview && (
                  <div className="grid-preview">
                    <div className="preview-heading">
                      <div className="preview-title-row">
                        <span className="preview-badge">
                          <Check size={13} />
                          已生成 {preview.orders.length} 档挂单
                        </span>
                        <button
                          className="text-button"
                          onClick={() => setPreview(undefined)}
                        >
                          修改参数
                        </button>
                      </div>
                      <small>{intentSource} · 基准中间价 {fmt(Number(mid) / 100)} dUSDC</small>
                    </div>

                    <div className="grid-bars">
                      <div className="grid-bars-head">
                        <span>档位 / 限价 (dUSDC)</span>
                        <span>委托量 (dMON)</span>
                      </div>
                      {preview.orders.map((o, i) => {
                        const maxLot = Math.max(
                          ...preview.orders.map(item => Number(item.lots)),
                          1
                        );
                        return (
                          <div key={i} className={`grid-level-row ${o.isBuy ? 'buy' : 'sell'}`}>
                            <span className="level-price">
                              <em>{o.isBuy ? 'BUY' : 'SELL'}</em>
                              <b>{fmt(Number(o.price) / 100)}</b>
                            </span>
                            <span className="grid-meter">
                              <i
                                style={{
                                  width: `${Math.max(
                                    6,
                                    (Number(o.lots) / maxLot) * 100
                                  )}%`,
                                }}
                              />
                            </span>
                            <span className="level-lots">
                              {fmt(Number(o.lots) / 100)}
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    <div className="order-summary">
                      <div className="summary-row">
                        <span>需锁定 dUSDC / dMON</span>
                        <strong>
                          {fmt(amount(preview.quoteRequired))} /{' '}
                          {fmt(amount(preview.baseRequired, 18))}
                        </strong>
                      </div>
                      <div className="summary-row">
                        <span>当前合约可用</span>
                        <strong>
                          {account
                            ? `${fmt(amount(snapshot.quoteFree))} / ${fmt(
                                amount(snapshot.baseFree, 18)
                              )}`
                            : '请先连接钱包'}
                        </strong>
                      </div>
                    </div>

                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={replace}
                        onChange={e => setReplace(e.target.checked)}
                      />
                      <span>原子替换当前全部挂单 (replaceOrders)</span>
                      <em>MAX 16</em>
                    </label>

                    <button
                      className="primary-button"
                      disabled={account ? !canTrade : !market || !!busy}
                      onClick={() => (account ? deployGrid() : setDialog('wallet'))}
                    >
                      {busy ? (
                        <LoaderCircle size={15} className="spin" />
                      ) : (
                        <Layers3 size={15} />
                      )}
                      <span>
                        {busy ||
                          (account
                            ? `签名并${replace ? '替换' : '批量挂出'} ${
                                preview.orders.length
                              } 笔订单`
                            : '连接钱包以执行网格')}
                      </span>
                    </button>

                    <p className="explanation">
                      全部档位均为 Post-only 限价单，通过单笔链上交易原子写入；任一档位跨过对手盘将整批回滚。
                    </p>
                  </div>
                )}

                {!preview && (
                  <p className="explanation">
                    确定性网格引擎严格校验价格步长（0.01 dUSDC）、手数精度与预算上界，预览确认后再调用钱包签名。
                  </p>
                )}
              </div>
            )}

            {!account && (
              <div className="connect-card">
                <div>
                  <strong>一键初始化演示交易账户</strong>
                  <p>浏览器本地生成会话密钥，自动领取测试 Gas 与 5,000 dMON / dUSDC 存入合约。</p>
                </div>
                <button
                  className="outline-button gold-outline"
                  disabled={!market || !!busy}
                  onClick={() => setDialog('wallet')}
                >
                  <span>立即连接</span>
                  <ArrowRight size={12} />
                </button>
              </div>
            )}

            <div className="execution-footer">
              <ShieldCheck size={13} />
              <span>SELF-CUSTODY · ATOMIC SETTLEMENT · NO ADMIN KEY</span>
            </div>
          </aside>
        </main>

        <footer className="page-footer">
          <span>
            <i className="dot" />
            CLOB / GRID INSTITUTIONAL TERMINAL
            <span className="separator">|</span>
            全链价格时间优先撮合 (FIFO) · 演示环境测试资产无真实价值
          </span>
          <span>
            LOT STEP 0.01 dMON
            <span className="separator">/</span>
            TICK SIZE 0.01 dUSDC
            <span className="separator">/</span>
            CONTRACT {market ? short(market.d.book) : '—'}
          </span>
          <button onClick={() => setDialog('about')}>
            合约地址与审计边界 <ExternalLink size={11} />
          </button>
        </footer>
      </div>

      {(notice || busy) && (
        <div className={`toast ${busy ? 'working' : ''}`} role="status">
          {busy ? (
            <LoaderCircle size={15} className="spin" />
          ) : (
            <Activity size={15} />
          )}
          <span>{busy ? `${busy}中，等待签名与区块确认…` : notice}</span>
          {!busy && (
            <button
              className="icon-button"
              aria-label="关闭提示"
              onClick={() => setNotice('')}
            >
              <X size={14} />
            </button>
          )}
        </div>
      )}

      {dialog === 'wallet' && (
        <Dialog
          title={account ? '交易钱包与会话管理' : '连接交易钱包'}
          busy={!!busy}
          onClose={() => setDialog(undefined)}
        >
          <div className="dialog-body">
            <div className="wallet-intro">
              <span className="wallet-illustration">
                <Wallet size={24} />
              </span>
              <p>
                {account
                  ? '当前钱包直接控制合约内可用余额与活动挂单，无中心化托管权限。'
                  : '支持连接浏览器注入钱包（MetaMask / Rabby 等），或一键创建已注资的本地演示账户。'}
              </p>
            </div>
            {account ? (
              <>
                <div className="address-card">
                  <span>{account}</span>
                  <button
                    className="icon-button"
                    aria-label="复制钱包地址"
                    onClick={() => copy(account)}
                  >
                    <Copy size={15} />
                  </button>
                </div>
                <button
                  className="primary-button"
                  onClick={() => {
                    setDialog(undefined);
                    openFunding();
                  }}
                >
                  <span>合约资金划转 / 水龙头</span>
                  <ArrowRight size={14} />
                </button>
                <button
                  className="disconnect-button"
                  disabled={!!busy}
                  onClick={() => {
                    setAccount(undefined);
                    setWallet(undefined);
                    arenaStop.current = true;
                    setDialog(undefined);
                  }}
                >
                  <LogOut size={14} />
                  <span>断开当前钱包</span>
                </button>
              </>
            ) : (
              <>
                {hasTestWallet && (
                  <button
                    className="wallet-option demo-option"
                    disabled={!!busy}
                    onClick={() => {
                      setDialog(undefined);
                      void connect(true);
                    }}
                  >
                    <span className="option-icon">
                      <Layers3 size={19} />
                    </span>
                    <span>
                      <strong>
                        创建演示交易钱包 <b>推荐极速体验</b>
                      </strong>
                      <small>自动分发测试 Gas 并存入 5,000 dMON 与 5,000 dUSDC，免插件直接下单</small>
                    </span>
                    <ChevronRight size={16} />
                  </button>
                )}
                <button
                  className="wallet-option"
                  disabled={!market || !!busy}
                  onClick={() => {
                    setDialog(undefined);
                    void connect();
                  }}
                >
                  <span className="option-icon">
                    <Wallet size={19} />
                  </span>
                  <span>
                    <strong>连接浏览器钱包 (Injected EVM)</strong>
                    <small>使用已安装的浏览器扩展钱包连接并签名链上交易</small>
                  </span>
                  <ChevronRight size={16} />
                </button>
                <p className="dialog-note">
                  <ShieldCheck size={14} />
                  <span>
                    当前连接演示测试网络，dMON 与 dUSDC 均为无真实价值的测试代币。会话私钥仅保存在当前浏览器内存中。
                  </span>
                </p>
              </>
            )}
          </div>
        </Dialog>
      )}

      {dialog === 'about' && (
        <Dialog title="合约架构与机制说明" onClose={() => setDialog(undefined)}>
          <div className="dialog-body">
            <div className="about-brand">
              <span className="brand-badge">R</span>
              <strong>CLOB / GRID</strong>
              <span>ON-CHAIN ENGINE</span>
            </div>
            <p className="about-intro">
              全链中央限价订单簿（CLOB）与确定性意图网格终端。所有挂单、撮合、价格改善退款及资金结算均在 EVM 合约内原子完成。
            </p>
            <dl className="network-details">
              <div>
                <dt>当前网络</dt>
                <dd>{networkLabel}</dd>
              </div>
              <div>
                <dt>Chain ID</dt>
                <dd>{market?.d.chainId || '—'}</dd>
              </div>
              <div>
                <dt>撮合优先级</dt>
                <dd>价格优先 · 同价时间优先 (FIFO)</dd>
              </div>
              <div>
                <dt>单簿容量边界</dt>
                <dd>最多 128 笔挂单 · 批量原子上限 16 笔</dd>
              </div>
              <div>
                <dt>行情数据源</dt>
                <dd>
                  {snapshot.partialHistory
                    ? '近期区块事件窗口（历史截断）'
                    : '合约部署以来完整链上 Trade 事件'}
                </dd>
              </div>
            </dl>
            {market && (
              <div className="contract-address">
                <label>OrderBook 合约地址</label>
                <button onClick={() => copy(market.d.book)}>
                  <span>{market.d.book}</span>
                  <Copy size={13} />
                </button>
              </div>
            )}
            <div className="about-notes">
              <p>
                <strong>确定性网格拆单</strong>
                规则解析与 AI 解析仅在客户端生成待核验参数，无法代签交易。提交时通过 batchPlaceOrders 或 replaceOrders 原子上链。
              </p>
              <p>
                <strong>收益核算口径</strong>
                已实现收益按账户成交事件 FIFO 配对计算，未扣除 Gas 成本，亦不包含外部直接转入代币的历史成本。
              </p>
            </div>
          </div>
        </Dialog>
      )}

      {funding && (
        <Dialog
          title="合约资金管理 (托管与水龙头)"
          busy={!!busy}
          status={notice}
          onClose={() => setFunding(false)}
        >
          <div className="dialog-body">
            <p className="dialog-subtitle">
              在个人钱包与 OrderBook 结算合约之间存入或提取可用资产。
            </p>
            <div className="segmented asset-tabs">
              <button
                className={!fundBase ? 'active buy' : ''}
                aria-pressed={!fundBase}
                onClick={() => setFundBase(false)}
              >
                报价资产 · dUSDC
              </button>
              <button
                className={fundBase ? 'active buy' : ''}
                aria-pressed={fundBase}
                onClick={() => setFundBase(true)}
              >
                基础资产 · dMON
              </button>
            </div>
            <div className="funding-balances">
              <div>
                <small>钱包余额 (WALLET)</small>
                <strong>
                  {fmt(
                    amount(
                      fundBase ? snapshot.baseWallet : snapshot.quoteWallet,
                      fundBase ? 18 : 6
                    )
                  )}
                </strong>
              </div>
              <div>
                <small>合约可用余额 (CONTRACT FREE)</small>
                <strong>
                  {fmt(
                    amount(
                      fundBase ? snapshot.baseFree : snapshot.quoteFree,
                      fundBase ? 18 : 6
                    )
                  )}
                </strong>
              </div>
            </div>
            <label className="field">
              <span className="field-label-row">划转金额 (AMOUNT)</span>
              <div className="input-box">
                <input
                  aria-label="充值提取金额"
                  type="number"
                  min="0"
                  value={fundAmount}
                  onChange={e => setFundAmount(e.target.value)}
                />
                <span>{fundBase ? 'dMON' : 'dUSDC'}</span>
              </div>
            </label>
            <div className="funding-actions">
              <button
                className="primary-button"
                disabled={!canTrade}
                onClick={() => funds('deposit')}
              >
                <ArrowDownLeft size={14} />
                <span>存入合约 (Deposit)</span>
              </button>
              <button
                className="outline-button"
                disabled={!canTrade}
                onClick={() => funds('withdraw')}
              >
                <ArrowUpRight size={14} />
                <span>提取回钱包 (Withdraw)</span>
              </button>
            </div>
            <button
              className="outline-button gold-outline faucet"
              disabled={!canTrade}
              onClick={() => funds('faucet')}
            >
              <span>测试网水龙头：免费铸造 10,000 {fundBase ? 'dMON' : 'dUSDC'}</span>
              <ArrowRight size={12} />
            </button>
            <p className="dialog-note">
              <ShieldCheck size={14} />
              <span>
                存入合约将按需执行 ERC-20 approve 授权。挂单锁定中的资产需先撤单释放后方可提取。
              </span>
            </p>
          </div>
        </Dialog>
      )}
    </div>
  );
}
