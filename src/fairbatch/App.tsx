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
import {fairBatchTour} from '../tourSteps';
import {depthCurve} from './depth';
import {nextAction,orderOutcome} from './experience';

const phases = [
  '等待开场',
  '密封挂单',
  '揭示订单',
  '等待清算',
  '本轮已结算',
  '本轮已到期',
];
const phaseHelp = [
  '开启一个集合竞价轮次，买卖双方在同一时间窗口内提交哈希承诺报价。',
  '限价在封盘前保持密码学密封，交易上链先后顺序不影响同批订单的清算价格。',
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
          <LockKeyhole size={26} />
        </div>
        <h3>{s.phase===0?'准备钱包，开启第一轮竞价':s.phase===1?'SEALED COMMITMENT WINDOW · 报价密封中':s.phase===2?'等待参与者揭示报价':'本轮没有可绘制的有效报价'}</h3>
        <p>{s.phase<=1?'封盘前合约仅记录承诺哈希，不公开限价，减少提交阶段的报价泄露与跟单。':s.phase===2?'有效报价揭示后，供需曲线将按报价断点实时更新。':'未揭示订单或超时轮次可全额退回锁定资产。'}</p>
        <div className="fb-sealed-marks">
          <span>
            <ShieldCheck size={13} /> 哈希承诺防抢跑
          </span>
          <span>
            <Layers size={13} /> 同批同价统一清算
          </span>
          <span>
            <CheckCheck size={13} /> 链上 O(n) 见证核验
          </span>
        </div>
      </div>
    );
  const {lo,hi,max,points:depth} = depthCurve(rows);
  const x = (p: number) => 55 + ((p - lo) / (hi - lo)) * 620;
  const y = (q: number) => 218 - (q / max) * 180;
  const points = (buy: boolean) => depth.map(p=>`${x(p.price)},${y(buy?p.buy:p.sell)}`).join(' ');
  return (
    <div className="fb-curve">
      <svg viewBox="0 0 730 265" role="img" aria-label="揭示订单的累计供需曲线">
        {[0, 1, 2, 3, 4].map(i => (
          <g key={i}>
            <line
              x1="55"
              x2="675"
              y1={38 + i * 45}
              y2={38 + i * 45}
              stroke="#19202b"
              strokeDasharray="3 4"
            />
            <text x="45" y={42 + i * 45} textAnchor="end">
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
              y1="26"
              y2="220"
              stroke="#c9a254"
              strokeWidth="1.5"
              strokeDasharray="4 4"
            />
            <text
              x={x(Number(s.price))}
              y="18"
              textAnchor="middle"
              fill="#c9a254"
            >
              P* {fmt(Number(s.price) / 100)}
            </text>
          </g>
        )}
        {[lo, (lo + hi) / 2, hi].map(p => (
          <text key={p} x={x(p)} y="246" textAnchor="middle">
            {fmt(p / 100)}
          </text>
        ))}
        <text x="55" y="18">
          累计深度 (dMON)
        </text>
        <text x="675" y="261" textAnchor="end">
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

export default function App() {
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
    document.title = 'FairBatch · 机构级密封集合竞价终端';
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
          if (sessionStorage.getItem(`fairbatch:wallet:${d.chainId}`))
            setWallet(b.localWallet());
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
    const id = setInterval(() => void refresh(), 3000);
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
    const reset = () => {setWallet(undefined);setPrepared(false);};
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
      const hash = direct ? await batch.write(wallet, 'commit', [s.id, buy, commitment(c), escrow]) : await batch.commitOrder(
        wallet,
        c,
        escrow
      );
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
  const step=nextAction(s,!!account,prepared,own);
  const outcome=own?orderOutcome(own,s):null;
  async function next(){
    if(step.kind==='connect')return connect(true);
    if(step.kind==='prepare')return action('准备交易资产',async()=>{if(!batch||!wallet)return;await batch.fund(wallet);setPrepared(true);setNotice('钱包已就绪，可以开启轮次或提交订单');});
    if(step.kind==='latest'){setSelected(undefined);return;}
    if(step.kind==='place')return place();
    if(step.kind==='open')return action('准备对手盘并开启轮次',async()=>{const hash=await relayOrWrite('open',{seed:true},'openRound',[]);setSelected(undefined);return hash;});
    if(step.kind==='reveal')return action('揭示订单',reveal);
    if(step.kind==='settle')return action('触发统一清算',()=>relayOrWrite('settle',{round:String(s.id)},'settle',[s.id]));
    if(step.kind==='claim')return action('领取成交与退款',()=>relayOrWrite('claim',{round:String(s.id),owner},'claimFor',[s.id,owner]));
  }

  return (
    <div className="fb-app">
      {/* Unified Institutional Top Bar */}
      <header className="fb-header">
        <div className="fb-header-left">
          <a className="fb-brand-lockup" href="/fairbatch">
            <span className="fb-brand-badge">R</span>
            <div className="fb-brand-text">
              <div className="fb-brand-title">
                FAIR<span>/</span>BATCH
                <em>SEALED AUCTION</em>
              </div>
              <div className="fb-brand-sub">MONAD 抗 MEV 密封集合竞价与统一清算终端</div>
            </div>
          </a>

          <nav className="fb-mode-nav" aria-label="交易机制切换">
            <a href="/" className="fb-mode-link">
              <span className="fb-mode-idx">01</span>
              <span>连续订单簿 · 意图网格</span>
            </a>
            <a href="/fairbatch" className="fb-mode-link active" aria-current="page">
              <span className="fb-mode-idx">02</span>
              <span>FairBatch · 密封集合竞价</span>
            </a>
          </nav>
        </div>

        <div className="fb-header-right">
          <DemoTour
            name="FairBatch"
            steps={fairBatchTour}
            dark
            nextTour={{
              href: '/?tour=1',
              label: '返回 CLOB 连续订单簿与意图网格导览',
            }}
          />

          <span className="fb-network">
            <i />
            <span>{batch?.d.network || '连接中'}</span>
            <span className="fb-sep">|</span>
            <b>BLK #{String(s.block)}</b>
          </span>

          <button
            className="fb-wallet"
            disabled={!!busy || !batch || s.block === 0n}
            onClick={() => void connect(true)}
          >
            <Wallet size={13} />
            <span>{account ? short(account) : '使用测试钱包'}</span>
          </button>
        </div>
      </header>

      <main className="fb-main">
        {/* Institutional Banner & Round Telemetry Strip */}
        <section className="fb-intro">
          <div>
            <div className="fb-eyebrow">
              COMMIT-REVEAL BATCH AUCTION · UNIFORM CLEARING PRICE (P*)
            </div>
            <h1>不拼 Gas 抢跑，同批报价共享唯一清算价。</h1>
            <p>
              在同一时间窗口内以密码学承诺收集买卖意向，封盘揭示后按最大可成交量（V*）统一求取清算价（P*），按事先确定的规则成交，减少对抢先提交和报价信息优势的依赖。
            </p>
          </div>
          <div className="fb-market">
            <span className="fb-token">M</span>
            <div>
              <strong>dMON / dUSDC</strong>
              <small>COMMIT-REVEAL · O(N) WITNESS · PRO-RATA TIE-BREAK</small>
            </div>
          </div>
        </section>

        <section className="fb-round" data-tour="round">
          <div className="fb-round-label">
            <span>BATCH ROUND</span>
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
                    <Check size={12} />
                  ) : (
                    `0${i + 1}`
                  )}
                </b>
                <span>{label}</span>
                {i < 3 && <em />}
              </div>
            ))}
          </div>

          <div className="fb-countdown">
            <Timer size={14} />
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
        </section>

        {error && (
          <div className="fb-alert" role="alert">
            <span>{error}</span>
            <button onClick={() => void refresh()}>重新同步</button>
          </div>
        )}
        {(busy || notice) && (
          <div className={'fb-toast ' + (busy ? 'pending' : '')} role="status">
            {busy ? (
              <RefreshCw className="spin" size={14} />
            ) : (
              <Check size={14} />
            )}
            <span>{busy || notice}</span>
          </div>
        )}

        <div className="fb-workspace">
          {/* Left Column: Sealed Order Ticket */}
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

              <div className="fb-estimate">
                <span>本轮需锁定保证金</span>
                <strong>
                  {fmt(lock)} {buy ? 'dUSDC' : 'dMON'}
                </strong>
              </div>

              <p className="fb-caption">
                成交价绝不劣于你的限价边界；清算完成后，统一成交价带来的价差改善与未成交部分一并退回。
              </p>

              <div data-tour="reveal" className="fb-reveal-options">
                {batch?.d.relayer && (
                  <label className="fb-auto">
                    <input type="checkbox" checked={direct} onChange={e => setDirect(e.target.checked)} />
                    <span>钱包直接提交<small>自行支付 Gas；无需经过代发服务</small></span>
                  </label>
                )}
                <label className="fb-auto">
                  <input
                    type="checkbox"
                    checked={padding}
                    onChange={e => setPadding(e.target.checked)}
                  />
                  <span>
                    隐藏精确锁仓量 (2^k 档位掩码)
                    <small>按 1 / 2 / 4 / 8… 档整数倍锁仓，结算后差额全退</small>
                  </span>
                  <LockKeyhole size={14} />
                </label>

                <label className="fb-auto">
                  <input
                    type="checkbox"
                    checked={auto}
                    onChange={e => setAuto(e.target.checked)}
                  />
                  <span>
                    封盘后自动揭示报价 (Auto-Reveal)
                    <small>保持当前页面开启即可在揭示期自动上链</small>
                  </span>
                  <Zap size={14} />
                </label>
              </div>

              <div className="fb-preparation">
                <span className={prepared?'green':'gold'}>{prepared?'✓ 钱包与交易资产已就绪':'① 先准备钱包，再开启限时竞价'}</span>
                <small>{s.phase===2&&!own?'本轮已封盘，准备完成后可参与下一轮。':s.phase>=4?'本轮已结束，下方可查看结果；新订单请开启下一轮。':prepared?'② 密封提交 → ③ 自动揭示 → ④ 查看成交与退款':'Gas、测试资产和授权准备完成后，才开始下单。'}</small>
              </div>
              <button className="fb-primary" disabled={!!busy||!batch||s.block===0n||!!error||step.kind==='wait'||(step.kind==='reveal'&&!credential)} onClick={()=>void next()}>
                <span>{busy||step.label}</span><ArrowRight size={14}/>
              </button>
              {!account&&<button className="fb-text" disabled={!!busy||!batch||s.block===0n} onClick={()=>void connect(false)}><span>连接浏览器钱包</span><ArrowUpRight size={12}/></button>}
              {notice&&<p className="fb-action-feedback" role="status">{notice}</p>}

              <div className="fb-ticket-note">
                <ShieldCheck size={14} />
                <p>
                  限价在封盘前保持哈希密封；订单方向与锁仓上限记录在合约中，本地凭据随时可导出备份。
                </p>
              </div>

              <div className="fb-ticket-footer">
                <button onClick={() => upload.current?.click()}>
                  <Upload size={12} />
                  <span>导入揭示凭据</span>
                </button>
                <button disabled={!credential} onClick={download}>
                  <Download size={12} />
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

          {/* Right Column: Clearing Curve & Personal Order Status */}
          <div className="fb-main-column">
            <section className="fb-panel" data-tour="clearing">
              <div className="fb-panel-header">
                <div className="fb-tv-h">
                  <h2>统一清算供需曲线 · UNIFORM CLEARING ENGINE</h2>
                </div>
                <div className="fb-header-actions">
                  <span className="fb-live">
                    <i />
                    {phases[s.phase]}
                  </span>
                  {[0, 4, 5].includes(s.phase) && s.id === s.latest && (
                    <button
                      className="fb-outline"
                      disabled={!!busy || !batch || s.block === 0n || !prepared}
                      title={prepared ? undefined : '请先在左侧准备钱包与资产'}
                      onClick={() =>
                        void action('开启新轮次', async () => {
                          setSelected(undefined);
                          return relayOrWrite('open', {seed: true}, 'openRound', []);
                        })
                      }
                    >
                      <span>开启下一轮竞价</span>
                      <ArrowRight size={13} />
                    </button>
                  )}
                </div>
              </div>

              <p className="fb-phase-help">{phaseHelp[s.phase]}</p>

              <div className="fb-metrics">
                <div>
                  <span>已密封承诺 (COMMITTED)</span>
                  <strong>
                    {String(s.count)}
                    <small>/ 32 笔</small>
                  </strong>
                </div>
                <div>
                  <span>已揭示报价 (REVEALED)</span>
                  <strong>
                    {String(s.revealed)}
                    <small>/ {String(s.count)} 笔</small>
                  </strong>
                </div>
                <div>
                  <span>统一清算价 (CLEARING P*)</span>
                  <strong className="gold">
                    {s.price ? fmt(Number(s.price) / 100) : '—'}
                    <small>dUSDC</small>
                  </strong>
                </div>
                <div>
                  <span>最大匹配成交量 (VOLUME V*)</span>
                  <strong className="green">
                    {s.phase === 4 ? fmt(Number(s.volume) / 100) : '—'}
                    <small>dMON</small>
                  </strong>
                </div>
              </div>

              <Curve s={s} />

              {s.phase === 3 && (
                <button
                  className="fb-settle"
                  disabled={!!busy}
                  onClick={() =>
                    void action('触发统一清算', () =>
                      relayOrWrite('settle', {round: String(s.id)}, 'settle', [
                        s.id,
                      ])
                    )
                  }
                >
                  <span>揭示窗口已结束 · 立即触发链上统一清算</span>
                  <ArrowRight size={13} />
                </button>
              )}

              {s.phase === 4 && (
                <div className="fb-formula">
                  <span>链上确定性清算公式</span>
                  <code>
                    {s.volume > 0n
                      ? `P* = floor((${String(s.low)} + ${String(
                          s.high
                        )}) / 2) = ${String(s.price)} ticks (${fmt(
                          Number(s.price) / 100
                        )} dUSDC)`
                      : '有效买卖报价区间无交集，本轮 0 成交，锁仓资金全额退回'}
                  </code>
                </div>
              )}
            </section>

            <section
              className="fb-panel fb-my-order"
              data-tour="my-order"
            >
              <div className="fb-panel-header">
                <div className="fb-tv-h">
                  <h2>
                    {watchedOwner
                      ? '已恢复凭据的订单 · RECOVERED ORDER'
                      : '我的本轮委托 · MY BATCH ORDER'}
                  </h2>
                </div>
                <span className={own?.claimed ? 'green' : 'gold'}>
                  {mineStatus}
                </span>
              </div>

              {!own ? (
                <div className="fb-no-order">
                  <FileKey2 size={20} />
                  <p>
                    {s.phase>=4?'当前账户未参与这一轮竞价。':s.phase===2||s.phase===3?'本轮已封盘，当前账户没有参与。':'当前账户在本轮尚未提交密封订单。'}
                    <small>{s.phase===1?'在左侧设定限价并提交，揭示凭据会保存在当前浏览器，可导出备份。':'先准备钱包，按左侧主按钮进入可参与的轮次。'}</small>
                  </p>
                </div>
              ) : (
                <>
                  <div className="fb-own-grid">
                    <div>
                      <span>方向 / 委托量</span>
                      <strong className={own.isBuy ? 'green' : 'rose'}>
                        {own.isBuy ? 'BUY · 买入' : 'SELL · 卖出'}{' '}
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
                          : '等待统一清算'}
                      </strong>
                    </div>
                    <div>
                      <span>应收 / 已收 dMON</span>
                      <strong>{fmt(Number(own.baseDue) / 1e18)}</strong>
                    </div>
                    <div>
                      <span>应收 / 已收 dUSDC</span>
                      <strong>{fmt(Number(own.quoteDue) / 1e6,4)}</strong>
                    </div>
                  </div>
                  {outcome&&<div className="fb-outcome">
                    <div><span>{own.claimed?'成交到账':'成交可领'}</span><strong className="green">{fmt(Number(outcome.received)/(own.isBuy?1e18:1e6),own.isBuy?2:4)} {outcome.receivedToken}</strong></div>
                    <div><span>{own.claimed?'退款到账':'退款可领'}</span><strong>{fmt(Number(outcome.refund)/(own.isBuy?1e6:1e18),own.isBuy?4:2)} {outcome.refundToken}</strong></div>
                    <p>{outcome.reason}</p>
                    <small>退款构成：{outcome.components.length?outcome.components.map(c=>`${c.label} ${fmt(Number(c.value)/(own.isBuy?1e6:1e18),own.isBuy?4:2)}`).join(' + '):'无剩余锁仓'} {outcome.refundToken}</small>
                  </div>}
                  <div className="fb-order-actions">
                    {watchedOwner && (
                      <button onClick={() => setWatchedOwner(undefined)}>
                        返回我的钱包订单
                      </button>
                    )}
                    <code title={own.commitment}>
                      承诺哈希 {short(own.commitment)}
                    </code>
                    {s.phase === 2 && !own.revealed && (
                      <button
                        className="fb-outline"
                        disabled={!!busy || !credential}
                        onClick={() => void action('揭示订单', reveal)}
                      >
                        立即揭示报价
                      </button>
                    )}
                    {!own.claimed &&
                      (s.phase >= 4 || (s.phase === 3 && !own.revealed)) && (
                        <button
                          className="fb-outline"
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
                          领取结算资产与退款
                        </button>
                      )}
                    {own.claimed && (
                      <span className="green">
                        <CheckCheck size={13} /> 链上已结算到账
                      </span>
                    )}
                  </div>
                </>
              )}

              {receipt && (
                <div className="fb-receipt">
                  <span>最近交易哈希</span>
                  <code title={receipt}>{short(receipt)}</code>
                  <button
                    onClick={() => void navigator.clipboard.writeText(receipt)}
                  >
                    复制哈希
                  </button>
                  {batch?.d.chainId === 10143 && (
                    <a
                      href={`https://testnet.monadscan.com/tx/${receipt}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      区块浏览器查看 ↗
                    </a>
                  )}
                </div>
              )}
            </section>
          </div>
        </div>

        {/* Bottom Comparison & Algorithm Specification */}
        <div className="fb-bottom">
          <section className="fb-panel fb-compare" data-tour="compare">
            <div className="fb-panel-header">
              <div className="fb-tv-h">
                <h2>机制对照实验：交易顺序是否改变清算结果？</h2>
              </div>
              <Activity size={15} />
            </div>
            <p className="fb-caption">
              固定三笔各 1 手订单：A 买 ≤110，B 卖 ≥90，C 买 ≤100。切换 6 种上链到达顺序，对比连续撮合（CLOB）与 FairBatch 集合竞价的结算差异：
            </p>
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
            <div className="fb-comparison">
              <div>
                <span>传统连续撮合 (CLOB)</span>
                <strong>
                  {variant.price}
                  <small>ticks</small>
                </strong>
                <p>买方 {variant.buyer} 成交 · 交易排序直接改变成交价与归属</p>
              </div>
              <div>
                <span>
                  FairBatch 统一清算 <CheckCheck size={13} />
                </span>
                <strong>
                  100<small>ticks</small>
                </strong>
                <p>买方 A 成交 · 全部 6 种到达顺序均收敛至唯一公平结果</p>
              </div>
            </div>
          </section>

          <section className="fb-panel fb-algorithm" data-tour="algorithm">
            <div className="fb-panel-header">
              <div className="fb-tv-h">
                <h2>确定性清算与分配规范 · DETERMINISTIC SPEC</h2>
              </div>
              <ShieldCheck size={15} />
            </div>
            <ol>
              <li>
                <b>01</b>
                <div>
                  <strong>求取最大可成交量 (Volume Maximization V*)</strong>
                  <p>买单按限价降序、卖单按限价升序排列，计算累计供需曲线的最大可交集手数 V*。</p>
                </div>
              </li>
              <li>
                <b>02</b>
                <div>
                  <strong>可行价格区间中点统一定价 (Uniform Midpoint P*)</strong>
                  <p>取边际买价与边际卖价区间的向下取整中点作为唯一清算价 P*，所有成交共享同一价格。</p>
                </div>
              </li>
              <li>
                <b>03</b>
                <div>
                  <strong>同价按量比例分配 (Pro-Rata + Largest Remainder)</strong>
                  <p>边际同价订单按申报量比例分配整手数，余数较大者优先补齐一手；余数相同时按地址字典序确定。</p>
                </div>
              </li>
            </ol>
            <div className="fb-algo-footer">
              <span>O(n) 排序见证链上校验</span>
              <span>单轮容量上限 32 笔</span>
              <span>无需信任外部 Solver</span>
            </div>
          </section>
        </div>

        {/* Protocol Verification & Witness Audit */}
        <section className="fb-panel fb-protocol">
          <div className="fb-panel-header">
            <div className="fb-tv-h">
              <h2>链上见证防作恶校验 · VERIFIABLE WITNESS AUDIT</h2>
            </div>
            <div className="fb-header-actions">
              <span className="fb-audit-status">
                {audit
                  ? verified
                    ? '✓ 客户端独立复算与链上状态 100% 一致'
                    : '复算发现差异'
                  : '封盘清算后自动执行独立复核'}
              </span>
              <button
                className="fb-outline"
                disabled={!!busy || !s.revealed}
                onClick={() => void challengeSolver()}
              >
                <span>模拟恶意漏单见证攻击</span>
              </button>
            </div>
          </div>
          <div className="fb-protocol-grid">
            <div>
              <strong>01 · 排序见证可由任何人提交，合约强制完整性校验</strong>
              <p>
                合约通过位图（Bitmap）检验见证是否包含全部已揭示订单且无重复，逐项核对单调性，恶意漏单立即回滚（incomplete witness）。
              </p>
            </div>
            <div>
              <strong>02 · EIP-712 类型化签名严格绑定轮次与锁仓上限</strong>
              <p>
                委托签名绑定钱包、合约、Chain ID、轮次、锁仓上限、Nonce 与过期时间；中继代发者仅代付 Gas，无法篡改报价或收款地址。
              </p>
            </div>
            <div>
              <strong>
                03 · {verified ? '清算价、总量与逐笔分配均已独立复核' : '客户端双算法交叉验证'}
              </strong>
              <p>
                浏览器使用独立参考清算算法对照合约的双指针与堆分配结果。
                {audit
                  ? `已完成本轮 ${s.orders.length} 笔订单的逐笔交叉核验。`
                  : '无需信任任何链下服务器结论。'}
              </p>
            </div>
          </div>
        </section>

        {/* On-Chain Batch Orders Table */}
        <section className="fb-panel fb-orders" data-tour="orders">
          <div className="fb-panel-header">
            <div className="fb-tv-h">
              <h2>本轮链上承诺与揭示账本 · ON-CHAIN BATCH LEDGER</h2>
            </div>
            <span>直接读取合约状态 · BLOCK #{String(s.block)}</span>
          </div>
          <div className="fb-table-scroll">
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
                          <LockKeyhole size={12} /> SEALED
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
                      本轮暂无密封订单。点击上方「开启下一轮竞价」后，链上自动对手盘将率先注入四笔密封报价。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <footer className="fb-footer">
          <span>
            <Layers size={13} /> FAIRBATCH INSTITUTIONAL BATCH AUCTION TERMINAL
          </span>
          <code title={batch?.d.contract}>
            CONTRACT {batch ? short(batch.d.contract) : '连接中'}
          </code>
          <span>60S COMMIT WINDOW · 60S REVEAL WINDOW · UNIFORM CLEARING</span>
        </footer>
      </main>
    </div>
  );
}
