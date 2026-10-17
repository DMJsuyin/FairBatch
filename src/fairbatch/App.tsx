import {useCallback, useEffect, useRef, useState} from 'react';
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCheck,
  Download,
  FileKey2,
  Layers,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Timer,
  Upload,
  Wallet,
  Zap,
} from 'lucide-react';
import {toHex, type Address, type Hex} from 'viem';
import {
  createBatch,
  empty,
  err,
  fmt,
  short,
  saveSecret,
  getSecret,
  commitment,
  type Batch,
  type Order,
  type Secret,
  type Snapshot,
} from './client';
import './style.css';
import {paddedEscrow, referenceClear, clearingInputs, witness} from './protocol';
import DemoTour from '../DemoTour';
import {Logo} from '../Logo';
import {AutoDemoHeaderButton} from '../AutoDemoDirector';
import {fairBatchTour, type TourStep} from '../tourSteps';
import {depthCurve} from './depth';
import {nextAction, orderOutcome} from './experience';

const phases = [
  '等待开场',
  '密封挂单',
  '揭示订单',
  '等待清算',
  '本轮已结算',
  '本轮已到期',
];
const phaseHelp = [
  '开启集合竞价轮次，买卖双方在同一时间窗口内提交哈希承诺报价。',
  '限价在封盘前保持密码学密封，上链先后顺序不影响同批订单的清算价格。',
  '密封窗口已结束。揭示真实限价后，全部有效报价纳入统一供需交集计算。',
  '揭示期结束，任何人均可在链上提交排序见证并触发确定性统一清算。',
  '全部成交订单按唯一清算价 P* 结算，价差改善与未成交余款原路返还。',
  '清算窗口已超期，所有参与者可直接取回本轮锁定本金。',
];

const sample = [
  {id: 'A', buy: true, price: 110},
  {id: 'B', buy: false, price: 90},
  {id: 'C', buy: true, price: 100},
];
const permutations = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
];

function continuous(seq: number[]) {
  const book: typeof sample = [];
  let price = 0;
  let buyer = '';
  for (const i of seq) {
    const o = sample[i];
    const at =
      book
        .map((x, idx) => ({x, i: idx}))
        .filter(
          ({x}) =>
            x.buy !== o.buy && (o.buy ? o.price >= x.price : o.price <= x.price)
        )
        .sort((a, b) => (o.buy ? a.x.price - b.x.price : b.x.price - a.x.price))[0]
        ?.i ?? -1;
    if (at >= 0) {
      const maker = book.splice(at, 1)[0];
      price = maker.price;
      buyer = o.buy ? o.id : maker.id;
    } else book.push(o);
  }
  return {price, buyer};
}

function Curve({s}: {s: Snapshot}) {
  const rows = s.orders.filter(o => o.revealed);
  if (!rows.length)
    return (
      <div className="fb-sealed">
        <div className="fb-orbit">
          <LockKeyhole size={20} />
        </div>
        <h3>SEALED COMMITMENT WINDOW · 报价哈希密封中</h3>
        <p>封盘前合约仅记录 Keccak-256 承诺哈希，不公开限价，从机制底层阻断报价泄露与跟单抢跑。</p>
        <div className="fb-sealed-marks">
          <span>
            <ShieldCheck size={12} /> 哈希承诺防抢跑
          </span>
          <span>
            <Layers size={12} /> 同批同价统一清算
          </span>
          <span>
            <CheckCheck size={12} /> 链上 O(n) 见证核验
          </span>
        </div>
      </div>
    );
  const {lo, hi, max, points: depth} = depthCurve(rows);
  const x = (p: number) => 52 + ((p - lo) / (hi - lo)) * 630;
  const y = (q: number) => 176 - (q / max) * 144;
  const points = (buy: boolean) =>
    depth.map(p => `${x(p.price)},${y(buy ? p.buy : p.sell)}`).join(' ');
  return (
    <div className="fb-curve">
      <svg viewBox="0 0 720 212" preserveAspectRatio="none" role="img" aria-label="揭示订单的累计供需曲线">
        {[0, 1, 2, 3, 4].map(i => (
          <g key={i}>
            <line
              x1="52"
              x2="682"
              y1={32 + i * 36}
              y2={32 + i * 36}
              stroke="#19202b"
              strokeDasharray="3 4"
            />
            <text x="44" y={36 + i * 36} textAnchor="end">
              {fmt((max * (4 - i)) / 400, 0)}
            </text>
          </g>
        ))}
        <polyline
          points={points(true)}
          fill="none"
          stroke="#2ebd85"
          strokeWidth="2.2"
        />
        <polyline
          points={points(false)}
          fill="none"
          stroke="#e05260"
          strokeWidth="2.2"
        />
        {s.price > 0n && (
          <g>
            <line
              x1={x(Number(s.price))}
              x2={x(Number(s.price))}
              y1="20"
              y2="178"
              stroke="#c9a254"
              strokeWidth="1.5"
              strokeDasharray="4 4"
            />
            <text
              x={x(Number(s.price))}
              y="14"
              textAnchor="middle"
              fill="#c9a254"
            >
              P* {fmt(Number(s.price) / 100)}
            </text>
          </g>
        )}
        {[lo, (lo + hi) / 2, hi].map(p => (
          <text key={p} x={x(p)} y="196" textAnchor="middle">
            {fmt(p / 100)}
          </text>
        ))}
        <text x="52" y="14">
          累计深度 (dMON)
        </text>
        <text x="682" y="208" textAnchor="end">
          报价限价 (dUSDC)
        </text>
      </svg>
      <div className="fb-legend">
        <span className="green">● 累计买盘需求曲线 (DEMAND)</span>
        <span className="rose">● 累计卖盘供给曲线 (SUPPLY)</span>
        <span className="gold">
          ◆ {s.phase === 2 ? '揭示期实时更新中' : '全部有效揭示订单'}
        </span>
      </div>
    </div>
  );
}

type FairBatchProps = {
  onSwitchEngine?: (mode: 'clob' | 'fairbatch', startTour?: boolean) => void;
};

export default function App({onSwitchEngine}: FairBatchProps = {}) {
  const [batch, setBatch] = useState<Batch>();
  const [s, setS] = useState<Snapshot>(empty);
  const [wallet, setWallet] = useState<any>();
  const [prepared, setPrepared] = useState(false);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<bigint>();
  const [buy, setBuy] = useState(true);
  const [qty, setQty] = useState('5');
  const [price, setPrice] = useState('1.03');
  const [padding, setPadding] = useState(false);
  const [auto, setAuto] = useState(true);
  const [direct, setDirect] = useState(false);
  const [compare, setCompare] = useState(0);
  const [dockTab, setDockTab] = useState<'orders' | 'compare' | 'witness' | 'algorithm'>('orders');
  const [receipt, setReceipt] = useState<Hex>();
  const [now, setNow] = useState(Date.now());
  const [credential, setCredential] = useState<Secret | null>(null);
  const [watchedOwner, setWatchedOwner] = useState<Address>();

  const syncAt = useRef(Date.now());
  const actionLock = useRef(false);
  const syncLock = useRef(false);
  const autoAt = useRef(0);
  const upload = useRef<HTMLInputElement>(null);

  const account = wallet?.account.address as Address | undefined;
  const owner = watchedOwner || account;
  const own = s.orders.find(
    o => o.owner.toLowerCase() === owner?.toLowerCase()
  );

  useEffect(() => {
    document.title = 'FairBatch';
    let live = true;
    fetch('/fairbatch.json', {cache: 'no-store'})
      .then(async r => {
        if (!r.ok) throw Error('FairBatch 合约正在部署，请稍后重试');
        return r.json();
      })
      .then(d => {
        if (live) {
          const b = createBatch(d);
          setBatch(b);
          if (sessionStorage.getItem(`fairbatch:wallet:${d.chainId}`)) {
            const w = b.localWallet();
            setWallet(w);
            void b.checkPrepared(w).then(ok => {
              if (live && ok) setPrepared(true);
            });
          }
        }
      })
      .catch(e => setError(err(e)));
    return () => {
      live = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!batch || syncLock.current) return;
    syncLock.current = true;
    try {
      setS(await batch.snapshot(selected));
      syncAt.current = Date.now();
      setError('');
    } catch (e) {
      setError(err(e));
    } finally {
      syncLock.current = false;
    }
  }, [batch, selected]);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        void refresh();
      }
    }, 3000);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    setCredential(batch && owner ? getSecret(batch.d, s.id, owner) : null);
  }, [batch, owner, s.id, own?.commitment]);

  useEffect(() => {
    const p = (window as any).ethereum;
    if (!p?.on) return;
    const reset = () => {
      setWallet(undefined);
      setPrepared(false);
    };
    p.on('accountsChanged', reset);
    p.on('chainChanged', reset);
    return () => {
      p.removeListener?.('accountsChanged', reset);
      p.removeListener?.('chainChanged', reset);
    };
  }, []);

  const action = useCallback(
    async (label: string, fn: () => Promise<any>) => {
      if (actionLock.current) return;
      actionLock.current = true;
      setBusy(label);
      setNotice('');
      try {
        const hash = await fn();
        if (typeof hash === 'string' && hash.startsWith('0x'))
          setReceipt(hash as Hex);
        await refresh();
      } catch (e) {
        setNotice(err(e));
      } finally {
        actionLock.current = false;
        setBusy('');
      }
    },
    [refresh]
  );

  async function relayOrWrite(op: string, body: any, fn: string, args: any[]) {
    if (!batch) throw Error('连接中');
    if (batch.d.relayer && !direct) {
      try {
        return await batch.api(op, body);
      } catch (e) {
        if (!wallet || (e as any).serverRejected) throw e;
      }
    }
    if (!wallet) throw Error('请先连接钱包');
    if (op === 'settle') return batch.settle(wallet, BigInt(body.round));
    return batch.write(wallet, fn, args);
  }

  async function reveal() {
    if (!credential || !batch) throw Error('需要导入该订单的揭示凭据');
    if (commitment(credential) !== own?.commitment)
      throw Error('凭据与链上承诺不一致');
    return relayOrWrite('reveal', {...credential}, 'revealFor', [
      s.id,
      credential.owner,
      BigInt(credential.lots),
      BigInt(credential.ticks),
      credential.salt,
    ]);
  }

  useEffect(() => {
    if (
      auto &&
      s.phase === 2 &&
      own &&
      !own.revealed &&
      credential &&
      !busy &&
      Date.now() - autoAt.current > 8000
    ) {
      autoAt.current = Date.now();
      void action('自动揭示订单', reveal);
    }
  }, [auto, s.phase, own?.revealed, credential, busy, now]);

  async function connect(local: boolean) {
    await action('准备交易钱包', async () => {
      if (!batch) return;
      const w = local ? batch.localWallet() : await batch.connect();
      setWallet(w);
      setPrepared(false);
      setWatchedOwner(undefined);
      await batch.fund(w);
      setPrepared(true);
      setNotice('钱包已就绪并完成测试资产授权，可提交密封承诺订单');
    });
  }

  async function place() {
    await action('密封订单上链', async () => {
      if (!batch || !account || !wallet) return;
      const lots = Math.round(Number(qty) * 100);
      const ticks = Math.round(Number(price) * 100);
      if (
        !Number.isFinite(lots) ||
        !Number.isFinite(ticks) ||
        lots < 1 ||
        ticks < 1 ||
        lots > 1e9 ||
        ticks > 1e9 ||
        Math.abs(lots - Number(qty) * 100) > 1e-6 ||
        Math.abs(ticks - Number(price) * 100) > 1e-6
      )
        throw Error('数量与价格需为正数，最多两位小数');
      if (!prepared) throw Error('请先完成钱包与资产准备');
      const c: Secret = {
        chainId: batch.d.chainId,
        contract: batch.d.contract,
        round: String(s.id),
        owner: account,
        isBuy: buy,
        lots: String(lots),
        ticks: String(ticks),
        salt: toHex(crypto.getRandomValues(new Uint8Array(32))),
      };
      saveSecret(c);
      setCredential(c);
      const required = BigInt(lots) * (buy ? BigInt(ticks) * 100n : 10n ** 16n);
      const escrow = padding ? paddedEscrow(required, buy ? 1000000n : 10n ** 18n) : required;
      const hash = direct
        ? await batch.write(wallet, 'commit', [s.id, buy, commitment(c), escrow])
        : await batch.commitOrder(wallet, c, escrow);
      saveSecret({...c, hash});
      setNotice('密封承诺提交成功。保持页面打开，将在揭示期自动提交报价明文。');
      return hash;
    });
  }

  async function challengeSolver() {
    await action('验证漏单见证', async () => {
      if (!batch) return;
      const rows = clearingInputs(s.orders);
      let [buys, sells] = witness(rows);
      if (buys.length > 2) buys = buys.slice(0, -2) as Hex;
      else if (sells.length > 2) sells = sells.slice(0, -2) as Hex;
      else throw Error('至少需要一笔已揭示订单');
      try {
        await batch.read('computeWithWitness', [rows, buys, sells]);
      } catch (e) {
        if (String((e as any).message).includes('incomplete witness')) {
          setNotice(
            '链上校验已拒绝漏单见证：incomplete witness。未发送交易，不消耗 Gas。'
          );
          return;
        }
        throw e;
      }
      throw Error('校验异常：漏单见证未被拒绝');
    });
  }

  function download() {
    if (!credential) return;
    const a = document.createElement('a');
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(credential, null, 2)], {type: 'application/json'})
    );
    a.href = url;
    a.download = `FairBatch-round-${s.id}-credential.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importCredential(file?: File) {
    if (!file || !batch) return;
    try {
      const c = JSON.parse(await file.text()) as Secret;
      if (
        c.chainId !== batch.d.chainId ||
        c.contract.toLowerCase() !== batch.d.contract.toLowerCase()
      )
        throw Error('凭据不属于当前市场');
      const o = await batch.read('getOrder', [BigInt(c.round), c.owner]);
      if (commitment(c) !== o.commitment)
        throw Error('凭据与链上承诺不一致');
      saveSecret(c);
      setWatchedOwner(c.owner);
      setSelected(BigInt(c.round));
      setCredential(c);
      setNotice('订单凭据已恢复，可按链上阶段揭示');
    } catch (e) {
      setNotice(err(e));
    }
  }

  const remaining = Math.max(
    0,
    Number(
      s.phase === 1 ? s.commitEnd : s.phase === 2 ? s.revealEnd : s.settleEnd
    ) -
      Number(s.time) -
      Math.floor((now - syncAt.current) / 1000)
  );
  const mineStatus = !own
    ? '尚未下单'
    : own.claimed
      ? '资产已到账'
      : s.phase === 5
        ? '本金可取回'
        : s.phase === 4
          ? '等待领取'
          : own.revealed
            ? '已揭示 · 等待清算'
            : s.phase >= 3
              ? '未揭示 · 可退回'
              : '已密封 · 等待揭示';
  const variant = continuous(permutations[compare]);
  const estimate = Math.max(0, buy ? Number(qty) * Number(price) : Number(qty));
  const lock =
    padding && Number.isFinite(estimate) && estimate > 0
      ? Number(paddedEscrow(BigInt(Math.ceil(estimate * 10000)), 10000n)) /
        10000
      : estimate;
  const audit = s.phase === 4 ? referenceClear(clearingInputs(s.orders)) : null;
  const verified =
    audit &&
    audit.price === s.price &&
    audit.volume === s.volume &&
    audit.low === s.low &&
    audit.high === s.high &&
    audit.fills.every((f, i) => f === s.orders[i].fillLots);
  const step = nextAction(s, !!account, prepared, own);
  const outcome = own ? orderOutcome(own, s) : null;

  async function next() {
    if (step.kind === 'connect') return connect(true);
    if (step.kind === 'prepare')
      return action('准备交易资产', async () => {
        if (!batch || !wallet) return;
        await batch.fund(wallet);
        setPrepared(true);
        setNotice('钱包已就绪，可以开启轮次或提交订单');
      });
    if (step.kind === 'latest') {
      setSelected(undefined);
      return;
    }
    if (step.kind === 'place') return place();
    if (step.kind === 'open')
      return action('准备对手盘并开启轮次', async () => {
        const hash = await relayOrWrite('open', {seed: true}, 'openRound', []);
        setSelected(undefined);
        return hash;
      });
    if (step.kind === 'reveal') return action('揭示订单', reveal);
    if (step.kind === 'settle')
      return action('触发统一清算', () =>
        relayOrWrite('settle', {round: String(s.id)}, 'settle', [s.id])
      );
    if (step.kind === 'claim')
      return action('领取成交与退款', () =>
        relayOrWrite('claim', {round: String(s.id), owner}, 'claimFor', [
          s.id,
          owner,
        ])
      );
  }

  function handleTourStep(tourStep: TourStep) {
    if (tourStep.id === 'compare') setDockTab('compare');
    if (tourStep.id === 'allocation') setDockTab('algorithm');
    if (tourStep.id === 'orders') setDockTab('orders');
  }

  function handleTourAction(tourStep: TourStep) {
    if (tourStep.id === 'compare') {
      setDockTab('compare');
      setCompare(c => (c + 1) % permutations.length);
    }
  }

  useEffect(() => {
    window.__FB_DEMO_BRIDGE__ = {
      configureTicket: opts => {
        if (opts.buy !== undefined) setBuy(opts.buy);
        if (opts.price !== undefined) setPrice(opts.price);
        if (opts.qty !== undefined) setQty(opts.qty);
        if (opts.padding !== undefined) setPadding(opts.padding);
      },
      setDockTab: nextTab => setDockTab(nextTab),
      setCompare: idx => setCompare(idx % permutations.length),
      challengeSolver: async () => {
        setDockTab('witness');
        await challengeSolver();
      },
      refresh: async () => {
        await refresh();
      },
    };
    return () => {
      delete window.__FB_DEMO_BRIDGE__;
    };
  });

  return (
    <div className="fb-app">
      {/* Unified Single-Platform Top Bar (44px) */}
      <header className="fb-header">
        <div className="fb-header-left">
          <div className="fb-brand-lockup">
            <Logo />
            <div className="fb-brand-text">
              <div className="fb-brand-title">
                FairBatch
                <em>INSTITUTIONAL</em>
              </div>
              <div className="fb-brand-sub">全链订单簿 · 意图网格 · 密封集合竞价一体化终端</div>
            </div>
          </div>

          <nav className="fb-mode-nav" aria-label="交易机制切换">
            {onSwitchEngine ? (
              <button
                type="button"
                className="fb-mode-link"
                onClick={() => onSwitchEngine('clob')}
              >
                <span className="fb-mode-idx">01</span>
                <span>连续订单簿 · 意图网格</span>
              </button>
            ) : (
              <a href="/" className="fb-mode-link">
                <span className="fb-mode-idx">01</span>
                <span>连续订单簿 · 意图网格</span>
              </a>
            )}
            <button
              type="button"
              className="fb-mode-link active"
              aria-current="page"
            >
              <span className="fb-mode-idx">02</span>
              <span>密封集合竞价 · FairBatch</span>
            </button>
          </nav>
        </div>

        <div className="fb-header-right">
          <span className="fb-network">
            <i />
            <span>{batch?.d.network || '连接中'}</span>
            <span className="fb-sep">|</span>
            <b>BLK #{String(s.block)}</b>
          </span>

          <button
            className="fb-wallet"
            disabled={!!busy || !batch || s.block === 0n}
            title={account && prepared ? '点击复制当前钱包地址' : '一键启用并准备演示钱包'}
            onClick={() => {
              if (account && prepared) {
                void navigator.clipboard
                  .writeText(account)
                  .then(() => setNotice('已复制钱包地址'));
              } else {
                void connect(true);
              }
            }}
          >
            <Wallet size={13} />
            <span>{account ? short(account) : '一键启用演示账户'}</span>
          </button>

          <AutoDemoHeaderButton />

          <DemoTour
            name="FairBatch 密封竞价"
            steps={fairBatchTour}
            dark
            onStep={handleTourStep}
            onAction={handleTourAction}
            nextTour={{
              href: '/?tour=1',
              label: '切换至「连续订单簿 · 意图网格」框选图解',
              onClick: onSwitchEngine
                ? () => onSwitchEngine('clob', true)
                : undefined,
            }}
          />
        </div>
      </header>

      {/* Single-Line Batch Round & KPI Telemetry Strip (42px) */}
      <section className="fb-round-strip" data-tour="round">
        <div className="fb-round-left">
          <span className="fb-pair-pill">
            <b>M</b> dMON/dUSDC
          </span>
          <div className="fb-round-label">
            <span>ROUND</span>
            <strong>#{String(s.id).padStart(3, '0')}</strong>
            <select
              aria-label="查看轮次"
              value={String(selected || s.latest)}
              onChange={e =>
                setSelected(
                  e.target.value === '0' ? undefined : BigInt(e.target.value)
                )
              }
            >
              {s.latest === 0n ? (
                <option value="0">最新轮次</option>
              ) : (
                Array.from(
                  {length: Math.min(Number(s.latest), 20)},
                  (_, i) => s.latest - BigInt(i)
                ).map(id => (
                  <option key={String(id)} value={String(id)}>
                    第 {String(id)} 轮{id === s.latest ? ' · 最新' : ''}
                  </option>
                ))
              )}
            </select>
          </div>

          <div className="fb-steps">
            {['密封提交', '封盘揭示', '统一清算', '资产到账'].map((label, i) => (
              <div
                key={label}
                className={
                  (s.phase !== 5 && s.phase > i + 1 ? 'done ' : '') +
                  (s.phase !== 5 && Math.min(s.phase, 4) === i + 1
                    ? 'current'
                    : '')
                }
              >
                <b>
                  {s.phase !== 5 && s.phase > i + 1 ? (
                    <Check size={10} />
                  ) : (
                    `0${i + 1}`
                  )}
                </b>
                <span>{label}</span>
                {i < 3 && <em />}
              </div>
            ))}
          </div>
        </div>

        <div className="fb-round-kpis">
          <div className="fb-kpi">
            <span>已密封</span>
            <strong>
              {String(s.count)}
              <small>/32</small>
            </strong>
          </div>
          <div className="fb-kpi">
            <span>已揭示</span>
            <strong>
              {String(s.revealed)}
              <small>/{String(s.count)}</small>
            </strong>
          </div>
          <div className="fb-kpi">
            <span>统一清算价 P*</span>
            <strong className="gold">
              {s.price ? fmt(Number(s.price) / 100) : '—'}
              <small>dUSDC</small>
            </strong>
          </div>
          <div className="fb-kpi">
            <span>最大成交量 V*</span>
            <strong className="green">
              {s.phase === 4 ? fmt(Number(s.volume) / 100) : '—'}
              <small>dMON</small>
            </strong>
          </div>

          <div className="fb-countdown">
            <Timer size={13} />
            <strong>
              {s.phase > 0 && s.phase < 4
                ? `${Math.floor(remaining / 60)}:${String(
                    remaining % 60
                  ).padStart(2, '0')}`
                : '—'}
            </strong>
            <span>
              {s.phase === 1
                ? '后封盘'
                : s.phase === 2
                  ? '后清算'
                  : phases[s.phase]}
            </span>
          </div>

          {[0, 4, 5].includes(s.phase) && s.id === s.latest && (
            <button
              className="fb-outline fb-compact-btn"
              disabled={!!busy || !batch || s.block === 0n || !prepared}
              title={prepared ? undefined : '请先在左侧准备钱包与资产'}
              onClick={() =>
                void action('开启新轮次', async () => {
                  setSelected(undefined);
                  return relayOrWrite('open', {seed: true}, 'openRound', []);
                })
              }
            >
              <span>开启下一轮</span>
              <ArrowRight size={12} />
            </button>
          )}
        </div>
      </section>

      {/* Main Single-Screen 3-Column Workspace (1fr, overflow: hidden) */}
      <main className="fb-workspace">
        {/* Column 1: Sealed Order Ticket */}
        <aside className="fb-panel fb-ticket" data-tour="ticket">
          <div className="fb-panel-header">
            <div className="fb-tv-h">
              <h2>密封委托单 · SEALED TICKET</h2>
            </div>
            <span>1 ORDER / ROUND</span>
          </div>

          <div className="fb-ticket-body">
            <div className="fb-toggle">
              <button
                className={buy ? 'active buy' : ''}
                onClick={() => setBuy(true)}
              >
                买入 dMON · BUY
              </button>
              <button
                className={!buy ? 'active sell' : ''}
                onClick={() => setBuy(false)}
              >
                卖出 dMON · SELL
              </button>
            </div>

            <div className="fb-input-grid">
              <label className="fb-field">
                <span>
                  {buy
                    ? '最高可接受买价 (MAX LIMIT)'
                    : '最低可接受卖价 (MIN LIMIT)'}
                </span>
                <div>
                  <input
                    aria-label="限价"
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={price}
                    onChange={e => setPrice(e.target.value)}
                  />
                  <span>dUSDC</span>
                </div>
              </label>

              <label className="fb-field">
                <span>委托交易数量 (QUANTITY)</span>
                <div>
                  <input
                    aria-label="交易数量"
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={qty}
                    onChange={e => setQty(e.target.value)}
                  />
                  <span>dMON</span>
                </div>
              </label>
            </div>

            <div className="fb-estimate">
              <span>本轮需锁定保证金</span>
              <strong>
                {fmt(lock)} {buy ? 'dUSDC' : 'dMON'}
              </strong>
            </div>

            <div data-tour="reveal" className="fb-reveal-options">
              {batch?.d.relayer && (
                <label className="fb-auto">
                  <input
                    type="checkbox"
                    checked={direct}
                    onChange={e => setDirect(e.target.checked)}
                  />
                  <span>
                    钱包直接提交<small>自行付 Gas，不经中继</small>
                  </span>
                </label>
              )}
              <label className="fb-auto fb-padding-opt">
                <input
                  type="checkbox"
                  checked={padding}
                  onChange={e => setPadding(e.target.checked)}
                />
                <span>
                  隐藏精确锁仓量 (2^k 档位掩码)
                  <small>按 1/2/4/8 整数档锁仓，差额全退</small>
                </span>
                <LockKeyhole size={13} />
              </label>

              <label className="fb-auto">
                <input
                  type="checkbox"
                  checked={auto}
                  onChange={e => setAuto(e.target.checked)}
                />
                <span>
                  封盘后自动揭示报价 (Auto-Reveal)
                  <small>保持页面开启即可自动揭示上链</small>
                </span>
                <Zap size={13} />
              </label>
            </div>

            <div className="fb-preparation">
              <span className={prepared ? 'green' : 'gold'}>
                {prepared
                  ? '✓ 钱包与交易资产已就绪'
                  : '① 先准备钱包，再开启限时竞价'}
              </span>
              <small>
                {s.phase === 2 && !own
                  ? '本轮已封盘，准备完成后可参与下一轮。'
                  : s.phase >= 4
                    ? '本轮已结束，可查看右侧结果或开启下一轮。'
                    : prepared
                      ? '② 密封提交 → ③ 自动揭示 → ④ 统一清算到账'
                      : '自动领取 Gas、测试代币并完成合约授权。'}
              </small>
            </div>

            <button
              className="fb-primary"
              disabled={
                !!busy ||
                !batch ||
                s.block === 0n ||
                !!error ||
                step.kind === 'wait' ||
                (step.kind === 'reveal' && !credential)
              }
              onClick={() => void next()}
            >
              <span>{busy || step.label}</span>
              <ArrowRight size={14} />
            </button>

            {!account && (
              <button
                className="fb-text"
                disabled={!!busy || !batch || s.block === 0n}
                onClick={() => void connect(false)}
              >
                <span>连接浏览器钱包 (Injected EVM)</span>
                <ArrowUpRight size={11} />
              </button>
            )}

            {(notice || error) && (
              <p className="fb-action-feedback" role="status">
                {error || notice}
              </p>
            )}

            <div className="fb-ticket-footer">
              <button onClick={() => upload.current?.click()}>
                <Upload size={11} />
                <span>导入揭示凭据</span>
              </button>
              <button disabled={!credential} onClick={download}>
                <Download size={11} />
                <span>导出凭据备份</span>
              </button>
              <input
                ref={upload}
                type="file"
                hidden
                accept="application/json,.json"
                onChange={e => void importCredential(e.target.files?.[0])}
              />
            </div>
          </div>
        </aside>

        {/* Column 2: Clearing Curve (Top) + Multi-Tab Deep-Dive Dock (Bottom) */}
        <div className="fb-center-column">
          <section className="fb-panel fb-clearing-panel" data-tour="clearing">
            <div className="fb-panel-header">
              <div className="fb-tv-h">
                <h2>统一清算供需曲线 · UNIFORM CLEARING ENGINE</h2>
              </div>
              <div className="fb-header-actions">
                <span className="fb-formula-inline">
                  {s.phase === 4 && s.volume > 0n
                    ? `P* = ⌊(${String(s.low)} + ${String(s.high)}) / 2⌋ = ${fmt(
                        Number(s.price) / 100
                      )} dUSDC`
                    : phaseHelp[s.phase]}
                </span>
                <span className="fb-live">
                  <i />
                  {phases[s.phase]}
                </span>
                {s.phase === 3 && (
                  <button
                    className="fb-outline fb-compact-btn"
                    disabled={!!busy}
                    onClick={() =>
                      void action('触发统一清算', () =>
                        relayOrWrite('settle', {round: String(s.id)}, 'settle', [
                          s.id,
                        ])
                      )
                    }
                  >
                    <span>立即触发清算</span>
                    <ArrowRight size={12} />
                  </button>
                )}
              </div>
            </div>

            <div className="fb-curve-wrap">
              <Curve s={s} />
            </div>
          </section>

          {/* Bottom Tabbed Dock: Folds Ledger, 6-Permutation Comparison, Witness Audit & Algorithm Spec into 1 screen */}
          <section
            className="fb-panel fb-dock-panel"
            data-tour="fb-dock"
          >
            <div className="fb-dock-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={dockTab === 'orders'}
                className={dockTab === 'orders' ? 'active' : ''}
                onClick={() => setDockTab('orders')}
              >
                <span>链上承诺与揭示账本</span>
                <b>{s.orders.length}</b>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={dockTab === 'compare'}
                className={dockTab === 'compare' ? 'active' : ''}
                onClick={() => setDockTab('compare')}
              >
                <span>顺序无关对照实验</span>
                <b>CLOB vs FB</b>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={dockTab === 'witness'}
                className={dockTab === 'witness' ? 'active' : ''}
                onClick={() => setDockTab('witness')}
              >
                <span>O(n) 见证防作恶核验</span>
                <b className="green">{verified ? '✓ -51.8%' : '-51.8% GAS'}</b>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={dockTab === 'algorithm'}
                className={dockTab === 'algorithm' ? 'active' : ''}
                onClick={() => setDockTab('algorithm')}
              >
                <span>确定性清算规范</span>
                <b>SPEC</b>
              </button>
            </div>

            <div className="fb-dock-body">
              {dockTab === 'orders' && (
                <div className="fb-table-scroll" data-tour="orders">
                  <table>
                    <thead>
                      <tr>
                        <th>交易账户</th>
                        <th>方向</th>
                        <th>申报数量 (dMON)</th>
                        <th>揭示限价 (dUSDC)</th>
                        <th>分配成交 (dMON)</th>
                        <th>链上状态</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.orders.map((o: Order) => (
                        <tr key={o.owner}>
                          <td>
                            {short(o.owner)}
                            {batch?.d.counterparties?.some(
                              a => a.toLowerCase() === o.owner.toLowerCase()
                            ) && <em>自动对手盘</em>}
                            {o.owner.toLowerCase() === account?.toLowerCase() && (
                              <em className="me-tag">当前账户</em>
                            )}
                          </td>
                          <td className={o.isBuy ? 'green' : 'rose'}>
                            {o.isBuy ? 'BUY · 买入' : 'SELL · 卖出'}
                          </td>
                          <td>
                            {o.revealed ? (
                              fmt(Number(o.lots) / 100)
                            ) : (
                              <span className="fb-muted">密封承诺</span>
                            )}
                          </td>
                          <td>
                            {o.revealed ? (
                              fmt(Number(o.limitTicks) / 100)
                            ) : (
                              <span className="fb-muted">
                                <LockKeyhole size={11} /> SEALED
                              </span>
                            )}
                          </td>
                          <td>
                            {s.phase === 4 ? fmt(Number(o.fillLots) / 100) : '—'}
                          </td>
                          <td>
                            <span
                              className={`fb-status-pill ${
                                o.claimed
                                  ? 'done'
                                  : o.revealed
                                    ? 'revealed'
                                    : 'sealed'
                              }`}
                            >
                              {o.claimed
                                ? 'CLAIMED · 已到账'
                                : o.revealed
                                  ? 'REVEALED · 已揭示'
                                  : 'COMMITTED · 已密封'}
                            </span>
                          </td>
                        </tr>
                      ))}
                      {!s.orders.length && (
                        <tr>
                          <td colSpan={6} className="fb-empty-table">
                            <span>本轮暂无密封订单。点击顶部「开启下一轮」注入四笔自动对手盘，或先查看 </span>
                            <button
                              type="button"
                              className="fb-inline-audit-btn"
                              onClick={() => setDockTab('compare')}
                            >
                              6 种到达顺序 (CLOB vs FairBatch) 同屏对照 →
                            </button>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {dockTab === 'compare' && (
                <div className="fb-compare-pane" data-tour="compare">
                  <div className="fb-compare-top">
                    <span className="fb-caption">
                      固定三笔各 1 手订单：<b>A 买 ≤110</b>，<b>B 卖 ≥90</b>，<b>C 买 ≤100</b>。点击切换 6 种上链到达顺序：
                    </span>
                    <div className="fb-permutations">
                      {permutations.map((seq, i) => (
                        <button
                          key={i}
                          className={compare === i ? 'active' : ''}
                          onClick={() => setCompare(i)}
                        >
                          {seq.map(x => sample[x].id).join(' → ')}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="fb-comparison">
                    <div>
                      <span>传统连续撮合 (CLOB) · 受 PGA 排序影响</span>
                      <strong>
                        {variant.price}
                        <small>ticks</small>
                      </strong>
                      <p>买方 {variant.buyer} 成交 · 抢跑排序直接改变成交价与归属</p>
                    </div>
                    <div>
                      <span>
                        FairBatch 统一清算 <CheckCheck size={13} /> · 顺序无关
                      </span>
                      <strong>
                        100<small>ticks</small>
                      </strong>
                      <p>买方 A 成交 · 全部 6 种到达顺序均收敛至唯一公平结果</p>
                    </div>
                  </div>
                </div>
              )}

              {dockTab === 'witness' && (
                <div className="fb-witness-pane">
                  <div className="fb-witness-bar">
                    <span className="fb-audit-status">
                      {notice.includes('漏单见证')
                        ? `✓ ${notice}`
                        : audit
                          ? verified
                            ? '✓ 客户端独立复算与链上状态 100% 一致'
                            : '复算发现差异'
                          : '封盘清算后自动执行客户端独立复核'}
                    </span>
                    <button
                      className="fb-outline fb-compact-btn"
                      disabled={!!busy || !s.revealed}
                      onClick={() => void challengeSolver()}
                    >
                      <span>模拟恶意漏单见证攻击</span>
                    </button>
                  </div>
                  <div className="fb-protocol-grid">
                    <div>
                      <strong>01 · O(n) 位图校验（清算省 51.8% Gas）</strong>
                      <p>合约用 Bitmap 校验全部已揭示订单且无重复，漏单立即 Revert；适配 Monad 按 gas_limit 计费与高冷存储成本。</p>
                    </div>
                    <div>
                      <strong>02 · EIP-712 委托代发（10 MON 储备友好）</strong>
                      <p>签名绑定 Chain ID、轮次、锁仓与 Nonce，兼容 Monad 10 MON Reserve Balance 限制，低余额账户免发多笔交易。</p>
                    </div>
                    <div>
                      <strong>03 · 独立双算法复核（防御 PGA 抢跑）</strong>
                      <p>前端内置参考清算引擎逐笔核验合约双指针与最大堆分配结果，消除 Monad 默认 PGA 排序下的同块抢跑。</p>
                    </div>
                  </div>
                </div>
              )}

              {dockTab === 'algorithm' && (
                <div className="fb-algorithm-pane" data-tour="algorithm">
                  <ol className="fb-spec-list">
                    <li>
                      <b>01</b>
                      <div>
                        <strong>求取最大可成交量 (Volume Maximization V*)</strong>
                        <p>买单按限价降序、卖单按限价升序排列，双指针扫描求取累计供需最大交集手数 V*。</p>
                      </div>
                    </li>
                    <li>
                      <b>02</b>
                      <div>
                        <strong>可行价格区间中点统一定价 (Uniform Midpoint P*)</strong>
                        <p>取第 V* 手边际买卖限价区间中点 P* = ⌊(L + H) / 2⌋，所有成交共享同一价格。</p>
                      </div>
                    </li>
                    <li>
                      <b>03</b>
                      <div>
                        <strong>同价按量比例分配 (Pro-Rata + Largest Remainder)</strong>
                        <p>边际同价订单按申报量比例分配整手数，余数大者优先补一手，同余数按地址字典序决胜。</p>
                      </div>
                    </li>
                  </ol>
                </div>
              )}
            </div>
          </section>
        </div>

        {/* Column 3: Personal Batch Order + Round Settlement Audit Summary */}
        <aside className="fb-right-column">
          <section className="fb-panel fb-my-order" data-tour="my-order">
            <div className="fb-panel-header">
              <div className="fb-tv-h">
                <h2>
                  {watchedOwner
                    ? '已恢复凭据订单 · RECOVERED'
                    : '我的本轮委托 · MY ORDER'}
                </h2>
              </div>
              <span className={own?.claimed ? 'green' : 'gold'}>
                {mineStatus}
              </span>
            </div>

            {!own ? (
              <div className="fb-no-order">
                <FileKey2 size={18} />
                <p>
                  {s.phase >= 4
                    ? '当前账户未参与这一轮竞价。'
                    : s.phase === 2 || s.phase === 3
                      ? '本轮已封盘，当前账户未参与。'
                      : '当前账户在本轮尚未提交密封订单。'}
                  <small>
                    {s.phase === 1
                      ? '在左侧设定限价并提交，凭据将自动保存在当前浏览器。'
                      : '先准备钱包，按左侧主按钮进入可参与的轮次。'}
                  </small>
                </p>
              </div>
            ) : (
              <div className="fb-my-order-body">
                <div className="fb-own-grid">
                  <div>
                    <span>方向 / 委托量</span>
                    <strong className={own.isBuy ? 'green' : 'rose'}>
                      {own.isBuy ? 'BUY' : 'SELL'}{' '}
                      {own.revealed
                        ? fmt(Number(own.lots) / 100)
                        : credential
                          ? fmt(Number(credential.lots) / 100)
                          : '已密封'}
                    </strong>
                  </div>
                  <div>
                    <span>实际分配成交</span>
                    <strong>
                      {s.phase >= 4
                        ? `${fmt(Number(own.fillLots) / 100)} dMON`
                        : '等待清算'}
                    </strong>
                  </div>
                  <div>
                    <span>应收/已收 dMON</span>
                    <strong>{fmt(Number(own.baseDue) / 1e18)}</strong>
                  </div>
                  <div>
                    <span>应收/已收 dUSDC</span>
                    <strong>{fmt(Number(own.quoteDue) / 1e6)}</strong>
                  </div>
                </div>

                {outcome && (
                  <div className="fb-outcome">
                    <div>
                      <span>{own.claimed ? '成交到账' : '成交可领'}</span>
                      <strong className="green">
                        {fmt(
                          Number(outcome.received) /
                            (own.isBuy ? 1e18 : 1e6)
                        )}{' '}
                        {outcome.receivedToken}
                      </strong>
                    </div>
                    <div>
                      <span>{own.claimed ? '退款到账' : '退款可领'}</span>
                      <strong>
                        {fmt(
                          Number(outcome.refund) / (own.isBuy ? 1e6 : 1e18)
                        )}{' '}
                        {outcome.refundToken}
                      </strong>
                    </div>
                    <p>{outcome.reason}</p>
                    <small>
                      退款构成：
                      {outcome.components.length
                        ? outcome.components
                            .map(
                              c =>
                                `${c.label} ${fmt(
                                  Number(c.value) / (own.isBuy ? 1e6 : 1e18)
                                )}`
                            )
                            .join(' + ')
                        : '无剩余锁仓'}{' '}
                      {outcome.refundToken}
                    </small>
                  </div>
                )}

                <div className="fb-order-actions">
                  {watchedOwner && (
                    <button onClick={() => setWatchedOwner(undefined)}>
                      返回我的钱包
                    </button>
                  )}
                  <code title={own.commitment}>
                    哈希 {short(own.commitment)}
                  </code>
                  {s.phase === 2 && !own.revealed && (
                    <button
                      className="fb-outline fb-compact-btn"
                      disabled={!!busy || !credential}
                      onClick={() => void action('揭示订单', reveal)}
                    >
                      立即揭示
                    </button>
                  )}
                  {!own.claimed &&
                    (s.phase >= 4 || (s.phase === 3 && !own.revealed)) && (
                      <button
                        className="fb-outline fb-compact-btn"
                        disabled={!!busy}
                        onClick={() =>
                          void action('领取成交与退款', () =>
                            relayOrWrite(
                              'claim',
                              {round: String(s.id), owner},
                              'claimFor',
                              [s.id, owner]
                            )
                          )
                        }
                      >
                        领取资产与退款
                      </button>
                    )}
                </div>
              </div>
            )}
          </section>

          {/* Compact Audit Telemetry Panel */}
          <section className="fb-panel fb-audit-card">
            <div className="fb-panel-header">
              <div className="fb-tv-h">
                <h2>本轮清算参数与审计 · BATCH AUDIT</h2>
              </div>
              <ShieldCheck size={13} />
            </div>
            <div className="fb-audit-rows">
              <div>
                <span>边际价格区间 [L, H] / 统一价 P*</span>
                <strong className="gold">
                  {s.price
                    ? `[${fmt(Number(s.low) / 100)}, ${fmt(Number(s.high) / 100)}] → ${fmt(Number(s.price) / 100)}`
                    : '—'}
                </strong>
              </div>
              <div>
                <span>v0.3 见证清算 Gas 压降</span>
                <strong className="green">-51.8% (适配 gas_limit 计费)</strong>
              </div>
              <div>
                <span>客户端独立复算校验</span>
                <strong className="green">
                  {audit ? (verified ? '✓ 100% 匹配链上结果' : '存在偏差') : '待结算后触发'}
                </strong>
              </div>
              <div>
                <span>PGA 抗抢跑顺序对照</span>
                <button
                  type="button"
                  className="fb-inline-audit-btn"
                  onClick={() => {
                    setDockTab('compare');
                    setCompare(c => (c + 1) % permutations.length);
                  }}
                >
                  6 种顺序 CLOB vs FB →
                </button>
              </div>
              <div>
                <span>抗作恶见证验证</span>
                <button
                  type="button"
                  className="fb-inline-audit-btn"
                  disabled={!!busy || !s.revealed}
                  onClick={() => {
                    setDockTab('witness');
                    void challengeSolver();
                  }}
                >
                  测试恶意漏单回滚 →
                </button>
              </div>
            </div>
            {receipt && (
              <div className="fb-receipt">
                <span>最新 Tx</span>
                {batch?.d.chainId === 10143 ? (
                  <a
                    href={`https://testnet.monadscan.com/tx/${receipt}`}
                    target="_blank"
                    rel="noreferrer"
                    title={receipt}
                  >
                    <code>{short(receipt)}</code>
                    <ArrowUpRight size={11} />
                  </a>
                ) : (
                  <code title={receipt}>{short(receipt)}</code>
                )}
                <button
                  onClick={() => void navigator.clipboard.writeText(receipt)}
                >
                  复制
                </button>
              </div>
            )}
          </section>
        </aside>
      </main>

      <footer className="fb-footer">
        <span>
          <i className="fb-dot" />
          FAIRBATCH
        </span>
        <code title={batch?.d.contract}>
          CONTRACT {batch ? short(batch.d.contract) : '连接中'}
        </code>
        <span>60S COMMIT · 60S REVEAL · O(N) WITNESS · PRO-RATA UNIFORM CLEARING</span>
      </footer>
    </div>
  );
}
