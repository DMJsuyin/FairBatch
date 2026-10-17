import {useMemo, useState} from 'react';
import {Activity, ChartCandlestick, ChartLine} from 'lucide-react';
import {candles} from './analytics';
import type {Snapshot} from './chain';

const price = (value: number) => value.toFixed(2);
const time = (value: number) => new Date(value * 1000).toLocaleTimeString('zh-CN', {hour: '2-digit', minute: '2-digit', hour12: false});

export default function MarketChart({snapshot}: {snapshot: Snapshot}) {
  const bars = useMemo(() => candles(snapshot.fills).slice(-60), [snapshot.fills]);
  const [mode, setMode] = useState<'line' | 'candles'>('line');
  const [hovered, setHovered] = useState<number>();
  const active = bars[Math.min(hovered ?? bars.length - 1, bars.length - 1)];
  const W = 720, right = 652, top = 24, bottom = 224;
  const high = Math.max(...bars.map(bar => bar.high));
  const low = Math.min(...bars.map(bar => bar.low));
  const padding = Math.max((high - low) * 0.22, 0.015);
  const y = (value: number) => bottom - (value - low + padding) / (high - low + 2 * padding) * (bottom - top);
  const start = bars[0]?.time ?? 0;
  const duration = (bars.at(-1)?.time ?? 0) - start;
  const x = (index: number) => duration ? 24 + (bars[index].time - start) / duration * (right - 54) : (right - 24) / 2;
  const points = bars.map((bar, index) => `${x(index)},${y(bar.close)}`).join(' ');
  const maxVolume = Math.max(1, ...bars.map(bar => bar.volume));

  return <>
    <div className="chart-toolbar">
      <div className="chart-period"><span>1 分钟</span><small>{snapshot.block ? `最近 ${bars.length} 个成交时段` : '正在读取成交数据'}</small></div>
      <div className="chart-switch" aria-label="图表类型">
        <button title="价格折线" aria-label="价格折线" aria-pressed={mode === 'line'} onClick={() => setMode('line')}><ChartLine size={15}/></button>
        <button title="蜡烛图" aria-label="蜡烛图" aria-pressed={mode === 'candles'} onClick={() => setMode('candles')}><ChartCandlestick size={15}/></button>
      </div>
    </div>
    {active ? <>
      <div className="chart-legend"><span>{time(active.time)}</span><span>开 <b>{price(active.open)}</b></span><span>高 <b>{price(active.high)}</b></span><span>低 <b>{price(active.low)}</b></span><span>收 <b className={active.close >= active.open ? 'buy' : 'sell'}>{price(active.close)}</b></span></div>
      <svg className="market-chart" viewBox={`0 0 ${W} 292`} role="img" aria-label="链上实际成交图，每个时段为一分钟。无成交时段不补造价格。" onPointerLeave={() => setHovered(undefined)} onPointerMove={event => {
        const point = (event.clientX - event.currentTarget.getBoundingClientRect().left) / event.currentTarget.getBoundingClientRect().width * W;
        setHovered(bars.reduce((closest, _, index) => Math.abs(x(index) - point) < Math.abs(x(closest) - point) ? index : closest, 0));
      }}>
        <defs><linearGradient id="price-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#6265ce" stopOpacity="0.19"/><stop offset="100%" stopColor="#6265ce" stopOpacity="0.01"/></linearGradient></defs>
        {[0, 1, 2, 3, 4].map(index => {
          const value = low - padding + (high - low + 2 * padding) * index / 4;
          return <g key={index}><line x1="10" x2={right} y1={y(value)} y2={y(value)} className="chart-grid"/><text x={right + 12} y={y(value) + 4}>{value.toFixed(3)}</text></g>;
        })}
        {mode === 'line' ? <>
          {bars.length > 1 && <><polygon points={`${x(0)},${bottom} ${points} ${x(bars.length - 1)},${bottom}`} fill="url(#price-fill)"/><polyline points={points} fill="none" stroke="#6265ce" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"/></>}
          <circle cx={x(bars.length - 1)} cy={y(bars.at(-1)!.close)} r="4" fill="#6265ce" stroke="white" strokeWidth="2"/>
        </> : bars.map((bar, index) => <g key={bar.time} fill={bar.close >= bar.open ? '#178570' : '#c76169'} stroke={bar.close >= bar.open ? '#178570' : '#c76169'}><line x1={x(index)} x2={x(index)} y1={y(bar.high)} y2={y(bar.low)}/><rect x={x(index) - 4} y={Math.min(y(bar.open), y(bar.close))} width="8" height={Math.max(2, Math.abs(y(bar.open) - y(bar.close)))}/></g>)}
        <line x1="10" x2={right} y1="246" y2="246" className="chart-grid"/>
        {bars.map((bar, index) => <g key={bar.time}><rect x={x(index) - 3} y={267 - bar.volume / maxVolume * 16} width="6" height={Math.max(1, bar.volume / maxVolume * 16)} fill={bar.close >= bar.open ? '#178570' : '#c76169'} opacity=".3"/>{index % Math.max(1, Math.ceil(bars.length / 6)) === 0 && <text x={x(index)} y="286" textAnchor="middle">{time(bar.time)}</text>}</g>)}
        <text x={right + 12} y="264">VOL</text>
        {hovered !== undefined && <g><line x1={x(Math.min(hovered, bars.length - 1))} x2={x(Math.min(hovered, bars.length - 1))} y1={top} y2="267" stroke="#8b8caa" strokeDasharray="4 4"/><circle cx={x(Math.min(hovered, bars.length - 1))} cy={y(active.close)} r="4" fill="#6265ce" stroke="white" strokeWidth="2"/></g>}
      </svg>
    </> : <div className="chart-empty"><Activity size={28}/><strong>{snapshot.block ? '等待第一笔成交' : '正在同步链上行情'}</strong><p>{snapshot.block ? '成交后，价格和成交量将在这里呈现。' : '正在连接订单簿，读取最近成交。'}</p></div>}
  </>;
}
