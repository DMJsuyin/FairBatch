import {useMemo, useState} from 'react';
import {Activity, ChartCandlestick, ChartLine} from 'lucide-react';
import {candles} from './analytics';
import type {Snapshot} from './chain';

const fmtPrice = (value: number) => value.toFixed(2);
const fmtTime = (value: number) =>
  new Date(value * 1000).toLocaleTimeString('zh-CN', {hour: '2-digit', minute: '2-digit', hour12: false});

export default function MarketChart({snapshot}: {snapshot: Snapshot}) {
  const bars = useMemo(() => candles(snapshot.fills).slice(-60), [snapshot.fills]);
  const [mode, setMode] = useState<'line' | 'candles'>('candles');
  const [hovered, setHovered] = useState<number>();
  const activeIdx = Math.min(hovered ?? bars.length - 1, Math.max(0, bars.length - 1));
  const active = bars[activeIdx];

  const vwapSeries = useMemo(() => {
    let cumPv = 0;
    let cumV = 0;
    return bars.map(bar => {
      const typical = (bar.high + bar.low + bar.close) / 3;
      const vol = Math.max(bar.volume, 0.01);
      cumPv += typical * vol;
      cumV += vol;
      return cumPv / cumV;
    });
  }, [bars]);

  const W = 760, left = 14, right = 684, top = 20, bottom = 212, volTop = 232, volBottom = 266;
  const high = bars.length ? Math.max(...bars.map(bar => bar.high)) : 1.05;
  const low = bars.length ? Math.min(...bars.map(bar => bar.low)) : 0.95;
  const padding = Math.max((high - low) * 0.2, 0.015);
  const minP = low - padding;
  const maxP = high + padding;
  const y = (value: number) => bottom - ((value - minP) / Math.max(maxP - minP, 0.0001)) * (bottom - top);

  const count = bars.length;
  const plotW = right - left - 24;
  const x = (index: number) =>
    count > 1 ? left + 12 + (index / (count - 1)) * plotW : left + 12 + plotW / 2;

  const linePoints = bars.map((bar, index) => `${x(index)},${y(bar.close)}`).join(' ');
  const vwapPoints = vwapSeries.map((val, index) => `${x(index)},${y(val)}`).join(' ');
  const maxVolume = Math.max(1, ...bars.map(bar => bar.volume));
  const candleWidth = Math.max(4, Math.min(12, Math.floor(plotW / Math.max(count * 1.6, 8))));

  const activeVwap = vwapSeries[activeIdx] ?? active?.close ?? 0;
  const changePct = active && active.open > 0 ? ((active.close - active.open) / active.open) * 100 : 0;

  return (
    <>
      <div className="chart-toolbar">
        <div className="chart-period">
          <span className="period-chip">1M · 1分钟</span>
          <span className="period-meta">
            {snapshot.block ? `实盘链上聚合成交 · ${bars.length} 根周期` : '正在同步链上区块事件…'}
          </span>
        </div>
        <div className="chart-switch" role="group" aria-label="图表类型">
          <button
            title="K线蜡烛图"
            aria-label="蜡烛图"
            aria-pressed={mode === 'candles'}
            onClick={() => setMode('candles')}
          >
            <ChartCandlestick size={14} />
            <span>K线</span>
          </button>
          <button
            title="分时折线与均价"
            aria-label="价格折线"
            aria-pressed={mode === 'line'}
            onClick={() => setMode('line')}
          >
            <ChartLine size={14} />
            <span>分时</span>
          </button>
        </div>
      </div>

      {active ? (
        <>
          <div className="chart-legend">
            <span className="legend-time">{fmtTime(active.time)}</span>
            <span>开 <b>{fmtPrice(active.open)}</b></span>
            <span>高 <b>{fmtPrice(active.high)}</b></span>
            <span>低 <b>{fmtPrice(active.low)}</b></span>
            <span>
              收{' '}
              <b className={active.close >= active.open ? 'buy' : 'sell'}>
                {fmtPrice(active.close)}
              </b>
            </span>
            <span>
              幅{' '}
              <b className={changePct >= 0 ? 'buy' : 'sell'}>
                {changePct >= 0 ? '+' : ''}
                {changePct.toFixed(2)}%
              </b>
            </span>
            <span>
              VWAP <b className="vwap-val">{fmtPrice(activeVwap)}</b>
            </span>
            <span>
              量 <b>{active.volume.toFixed(2)} dMON</b>
            </span>
          </div>

          <svg
            className="market-chart"
            viewBox={`0 0 ${W} 290`}
            role="img"
            aria-label="链上实际成交行情图，展示1分钟OHLC蜡烛、VWAP均价线与成交量分布。"
            onPointerLeave={() => setHovered(undefined)}
            onPointerMove={event => {
              const rect = event.currentTarget.getBoundingClientRect();
              const point = ((event.clientX - rect.left) / rect.width) * W;
              setHovered(
                bars.reduce(
                  (closest, _, index) =>
                    Math.abs(x(index) - point) < Math.abs(x(closest) - point) ? index : closest,
                  0
                )
              );
            }}
          >
            <defs>
              <linearGradient id="tv-area-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#c9a254" stopOpacity="0.22" />
                <stop offset="100%" stopColor="#c9a254" stopOpacity="0.0" />
              </linearGradient>
            </defs>

            {/* 5 horizontal boundaries (4x4 institutional grid) */}
            {[0, 1, 2, 3, 4].map(index => {
              const value = minP + ((maxP - minP) * index) / 4;
              const py = y(value);
              return (
                <g key={`h-${index}`}>
                  <line x1={left} x2={right} y1={py} y2={py} className="chart-grid" />
                  <text x={right + 8} y={py + 3} className="axis-label">
                    {value.toFixed(3)}
                  </text>
                </g>
              );
            })}

            {/* 5 vertical boundaries */}
            {[0, 1, 2, 3, 4].map(col => {
              const vx = left + 12 + (col / 4) * plotW;
              const sampleIdx = count > 1 ? Math.round((col / 4) * (count - 1)) : 0;
              const barAtCol = bars[sampleIdx];
              return (
                <g key={`v-${col}`}>
                  <line x1={vx} x2={vx} y1={top} y2={volBottom} className="chart-grid-v" />
                  {barAtCol && (col === 0 || col === 2 || col === 4 || count >= 4) && (
                    <text x={vx} y="284" textAnchor="middle" className="axis-label">
                      {fmtTime(barAtCol.time)}
                    </text>
                  )}
                </g>
              );
            })}

            {/* Volume separator */}
            <line x1={left} x2={right} y1={volTop - 6} y2={volTop - 6} className="chart-divider" />
            <text x={right + 8} y={volTop + 10} className="axis-label">
              VOL
            </text>
            <text x={right + 8} y={volBottom} className="axis-label">
              {maxVolume.toFixed(0)}
            </text>

            {/* VWAP reference line */}
            {bars.length > 1 && (
              <polyline
                points={vwapPoints}
                fill="none"
                stroke="#5b8dd9"
                strokeWidth="1.25"
                strokeDasharray="3 3"
                opacity="0.85"
              />
            )}

            {mode === 'line' ? (
              <>
                {bars.length > 1 && (
                  <>
                    <polygon
                      points={`${x(0)},${bottom} ${linePoints} ${x(bars.length - 1)},${bottom}`}
                      fill="url(#tv-area-fill)"
                    />
                    <polyline
                      points={linePoints}
                      fill="none"
                      stroke="#c9a254"
                      strokeWidth="2"
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                  </>
                )}
                <circle
                  cx={x(bars.length - 1)}
                  cy={y(bars.at(-1)!.close)}
                  r="3.5"
                  fill="#c9a254"
                  stroke="#0b0e13"
                  strokeWidth="1.5"
                />
              </>
            ) : (
              bars.map((bar, index) => {
                const isUp = bar.close >= bar.open;
                const color = isUp ? '#2ebd85' : '#e05260';
                const cx = x(index);
                const bodyTop = Math.min(y(bar.open), y(bar.close));
                const bodyHeight = Math.max(2, Math.abs(y(bar.open) - y(bar.close)));
                return (
                  <g key={bar.time}>
                    <line
                      x1={cx}
                      x2={cx}
                      y1={y(bar.high)}
                      y2={y(bar.low)}
                      stroke={color}
                      strokeWidth="1.2"
                    />
                    <rect
                      x={cx - candleWidth / 2}
                      y={bodyTop}
                      width={candleWidth}
                      height={bodyHeight}
                      fill={color}
                      rx="0.5"
                    />
                  </g>
                );
              })
            )}

            {/* Volume bars */}
            {bars.map((bar, index) => {
              const isUp = bar.close >= bar.open;
              const vHeight = Math.max(2, (bar.volume / maxVolume) * (volBottom - volTop));
              const cx = x(index);
              return (
                <rect
                  key={`vol-${bar.time}`}
                  x={cx - Math.max(2, candleWidth / 2 - 0.5)}
                  y={volBottom - vHeight}
                  width={Math.max(4, candleWidth - 1)}
                  height={vHeight}
                  fill={isUp ? '#2ebd85' : '#e05260'}
                  opacity={hovered === index ? '0.85' : '0.42'}
                />
              );
            })}

            {/* Bidirectional crosshair */}
            {hovered !== undefined && (
              <g>
                <line
                  x1={x(activeIdx)}
                  x2={x(activeIdx)}
                  y1={top}
                  y2={volBottom}
                  stroke="#c9a254"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                  opacity="0.75"
                />
                <line
                  x1={left}
                  x2={right}
                  y1={y(active.close)}
                  y2={y(active.close)}
                  stroke="#c9a254"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                  opacity="0.6"
                />
                <rect
                  x={right + 4}
                  y={y(active.close) - 8}
                  width="54"
                  height="16"
                  rx="2"
                  fill="#c9a254"
                />
                <text x={right + 8} y={y(active.close) + 3} className="crosshair-tag">
                  {active.close.toFixed(3)}
                </text>
                <circle
                  cx={x(activeIdx)}
                  cy={y(active.close)}
                  r="3.5"
                  fill="#c9a254"
                  stroke="#0b0e13"
                  strokeWidth="1.5"
                />
              </g>
            )}
          </svg>
        </>
      ) : (
        <div className="chart-empty">
          <Activity size={24} />
          <strong>{snapshot.block ? '等待链上首笔撮合成交' : '正在同步链上订单簿与成交事件'}</strong>
          <p>
            {snapshot.block
              ? '仅由合约真实 Trade 事件生成 K 线与 VWAP，无成交时段绝不伪造行情。'
              : '正在连接演示 RPC 节点读取区块快照…'}
          </p>
        </div>
      )}
    </>
  );
}
