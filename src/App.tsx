import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {Activity,ArrowDownLeft,ArrowUpRight,ArrowRight,Check,ChevronRight,Copy,ExternalLink,Layers3,LoaderCircle,Pause,Play,RefreshCw,Sparkles,Wallet,X,ChartNoAxesCombined,SlidersHorizontal,History,CircleHelp,ShieldCheck,ArrowLeftRight,FileText,LogOut} from 'lucide-react';
import MarketChart from './MarketChart';
import Dialog from './Dialog';
import type {Address,Hash} from 'viem';
import {createMarket,errorMessage,tokenAmount,zeroSnapshot,type Deployment,type Entry,type Market,type Snapshot} from './chain';
import {bookAbi,tokenAbi} from './abi';
import {allocateGrid,defaultIntent,parseIntent,validateIntent,type GridIntent} from './grid';
import {realizedPnl} from './analytics';
const fmt=(v:number,d=2)=>v.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
const amount=(v:bigint,decimals=6)=>Number(v)/10**decimals;
const short=(s:string)=>`${s.slice(0,6)}…${s.slice(-4)}`;
type Tx={hash:Hash;label:string;status:'pending'|'success'|'failed';gas?:string};
function levels(rows:readonly Entry[]){const result:{price:bigint;lots:bigint}[]=[];for(const row of rows){const last=result.at(-1);if(last?.price===row.price)last.lots+=row.lots;else result.push({price:row.price,lots:row.lots});}return result.slice(0,10);}
export default function App(){
 const [market,setMarket]=useState<Market>(),[snapshot,setSnapshot]=useState<Snapshot>(zeroSnapshot),[account,setAccount]=useState<Address>(),[wallet,setWallet]=useState<any>();
 const [bootError,setBootError]=useState(''),[syncError,setSyncError]=useState(''),[busy,setBusy]=useState(''),[notice,setNotice]=useState(''),[txs,setTxs]=useState<Tx[]>([]);
 const [tab,setTab]=useState<'trade'|'grid'>('grid'),[bottom,setBottom]=useState<'orders'|'fills'|'receipts'>('orders');
 const [side,setSide]=useState(true),[kind,setKind]=useState<'limit'|'ioc'>('limit'),[price,setPrice]=useState('1.00'),[quantity,setQuantity]=useState('10'),[minFill,setMinFill]=useState('0'),[postOnly,setPostOnly]=useState(true);
 const [intentText,setIntentText]=useState('震荡偏多，±4% 区间铺 8 层网格，买入预算 500 USDC，卖出库存 300 MON。'),[intent,setIntent]=useState<GridIntent>(defaultIntent);
 const [preview,setPreview]=useState<ReturnType<typeof allocateGrid>>(),[intentSource,setIntentSource]=useState(''),[intentBusy,setIntentBusy]=useState(false),[replace,setReplace]=useState(false);
 const [dialog,setDialog]=useState<'wallet'|'about'>(),[workspaceView,setWorkspaceView]=useState<'terminal'|'grid'|'history'>('terminal');
 const [funding,setFunding]=useState(false),[fundBase,setFundBase]=useState(false),[fundAmount,setFundAmount]=useState('500'),[arena,setArena]=useState(false),[arenaCount,setArenaCount]=useState(0);
 const arenaStop=useRef(true),busyLock=useRef(false),refreshLock=useRef(false),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;let live=true;fetch('/deployment.json',{cache:'no-store'}).then(async r=>{if(!r.ok)throw new Error('未找到部署信息。请稍后刷新重试，或联系维护人员。');return r.json();}).then((d:Deployment)=>{if(live)setMarket(createMarket(d));}).catch(e=>{if(live)setBootError(errorMessage(e));});return()=>{live=false;mounted.current=false;arenaStop.current=true;};},[]);
 const refresh=useCallback(async()=>{if(!market||refreshLock.current)return;refreshLock.current=true;try{const s=await market.snapshot(account);if(mounted.current){setSnapshot(s);setSyncError('');}}catch(e){if(mounted.current)setSyncError(errorMessage(e));}finally{refreshLock.current=false;}},[market,account]);
 useEffect(()=>{void refresh();const id=setInterval(()=>void refresh(),2500);return()=>clearInterval(id);},[refresh]);
 useEffect(()=>{const p=(window as any).ethereum;if(!p?.on)return;const reset=()=>{setAccount(undefined);setWallet(undefined);setNotice('钱包账户或网络已变化，请重新连接。');arenaStop.current=true;};p.on('accountsChanged',reset);p.on('chainChanged',reset);return()=>{p.removeListener?.('accountsChanged',reset);p.removeListener?.('chainChanged',reset);};},[]);
 const bids=useMemo(()=>levels(snapshot.bids),[snapshot.bids]),asks=useMemo(()=>levels(snapshot.asks),[snapshot.asks]);
 const mid=bids[0]&&asks[0]?(bids[0].price+asks[0].price)/2n:(snapshot.fills.at(-1)?.price||bids[0]?.price||asks[0]?.price||0n);
 const last=snapshot.fills.at(-1)?.price,own=[...snapshot.bids,...snapshot.asks].filter(o=>o.owner.toLowerCase()===account?.toLowerCase());
 const pnl=account?realizedPnl(snapshot.fills,account):{pnl:0n,closedLots:0n,unmatchedSells:0n};
 const baseLocked=own.filter(o=>!o.isBuy).reduce((v,o)=>v+o.lots*10n**16n,0n),quoteLocked=own.filter(o=>o.isBuy).reduce((v,o)=>v+o.lots*o.price*100n,0n);
 const hasTestWallet=!!(market?.d.demoAccount||market?.d.demoHosted);
 const networkLabel=market?.d.chainId===31337?'演示网络':market?.d.network||'连接中';
 const canTrade=!!wallet&&!busy&&!syncError&&snapshot.block>0n;
 const maxDepth=Math.max(1,...bids.map(o=>Number(o.lots)),...asks.map(o=>Number(o.lots)));
 async function action(label:string,fn:()=>Promise<void>){if(busyLock.current)return;busyLock.current=true;setBusy(label);setNotice('');try{await fn();await refresh();setNotice(`${label}完成`);}catch(e){setNotice(errorMessage(e));}finally{busyLock.current=false;setBusy('');}}
 async function write(label:string,functionName:string,args:any[],address=market!.d.book,abi:any=bookAbi,w=wallet){
   let hash:Hash|undefined;
   try{const r=await market!.write(w,address,abi,functionName,args,h=>{hash=h;setTxs(v=>[{hash:h,label,status:'pending' as const},...v].slice(0,30));});setTxs(v=>v.map(t=>t.hash===hash?{...t,status:'success',gas:r.gasUsed.toString()}:t));return r;}
   catch(e){if(hash)setTxs(v=>v.map(t=>t.hash===hash?{...t,status:'failed'}:t));throw e;}
 }
 async function connect(local=false){if(!market)return;await action('连接钱包',async()=>{
   if(local&&market.d.demoHosted){
    const w=market.hostedWallet(),a=w.account.address;
    const r=await fetch('/api/demo/fund',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({address:a})});if(!r.ok)throw new Error((await r.json()).error);
    setAccount(a);setWallet(w);
    for(const [token,isBase,value] of [[market.d.base,true,5000n*10n**18n],[market.d.quote,false,5000n*10n**6n]] as const){
      const free=await market.client.readContract({address:market.d.book,abi:bookAbi,functionName:isBase?'baseFree':'quoteFree',args:[a]});
      if(free===0n){await write('领取测试资产','faucet',[],token,tokenAbi,w);await write('授权测试资产','approve',[market.d.book,value],token,tokenAbi,w);await write('存入测试资产','deposit',[isBase,value],market.d.book,bookAbi,w);}
    }return;
   }
   if(local&&market.d.demoAccount){setAccount(market.d.demoAccount);setWallet(market.localWallet(market.d.demoAccount));return;}
   const p=(window as any).ethereum;if(!p)throw new Error('未检测到浏览器钱包，可使用测试钱包直接交易。');
   const [a]=await p.request({method:'eth_requestAccounts'}) as Address[];
   try{await p.request({method:'wallet_switchEthereumChain',params:[{chainId:`0x${market.d.chainId.toString(16)}`}]});}catch(e:any){if(e.code!==4902)throw e;await p.request({method:'wallet_addEthereumChain',params:[{chainId:`0x${market.d.chainId.toString(16)}`,chainName:market.d.network,nativeCurrency:market.chain.nativeCurrency,rpcUrls:[market.d.rpc]}]});}
   setAccount(a);setWallet(market.injectedWallet(p,a));
 });}
 async function order(){await action('提交订单',async()=>{
   const p=Number(price),q=Number(quantity),minimum=Number(minFill);
   if(!Number.isFinite(p)||!Number.isFinite(q)||p<=0||q<=0||Math.abs(p*100-Math.round(p*100))>1e-6||Math.abs(q*100-Math.round(q*100))>1e-6)throw new Error('价格与数量必须为正数，最多保留两位小数');
   if(kind==='ioc'&&(!Number.isFinite(minimum)||minimum<0||minimum>q||Math.abs(minimum*100-Math.round(minimum*100))>1e-6))throw new Error('最低成交数量须在 0 与下单数量之间，最多两位小数');
   await write('下单','placeOrder',[{isBuy:side,price:BigInt(Math.round(p*100)),lots:BigInt(Math.round(q*100)),ioc:kind==='ioc',postOnly:kind==='limit'&&postOnly,minFill:kind==='ioc'?BigInt(Math.round(minimum*100)):0n}]);
 });}
 async function generate(useAI=false){setIntentBusy(true);setNotice('');setPreview(undefined);try{
   let x:GridIntent,source:string;
   if(useAI){const r=await fetch('/api/intent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:intentText,defaults:intent})});const json=await r.json();if(!r.ok)throw new Error(json.error||'模型服务不可用');x=validateIntent(json.intent);source=json.source;}
   else{x=parseIntent(intentText,intent);source='规则解析';}
   setIntent(x);setPreview(allocateGrid(x,mid));setIntentSource(source);
 }catch(e){setNotice(errorMessage(e));}finally{setIntentBusy(false);}}
 function editIntent(key:keyof GridIntent,value:number|string){setIntent(v=>({...v,[key]:value}));setPreview(undefined);}
 async function deployGrid(){if(!preview)return;await action(replace?'替换网格':'批量挂单',async()=>{
   if(replace){if(own.length>16)throw new Error('单次最多替换 16 笔订单，请先分批撤单');await write('替换网格','replaceOrders',[own.map(o=>o.id),preview.orders]);}
   else await write('网格挂单','batchPlaceOrders',[preview.orders]);
   setPreview(undefined);setBottom('orders');
 });}
 async function funds(mode:'deposit'|'withdraw'|'faucet'){await action(mode==='deposit'?'充值':mode==='withdraw'?'提取':'领取测试币',async()=>{
   const token=fundBase?market!.d.base:market!.d.quote;
   if(mode==='faucet'){await write('测试币水龙头','faucet',[],token,tokenAbi);return;}
   const value=tokenAmount(fundAmount,fundBase);if(value<=0n)throw new Error('请输入大于零的金额');
   if(mode==='deposit'){const allowance=await market!.client.readContract({address:token,abi:tokenAbi,functionName:'allowance',args:[account!,market!.d.book]});if(allowance<value)await write('授权充值额度','approve',[market!.d.book,value],token,tokenAbi);}
   await write(mode==='deposit'?'充值':'提取',mode,[fundBase,value]);
 });}
 async function toggleArena(){if(arena){arenaStop.current=true;return;}if(!market||(!market.d.arenaAccount&&!market.d.demoHosted)||market.d.chainId!==31337)return;arenaStop.current=false;setArena(true);setArenaCount(0);let count=0;
   const actor=market.d.demoHosted?undefined:market.localWallet(market.d.arenaAccount!);
   try{while(!arenaStop.current&&count<20){if(market.d.demoHosted){const r=await fetch('/api/demo/arena',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});const data=await r.json();if(!r.ok)throw new Error(data.error);setTxs(v=>[{hash:data.hash,label:'Arena 测试成交',status:'success' as const,gas:data.gas},...v].slice(0,30));count++;setArenaCount(count);await refresh();await new Promise(resolve=>setTimeout(resolve,1800));continue;}const s=await market.snapshot();const buy=count%2===0;const top=(buy?s.asks:s.bids)[0];if(!top)throw new Error('对应方向订单簿已空，演示暂停');
     await write('Arena 测试成交','placeOrder',[{isBuy:buy,price:top.price,lots:top.lots<100n?top.lots:100n,postOnly:false,ioc:true,minFill:1n}],market.d.book,bookAbi,actor);
     count++;setArenaCount(count);await refresh();await new Promise(resolve=>setTimeout(resolve,1500));
   }}catch(e){setNotice(errorMessage(e));}finally{setArena(false);arenaStop.current=true;}}
 const txLink=(hash:string)=>market?.d.chainId===10143?`https://testnet.monadscan.com/tx/${hash}`:undefined;
 const totalVolume=snapshot.fills.reduce((sum,fill)=>sum+Number(fill.lots)/100,0);
 const buyDepth=bids.reduce((sum,row)=>sum+Number(row.lots),0),sellDepth=asks.reduce((sum,row)=>sum+Number(row.lots),0);
 function navigate(view:'terminal'|'grid'|'history'){
  setWorkspaceView(view);
  if(view==='grid'){setTab('grid');document.getElementById('execution')?.scrollIntoView({behavior:'smooth',block:'nearest'});}
  else if(view==='history'){setBottom('fills');document.getElementById('activity')?.scrollIntoView({behavior:'smooth',block:'nearest'});}
  else window.scrollTo({top:0,behavior:'smooth'});
 }
 function openFunding(){setNotice('');setFunding(true);}
 async function copy(value:string){try{await navigator.clipboard.writeText(value);setNotice('已复制到剪贴板');}catch{setNotice('复制未成功，请手动选择并复制。');}}
 return <div className="app-shell">
  <a className="skip-link" href="#terminal">跳至交易工作区</a>
  <aside className="nav-rail" aria-label="主导航">
   <a className="brand-mark" href="#terminal" aria-label="CLOB Grid 首页"><Layers3 size={25}/></a>
   <div className="rail-nav">
    <button className={workspaceView==='terminal'?'active':''} aria-current={workspaceView==='terminal'?'page':undefined} onClick={()=>navigate('terminal')}><ChartNoAxesCombined size={21}/><span>交易</span></button>
    <button className={workspaceView==='grid'?'active':''} aria-current={workspaceView==='grid'?'page':undefined} onClick={()=>navigate('grid')}><SlidersHorizontal size={21}/><span>网格</span></button>
    <button className={workspaceView==='history'?'active':''} aria-current={workspaceView==='history'?'page':undefined} onClick={()=>navigate('history')}><History size={21}/><span>记录</span></button>
   </div>
   <div className="rail-bottom"><button onClick={()=>setDialog('about')} aria-label="产品与网络说明"><CircleHelp size={20}/><span>说明</span></button><span className="rail-monogram">R.</span></div>
  </aside>
  <div className="app-main">
   <header className="topbar">
    <div className="brand"><strong>CLOB<span>/</span>GRID</strong><span className="brand-divider"/><span className="brand-caption">链上交易工作台</span></div>
    <div className="header-right"><a className="text-button" href="/fairbatch">FairBatch 密封交易 ↗</a><span className="network"><i className={bootError||syncError?'dot danger':snapshot.block?'dot':'dot waiting'}/>{networkLabel}</span><button className="wallet-button" disabled={!market||!!busy} onClick={()=>setDialog('wallet')}><Wallet size={15}/>{account?short(account):'连接钱包'}<ChevronRight size={13}/></button></div>
   </header>
   <div className="page-content" id="terminal">
    <div className="workspace-heading"><div><div className="eyebrow">ON-CHAIN SPOT TERMINAL</div><h1>交易终端<span className="version-label">BETA</span></h1></div><button className="environment-note" onClick={()=>setDialog('about')}><ShieldCheck size={15}/><span>测试资产，无真实价值</span><ChevronRight size={13}/></button></div>
    {(bootError||syncError)&&<div className="error-banner" role="alert"><Activity size={17}/><span>{bootError||syncError}{syncError&&' · 已暂停下单，正在重连。'}</span><button onClick={()=>bootError?window.location.reload():refresh()}>重试</button></div>}
    <section className="market-strip" aria-label="市场概览">
     <div className="pair"><span className="token-mark"><span/></span><div><h2>dMON <span>/ dUSDC</span></h2><small>Monad <span>·</span> 现货订单簿</small></div></div>
     <div className="market-price"><strong>{last?fmt(Number(last)/100):'—'}</strong><small>最新成交 <span>dUSDC</span></small></div>
     <div className="stat"><small>买卖价差</small><strong>{bids[0]&&asks[0]?fmt(Number(asks[0].price-bids[0].price)/100):'—'}</strong></div>
     <div className="stat"><small>有效挂单</small><strong>{snapshot.block?snapshot.bids.length+snapshot.asks.length:'—'}<span> / 128</span></strong></div>
     <div className="stat volume-stat"><small>{snapshot.partialHistory?'近期成交量':'累计成交量'}</small><strong>{snapshot.block?fmt(totalVolume):'—'} <span>dMON</span></strong></div>
     <div className="market-status"><span><i className={bootError||syncError?'dot danger':snapshot.block?'dot':'dot waiting'}/>{bootError||syncError?'连接异常':snapshot.block?'链上同步':'连接中'}</span><small>区块 {snapshot.block?fmt(Number(snapshot.block),0):'—'}</small><button className="icon-button" aria-label="刷新链上状态" onClick={()=>refresh()}><RefreshCw size={14}/></button></div>
    </section>
    <main className="terminal-layout"><div className="workspace">
     <div className="market-panels">
      <section className="panel chart-panel"><div className="panel-header"><div className="panel-title"><ChartNoAxesCombined size={16}/><h2>市场走势</h2></div><span className="subtle">dMON / dUSDC</span></div><MarketChart snapshot={snapshot}/><div className="chart-footer"><span><i className="dot"/>实际链上成交</span><span>{snapshot.partialHistory?'近期':'累计'} {snapshot.fills.length} 笔 <span className="separator">/</span> 时间 {Intl.DateTimeFormat().resolvedOptions().timeZone}</span></div>
       <div className="arena-bar"><div className="arena-icon"><Activity size={17}/></div><div><strong>Arena 交易流 <span className="small-tag">演示</span></strong><small>规则驱动对手盘 · 每轮最多 20 笔</small></div><button disabled={(!market?.d.arenaAccount&&!market?.d.demoHosted)||!!syncError} className={arena?'outline-button':'arena-button'} onClick={()=>toggleArena()}>{arena?<Pause size={13}/>:<Play size={13}/>} {arena?`停止 ${arenaCount}/20`:'运行'}</button></div>
      </section>
      <section className="panel book-panel"><div className="panel-header"><h2>订单簿</h2><span className="small-tag">10 档</span></div><div className="book-head"><span>价格 <small>dUSDC</small></span><span>数量 <small>dMON</small></span></div>
       <div className="book-rows asks">{asks.slice().reverse().map(o=><button key={String(o.price)} className="book-row sell" aria-label={`以卖单价格 ${fmt(Number(o.price)/100)} 填入委托`} onClick={()=>{setPrice((Number(o.price)/100).toFixed(2));setTab('trade');}}><span className="depth" style={{width:`${Number(o.lots)/maxDepth*100}%`}}/><span>{fmt(Number(o.price)/100)}</span><span>{fmt(Number(o.lots)/100)}</span></button>)}{!asks.length&&<p className="empty-small">{snapshot.block?'暂无卖单':'正在读取卖单…'}</p>}</div>
       <div className="mid-price"><strong>{mid?fmt(Number(mid)/100):'—'}<ArrowLeftRight size={14}/></strong><span>中间价</span></div>
       <div className="book-rows bids">{bids.map(o=><button key={String(o.price)} className="book-row buy" aria-label={`以买单价格 ${fmt(Number(o.price)/100)} 填入委托`} onClick={()=>{setPrice((Number(o.price)/100).toFixed(2));setTab('trade');}}><span className="depth" style={{width:`${Number(o.lots)/maxDepth*100}%`}}/><span>{fmt(Number(o.price)/100)}</span><span>{fmt(Number(o.lots)/100)}</span></button>)}{!bids.length&&<p className="empty-small">{snapshot.block?'暂无买单':'正在读取买单…'}</p>}</div>
       <div className="depth-summary"><div><span className="buy">买 {buyDepth+sellDepth?fmt(buyDepth/(buyDepth+sellDepth)*100,0):'—'}%</span><span className="sell">卖 {buyDepth+sellDepth?fmt(sellDepth/(buyDepth+sellDepth)*100,0):'—'}%</span></div><div className="depth-ratio"><i style={{width:`${buyDepth+sellDepth?buyDepth/(buyDepth+sellDepth)*100:50}%`}}/></div></div>
      </section>
     </div>
     <section className="panel activity-panel" id="activity" aria-label="交易记录"><div className="panel-header tabs"><div className="activity-tabs" role="tablist" aria-label="交易记录类型"><button role="tab" aria-selected={bottom==='orders'} className={bottom==='orders'?'active':''} onClick={()=>setBottom('orders')}>当前委托 <b>{own.length}</b></button><button role="tab" aria-selected={bottom==='fills'} className={bottom==='fills'?'active':''} onClick={()=>setBottom('fills')}>市场成交</button><button role="tab" aria-selected={bottom==='receipts'} className={bottom==='receipts'?'active':''} onClick={()=>setBottom('receipts')}>交易回执 {txs.some(t=>t.status==='pending')&&<i className="dot waiting"/>}</button></div>{bottom==='orders'&&own.length>0&&<button className="text-button cancel-all" disabled={!canTrade} onClick={()=>action('批量撤单',async()=>{await write('批量撤单','batchCancel',[own.slice(0,16).map(o=>o.id)]);})}>撤销{own.length>16?'前 16 笔':'全部'}</button>}</div>
      <div className="table-scroll" role="tabpanel" aria-label={bottom==='orders'?'当前委托':bottom==='fills'?'市场成交':'交易回执'}>{bottom==='orders'?<table><thead><tr><th>订单</th><th>方向</th><th>委托价格</th><th>剩余数量</th><th>锁定资产</th><th>操作</th></tr></thead><tbody>{own.map(o=><tr key={String(o.id)}><td>#{String(o.id)}</td><td><span className={`side-label ${o.isBuy?'buy':'sell'}`}>{o.isBuy?'买入':'卖出'}</span></td><td>{fmt(Number(o.price)/100)}</td><td>{fmt(Number(o.lots)/100)}</td><td>{o.isBuy?`${fmt(Number(o.lots*o.price)/10000)} dUSDC`:`${fmt(Number(o.lots)/100)} dMON`}</td><td><button className="text-button" disabled={!canTrade} onClick={()=>action('撤单',async()=>{await write('撤单','cancel',[o.id]);})}>撤单</button></td></tr>)}</tbody></table>:bottom==='fills'?<table><thead><tr><th>时间</th><th>吃单方向</th><th>成交价格</th><th>数量</th><th>交易哈希</th></tr></thead><tbody>{snapshot.fills.slice(-35).reverse().map(f=><tr key={`${f.hash}:${f.index}`}><td>{new Date(f.time*1000).toLocaleTimeString('en-GB')}</td><td><span className={`side-label ${f.takerBuy?'buy':'sell'}`}>{f.takerBuy?'主动买入':'主动卖出'}</span></td><td>{fmt(Number(f.price)/100)}</td><td>{fmt(Number(f.lots)/100)}</td><td>{txLink(f.hash)?<a className="hash-link" href={txLink(f.hash)} target="_blank" rel="noreferrer">{short(f.hash)} <ExternalLink size={11}/></a>:<button className="hash-link" title={f.hash} onClick={()=>copy(f.hash)}>{short(f.hash)}<Copy size={11}/></button>}</td></tr>)}</tbody></table>:<table><thead><tr><th>操作</th><th>状态</th><th>Gas 用量</th><th>交易哈希</th></tr></thead><tbody>{txs.map(t=><tr key={t.hash}><td>{t.label}</td><td className={t.status==='success'?'buy':t.status==='failed'?'sell':'subtle'}>{t.status==='success'?'已确认':t.status==='failed'?'失败 / 待核验':'等待确认'}</td><td>{t.gas?fmt(Number(t.gas),0):'—'}</td><td>{txLink(t.hash)?<a className="hash-link" href={txLink(t.hash)} target="_blank" rel="noreferrer">{short(t.hash)} <ExternalLink size={11}/></a>:<button className="hash-link" title={t.hash} onClick={()=>copy(t.hash)}>{short(t.hash)}<Copy size={11}/></button>}</td></tr>)}</tbody></table>}
       {((bottom==='orders'&&!own.length)||(bottom==='fills'&&!snapshot.fills.length)||(bottom==='receipts'&&!txs.length))&&<div className="table-empty"><span className="empty-icon">{bottom==='receipts'?<FileText size={22}/>:<Layers3 size={22}/>}</span><strong>{bottom==='orders'?(account?'暂无待成交委托':'连接钱包，管理你的委托'):bottom==='fills'?'等待市场的第一笔成交':'每笔交易，都有迹可循'}</strong><p>{bottom==='orders'?(account?'创建一笔限价单，或用网格分批布局。':'查看订单状态、管理资金，随时撤回未成交订单。'):bottom==='fills'?'实际成交发生后，记录会自动更新。':'提交订单后，在这里查看确认状态与链上回执。'}</p>{bottom==='orders'&&!account&&<button className="text-button" onClick={()=>setDialog('wallet')}>连接钱包 <ArrowRight size={12}/></button>}</div>}
      </div>
     </section>
     <section className="account-strip" aria-label="账户概览"><div className="account-label"><Wallet size={17}/><strong>账户概览</strong></div><div><small>可用 dUSDC</small><strong>{account?fmt(amount(snapshot.quoteFree)):'—'}</strong><span>锁定 {account?fmt(amount(quoteLocked)):'—'}</span></div><div><small>可用 dMON</small><strong>{account?fmt(amount(snapshot.baseFree,18)):'—'}</strong><span>锁定 {account?fmt(amount(baseLocked,18)):'—'}</span></div><div><small>{snapshot.partialHistory?'近期匹配收益':'已配对成交收益'}</small><strong className={pnl.pnl>=0n?'buy':'sell'}>{account?`${pnl.pnl>0n?'+':''}${fmt(amount(pnl.pnl),4)}`:'—'}</strong><span title="按 FIFO 配对买卖成交；未扣 Gas，不计外部转入资产成本。">FIFO · 未扣 Gas</span></div><button className="outline-button" onClick={()=>account?openFunding():setDialog('wallet')}><ArrowLeftRight size={13}/>{account?'资金管理':'连接钱包'}</button></section>
    </div>
    <aside className="panel execution-panel" id="execution" aria-label="交易与策略编辑"><div className="execution-tabs" role="tablist" aria-label="交易方式"><button role="tab" aria-selected={tab==='trade'} className={tab==='trade'?'active':''} onClick={()=>setTab('trade')}><ArrowLeftRight size={15}/>手动交易</button><button role="tab" aria-selected={tab==='grid'} className={tab==='grid'?'active':''} onClick={()=>setTab('grid')}><SlidersHorizontal size={15}/>意图网格</button></div>
     {tab==='trade'?<div className="execution-body" role="tabpanel" aria-label="手动交易">
      <div className="trade-heading"><h2>创建委托</h2><span className="small-tag">现货</span></div>
      <div className="segmented"><button aria-pressed={side} className={side?'buy active':''} onClick={()=>setSide(true)}>买入 dMON</button><button aria-pressed={!side} className={!side?'sell active':''} onClick={()=>setSide(false)}>卖出 dMON</button></div>
      <div className="order-types"><button className={kind==='limit'?'active':''} aria-pressed={kind==='limit'} onClick={()=>setKind('limit')}>限价委托</button><button className={kind==='ioc'?'active':''} aria-pressed={kind==='ioc'} onClick={()=>setKind('ioc')}>保护价吃单 · IOC</button></div>
      <label className="field">{kind==='limit'?'委托价格':side?'最高买入价':'最低卖出价'}<div><input aria-label="委托价格" type="number" min="0.01" step="0.01" value={price} onChange={e=>setPrice(e.target.value)}/><span>dUSDC</span></div></label>
      <label className="field">委托数量<div><input aria-label="下单数量" type="number" min="0.01" step="0.01" value={quantity} onChange={e=>setQuantity(e.target.value)}/><span>dMON</span></div></label>
      {kind==='limit'?<label className="checkbox"><input type="checkbox" checked={postOnly} onChange={e=>setPostOnly(e.target.checked)}/>只挂单 <span>Post-only</span></label>:<label className="field">最低成交数量<div><input aria-label="最低成交数量" type="number" min="0" step="0.01" value={minFill} onChange={e=>setMinFill(e.target.value)}/><span>dMON</span></div></label>}
      <div className="order-summary"><div className="summary-row"><span>{side?'最大占用':'挂单占用'}</span><strong>{side?fmt(Number(price)*Number(quantity))+' dUSDC':fmt(Number(quantity))+' dMON'}</strong></div><div className="summary-row"><span>可用余额</span><strong>{account?`${fmt(amount(side?snapshot.quoteFree:snapshot.baseFree,side?6:18))} ${side?'dUSDC':'dMON'}`:'连接后查看'}</strong></div></div>
      <button className={`primary-button ${side?'buy-button':'sell-button'}`} disabled={account?!canTrade:!market||!!busy} onClick={()=>account?order():setDialog('wallet')}>{busy?<LoaderCircle className="spin" size={16}/>:<ArrowRight size={16}/>} {busy||(account?`${side?'买入':'卖出'} dMON`:'连接钱包以交易')}</button>
      <p className="explanation">{kind==='limit'?'按价格与时间优先撮合。未成交部分保留在订单簿，可随时撤单。':'在保护价内立即撮合，剩余数量自动取消。低于最低成交量时，整笔交易回滚。'}</p>
     </div>:<div className="execution-body grid-body" role="tabpanel" aria-label="意图网格">
      <div className="strategy-heading"><span className="strategy-icon"><Sparkles size={19}/></span><div><h2>让策略有序执行</h2><p>描述意图，预览后再签名。</p></div></div>
      <div className="strategy-steps" aria-label="策略流程"><span className="done"><b>1</b>设置策略</span><i/><span className={preview?'done':''}><b>2</b>预览</span><i/><span><b>3</b>签名</span></div>
      {!preview&&<><label className="intent-label" htmlFor="intent">交易意图 <span>自然语言</span></label><textarea id="intent" aria-label="交易策略意图" value={intentText} onChange={e=>{setIntentText(e.target.value);setPreview(undefined);}} rows={3}/>
      <div className="parse-actions"><button className="outline-button" disabled={!mid||intentBusy} onClick={()=>generate(false)}>{intentBusy?<LoaderCircle size={14} className="spin"/>:<Layers3 size={14}/>}规则解析</button><button className="ai-button" disabled={!mid||intentBusy} onClick={()=>generate(true)}><Sparkles size={14}/>AI 解析</button></div>
      <div className="form-section-label"><span>网格参数</span><span>可直接编辑</span></div>
      <div className="parameter-grid"><label className="field">网格层数<div><input aria-label="网格层数" type="number" min="2" max="16" value={intent.levels} onChange={e=>editIntent('levels',Number(e.target.value))}/><span>层</span></div></label><label className="field">单侧区间<div><input aria-label="单侧区间" type="number" min="1" max="30" step="0.5" value={intent.rangeBps/100} onChange={e=>editIntent('rangeBps',Number(e.target.value)*100)}/><span>%</span></div></label><label className="field">买入预算<div><input aria-label="买入预算" type="number" min="0" value={intent.budgetQuote} onChange={e=>editIntent('budgetQuote',Number(e.target.value))}/><span>dUSDC</span></div></label><label className="field">卖出库存<div><input aria-label="卖出库存" type="number" min="0" value={intent.baseInventory} onChange={e=>editIntent('baseInventory',Number(e.target.value))}/><span>dMON</span></div></label></div>
      <label className="bias-field">方向偏好<select aria-label="方向偏好" value={intent.bias} onChange={e=>editIntent('bias',e.target.value)}><option value="bullish">偏多 · 更多买单</option><option value="neutral">中性 · 双向均衡</option><option value="bearish">偏空 · 更多卖单</option></select></label>
      <button className={preview?'outline-button preview-button':'primary-button preview-button'} disabled={!mid||intentBusy} onClick={()=>{try{setPreview(allocateGrid(intent,mid));setIntentSource('手动参数 · 确定性分配');setNotice('');}catch(e){setNotice(errorMessage(e));}}}>预览网格订单<ArrowRight size={15}/></button></>}
      {preview&&<div className="grid-preview"><div className="preview-heading"><span><Check size={14}/>订单预览 <b>{preview.orders.length} 笔</b></span><div className="preview-source"><small>{intentSource}</small><button className="text-button" onClick={()=>setPreview(undefined)}>修改参数</button></div></div><div className="grid-bars"><div className="grid-bars-head"><span>方向 / 价格</span><span>数量 · dMON</span></div>{preview.orders.map((o,i)=><div key={i} className={o.isBuy?'buy':'sell'}><span>{o.isBuy?'买':'卖'} <b>{fmt(Number(o.price)/100)}</b></span><span className="grid-meter"><i style={{width:`${Math.max(5,Number(o.lots)/Math.max(...preview.orders.map(o=>Number(o.lots)))*100)}%`}}/></span><span>{fmt(Number(o.lots)/100)}</span></div>)}</div><div className="summary-row"><span>占用 dUSDC / dMON</span><strong>{fmt(amount(preview.quoteRequired))} / {fmt(amount(preview.baseRequired,18))}</strong></div><label className="checkbox"><input type="checkbox" checked={replace} onChange={e=>setReplace(e.target.checked)}/>替换当前全部挂单 <span>最多 16 笔</span></label><button className="primary-button" disabled={account?!canTrade:!market||!!busy} onClick={()=>account?deployGrid():setDialog('wallet')}>{busy?<LoaderCircle size={16} className="spin"/>:<Layers3 size={16}/>} {busy||(account?`签名并${replace?'替换':'挂出'} ${preview.orders.length} 笔订单`:'连接钱包以执行')}</button><p className="explanation">Post-only · 整组原子执行。成交后可重新生成网格。</p></div>}
      {!preview&&<p className="explanation">先核对每档价格与数量，再签名执行。网格不自动补单。</p>}
     </div>}
     {!account&&<div className="connect-card"><div><span className="connect-icon"><Wallet size={17}/></span><div><strong>准备好开始了？</strong><p>连接钱包或体验演示。</p></div></div><button className="outline-button" disabled={!market||!!busy} onClick={()=>setDialog('wallet')}>连接 <ArrowRight size={13}/></button></div>}
     <div className="execution-footer"><ShieldCheck size={14}/><span>你的资产 · 你的签名 · 链上结算</span></div>
    </aside></main>
    <footer className="page-footer"><span><i className="dot"/>CLOB / GRID <span className="separator">·</span> Price–Time Priority</span><span>最小数量 0.01 dMON <span className="separator">/</span> 价格步长 0.01 dUSDC</span><button onClick={()=>setDialog('about')}>网络与合约 <ExternalLink size={11}/></button></footer>
   </div>
  </div>
  {(notice||busy)&&<div className={`toast ${busy?'working':''}`} role="status">{busy?<LoaderCircle size={16} className="spin"/>:<Activity size={16}/>}<span>{busy?`${busy}中，等待钱包与链上确认…`:notice}</span>{!busy&&<button className="icon-button" aria-label="关闭提示" onClick={()=>setNotice('')}><X size={15}/></button>}</div>}
  {dialog==='wallet'&&<Dialog title={account?'钱包已连接':'连接你的钱包'} busy={!!busy} onClose={()=>setDialog(undefined)}><div className="dialog-body"><div className="wallet-intro"><span className="wallet-illustration"><Wallet size={30}/></span><p>{account?'资金与委托由当前钱包管理。':'无需注册。使用钱包签名，直接管理链上资产。'}</p></div>{account?<><div className="address-card"><span>{account}</span><button className="icon-button" aria-label="复制钱包地址" onClick={()=>copy(account)}><Copy size={16}/></button></div><button className="primary-button" onClick={()=>{setDialog(undefined);openFunding();}}>管理资金 <ArrowRight size={15}/></button><button className="disconnect-button" disabled={!!busy} onClick={()=>{setAccount(undefined);setWallet(undefined);arenaStop.current=true;setDialog(undefined);}}><LogOut size={15}/>断开连接</button></>:<><button className="wallet-option" disabled={!market||!!busy} onClick={()=>{setDialog(undefined);void connect();}}><span className="option-icon"><Wallet size={21}/></span><span><strong>浏览器钱包</strong><small>使用已安装的钱包插件签名</small></span><ChevronRight size={18}/></button>{hasTestWallet&&<button className="wallet-option demo-option" disabled={!!busy} onClick={()=>{setDialog(undefined);void connect(true);}}><span className="option-icon"><Layers3 size={21}/></span><span><strong>创建演示钱包 <b>推荐体验</b></strong><small>自动领取测试资产，无需安装插件</small></span><ChevronRight size={18}/></button>}<p className="dialog-note"><ShieldCheck size={14}/>当前为测试网络。dMON 与 dUSDC 均无真实价值。演示钱包仅保留在当前浏览器会话中。</p></>}</div></Dialog>}
  {dialog==='about'&&<Dialog title="网络与产品说明" onClose={()=>setDialog(undefined)}><div className="dialog-body"><div className="about-brand"><Layers3 size={24}/><strong>CLOB / GRID</strong><span>BETA</span></div><p className="about-intro">从交易意图到链上订单，让每一步都可以核对。</p><dl className="network-details"><div><dt>当前网络</dt><dd>{networkLabel}</dd></div><div><dt>Chain ID</dt><dd>{market?.d.chainId||'—'}</dd></div><div><dt>撮合机制</dt><dd>价格优先 · 同价时间优先</dd></div><div><dt>数据范围</dt><dd>{snapshot.partialHistory?'近期读取的成交，历史可能不完整':'部署以来的链上成交'}</dd></div></dl>{market&&<div className="contract-address"><label>订单簿合约</label><button onClick={()=>copy(market.d.book)}>{market.d.book}<Copy size={14}/></button></div>}<div className="about-notes"><p><strong>测试环境</strong>dMON / dUSDC 无真实价值；演示网络重启后，资产和订单可能重置。</p><p><strong>策略执行</strong>规则或 AI 只生成参数，不能代你签名与转账。网格为一次性批量挂单。</p><p><strong>收益口径</strong>仅计算可配对的 FIFO 成交，未扣 Gas，不含未知外部库存成本。</p></div></div></Dialog>}
  {funding&&<Dialog title="资金管理" busy={!!busy} status={notice} onClose={()=>setFunding(false)}><div className="dialog-body"><p className="dialog-subtitle">在钱包与订单簿之间管理可用资产。</p><div className="segmented asset-tabs"><button className={!fundBase?'active':''} aria-pressed={!fundBase} onClick={()=>setFundBase(false)}>dUSDC</button><button className={fundBase?'active':''} aria-pressed={fundBase} onClick={()=>setFundBase(true)}>dMON</button></div><div className="funding-balances"><div><small>钱包余额</small><strong>{fmt(amount(fundBase?snapshot.baseWallet:snapshot.quoteWallet,fundBase?18:6))}</strong></div><div><small>合约可用余额</small><strong>{fmt(amount(fundBase?snapshot.baseFree:snapshot.quoteFree,fundBase?18:6))}</strong></div></div><label className="field">金额<div><input aria-label="充值提取金额" type="number" min="0" value={fundAmount} onChange={e=>setFundAmount(e.target.value)}/><span>{fundBase?'dMON':'dUSDC'}</span></div></label><div className="funding-actions"><button className="primary-button" disabled={!canTrade} onClick={()=>funds('deposit')}><ArrowDownLeft size={15}/>充值</button><button className="outline-button" disabled={!canTrade} onClick={()=>funds('withdraw')}><ArrowUpRight size={15}/>提取</button></div><button className="text-button faucet" disabled={!canTrade} onClick={()=>funds('faucet')}>领取 10,000 枚测试代币 <ArrowRight size={12}/></button><p className="dialog-note"><ShieldCheck size={14}/>充值先授权准确额度，再存入合约。提取仅限可用余额；锁定资产需先撤单。</p></div></Dialog>}
 </div>;
}
