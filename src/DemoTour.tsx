import {useEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleHelp,
  Lightbulb,
  RotateCcw,
  Sparkles,
  X,
} from 'lucide-react';
import {tourLayout, type Rect} from './tourLayout';
import type {TourStep} from './tourSteps';
import './tour.css';

type Props = {
  name: string;
  steps: TourStep[];
  dark?: boolean;
  onStart?: () => void;
  onStep?: (step: TourStep) => void;
  onAction?: (step: TourStep) => void;
  onFinish?: () => void;
  nextTour: {href?: string; label: string; onClick?: () => void};
};

export default function DemoTour(props: Props) {
  const [index, setIndex] = useState<number | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [viewport, setViewport] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const [cardHeight, setCardHeight] = useState(440);
  const [actionDone, setActionDone] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const origin = useRef({x: 0, y: 0, focus: null as HTMLElement | null});
  const callbacks = useRef(props);
  callbacks.current = props;
  const autoStarted = useRef(false);
  const active = index !== null;
  const step = active ? props.steps[index] : null;
  const layout = tourLayout(rect, viewport, cardHeight);

  function start() {
    origin.current = {
      x: window.scrollX,
      y: window.scrollY,
      focus: document.activeElement as HTMLElement,
    };
    callbacks.current.onStart?.();
    setActionDone(null);
    setRect(null);
    setIndex(0);
    callbacks.current.onStep?.(callbacks.current.steps[0]);
  }

  function move(next: number) {
    if (next < 0 || next >= callbacks.current.steps.length) return;
    setActionDone(null);
    setRect(null);
    setIndex(next);
    callbacks.current.onStep?.(callbacks.current.steps[next]);
  }

  function finish() {
    setIndex(null);
    setActionDone(null);
    callbacks.current.onFinish?.();
  }

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('tour') === '1' && !autoStarted.current) {
      autoStarted.current = true;
      url.searchParams.delete('tour');
      window.history.replaceState(window.history.state, '', url);
      start();
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    const node = dialog.current!;
    const previousOverflow = document.body.style.overflow;
    if (!node.open) node.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      if (node.open) node.close();
      document.body.style.overflow = previousOverflow;
      const saved = origin.current;
      requestAnimationFrame(() => {
        if (saved.focus?.isConnected) saved.focus.focus({preventScroll: true});
        window.scrollTo({left: saved.x, top: saved.y, behavior: 'instant'});
      });
    };
  }, [active]);

  useEffect(() => {
    if (!step) return;
    let frame = 0;
    let disposed = false;
    const target = () =>
      document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
    const measure = () => {
      if (disposed) return;
      const element = target();
      const r = element?.getBoundingClientRect();
      setRect(
        r && r.width && r.height
          ? {left: r.left, top: r.top, width: r.width, height: r.height}
          : null
      );
      setViewport({width: window.innerWidth, height: window.innerHeight});
      if (card.current)
        setCardHeight(card.current.getBoundingClientRect().height);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const position = () => {
      const element = target();
      if (element && window.innerWidth < 1024) {
        const r = element.getBoundingClientRect();
        const mobile = window.innerWidth < 720;
        const available =
          window.innerHeight - (mobile ? (card.current?.offsetHeight || 380) + 48 : 80);
        const offset =
          mobile || r.height > available
            ? 24
            : Math.max(24, (window.innerHeight - r.height) / 2);
        window.scrollTo({
          top: Math.max(0, window.scrollY + r.top - offset),
          behavior: 'instant',
        });
      }
      measure();
    };
    frame = requestAnimationFrame(() => {
      position();
      card.current?.focus({preventScroll: true});
    });
    const observer = new ResizeObserver(schedule);
    if (card.current) observer.observe(card.current);
    if (target()) observer.observe(target()!);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', schedule, true);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', schedule, true);
    };
  }, [step, actionDone]);

  return (
    <>
      <button
        className={`demo-tour-trigger${props.dark ? ' is-dark' : ''}`}
        onClick={start}
        aria-haspopup="dialog"
        aria-label="核心功能框选导览与图解"
        title="点击开启核心功能框选导览与交互图解 (Spotlight Guide)"
      >
        <span className="demo-tour-qmark">?</span>
        <span className="demo-tour-trigger-label">功能图解</span>
      </button>

      {active &&
        step &&
        createPortal(
          <dialog
            ref={dialog}
            className={`demo-tour${props.dark ? ' is-dark' : ''}`}
            aria-label={`${props.name}演示导览`}
            aria-describedby="demo-tour-description"
            onCancel={e => {
              e.preventDefault();
              finish();
            }}
            onKeyDown={e => {
              if (e.key === 'ArrowRight') {
                e.preventDefault();
                move(index + 1);
              }
              if (e.key === 'ArrowLeft') {
                e.preventDefault();
                move(index - 1);
              }
            }}
          >
            <svg
              className="demo-tour-shade"
              width={viewport.width}
              height={viewport.height}
              aria-hidden="true"
            >
              <defs>
                <mask id="demo-tour-cutout">
                  <rect width="100%" height="100%" fill="white" />
                  {layout.spot && (
                    <rect
                      x={layout.spot.left}
                      y={layout.spot.top}
                      width={layout.spot.width}
                      height={layout.spot.height}
                      rx="3"
                      fill="black"
                    />
                  )}
                </mask>
              </defs>
              <rect
                width="100%"
                height="100%"
                fill="#06090e"
                fillOpacity=".74"
                mask="url(#demo-tour-cutout)"
              />
            </svg>

            {layout.spot && (
              <div
                className="demo-tour-spot"
                aria-hidden="true"
                style={layout.spot}
              >
                <i className="corner tl" />
                <i className="corner tr" />
                <i className="corner bl" />
                <i className="corner br" />
                <div className="demo-tour-spot-tag">
                  <b>{String(index + 1).padStart(2, '0')}</b>
                  <span>{step.chapter}</span>
                </div>
              </div>
            )}

            <div
              ref={card}
              className="demo-tour-card"
              tabIndex={-1}
              style={{
                left: layout.card.left,
                top: layout.card.top,
                width: layout.card.width,
              }}
            >
              <div className="demo-tour-top">
                <span>
                  <CircleHelp size={13} />
                  {props.name} · 交互式框选图解
                </span>
                <button
                  className="demo-tour-close"
                  aria-label="跳过导览"
                  title="跳过导览 · Esc"
                  onClick={finish}
                >
                  <X size={16} />
                </button>
              </div>

              <div
                className="demo-tour-step-pills"
                role="tablist"
                aria-label={`第 ${index + 1} 步，共 ${props.steps.length} 步`}
              >
                {props.steps.map((s, i) => (
                  <button
                    key={s.id}
                    type="button"
                    role="tab"
                    aria-selected={i === index}
                    className={
                      i === index
                        ? 'active'
                        : i < index
                          ? 'visited'
                          : ''
                    }
                    title={`${String(i + 1).padStart(2, '0')} · ${s.chapter}`}
                    onClick={() => move(i)}
                  >
                    <b>{String(i + 1).padStart(2, '0')}</b>
                    <span>{s.chapter.slice(0, 4)}</span>
                  </button>
                ))}
              </div>

              <div className="demo-tour-copy" aria-live="polite" aria-atomic="true">
                <div className="demo-tour-chapter">
                  <span>STEP {String(index + 1).padStart(2, '0')}</span>
                  <strong>{step.chapter}</strong>
                </div>

                <h2>{step.title}</h2>
                <p id="demo-tour-description">{step.description}</p>

                {/* Visual Mechanism Schematic Diagram ("不止有文字说明") */}
                {step.visualNodes && step.visualNodes.length > 0 && (
                  <div className="demo-tour-diagram">
                    {step.visualTitle && (
                      <div className="demo-tour-diagram-head">
                        <span>{step.visualTitle}</span>
                      </div>
                    )}
                    <div className="demo-tour-nodes">
                      {step.visualNodes.map((node, idx) => (
                        <div key={node.code} className="demo-tour-node-wrap">
                          <div className={`demo-tour-node ${node.tone || 'neutral'}`}>
                            <span className="node-code">{node.code}</span>
                            <strong>{node.label}</strong>
                            <small>{node.sub}</small>
                          </div>
                          {idx < step.visualNodes!.length - 1 && (
                            <span className="node-arrow" aria-hidden="true">
                              →
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                    {step.formula && (
                      <div className="demo-tour-formula">
                        <code>{step.formula}</code>
                      </div>
                    )}
                  </div>
                )}

                {step.metrics && step.metrics.length > 0 && (
                  <div className="demo-tour-metrics">
                    {step.metrics.map(m => (
                      <div key={m.label} className="demo-tour-metric">
                        <span>{m.label}</span>
                        <strong className={m.tone || ''}>{m.value}</strong>
                      </div>
                    ))}
                  </div>
                )}

                <div className="demo-tour-cue">
                  <Lightbulb size={14} />
                  <p>{step.cue}</p>
                </div>

                {step.actionLabel && callbacks.current.onAction && (
                  <button
                    type="button"
                    className={`demo-tour-action-btn ${
                      actionDone === step.id ? 'done' : ''
                    }`}
                    onClick={() => {
                      callbacks.current.onAction?.(step);
                      setActionDone(step.id);
                    }}
                  >
                    {actionDone === step.id ? (
                      <Check size={13} />
                    ) : (
                      <Sparkles size={13} />
                    )}
                    <span>
                      {actionDone === step.id
                        ? '已在当前框选区域执行演练，可观察界面变化'
                        : step.actionLabel}
                    </span>
                  </button>
                )}

                {!rect && (
                  <p className="demo-tour-unavailable">
                    此区域暂未显示，仍可继续阅读或进入下一步。
                  </p>
                )}

                {index === props.steps.length - 1 && (
                  props.nextTour.onClick ? (
                    <button
                      type="button"
                      className="demo-tour-next-route"
                      onClick={() => {
                        const fn = props.nextTour.onClick;
                        finish();
                        fn?.();
                      }}
                    >
                      <span>{props.nextTour.label}</span>
                      <ArrowRight size={14} />
                    </button>
                  ) : (
                    <a className="demo-tour-next-route" href={props.nextTour.href || '#'}>
                      <span>{props.nextTour.label}</span>
                      <ArrowRight size={14} />
                    </a>
                  )
                )}
              </div>

              <div className="demo-tour-actions">
                <button
                  className="demo-tour-back"
                  disabled={index === 0}
                  onClick={() => move(index - 1)}
                >
                  <ArrowLeft size={13} />
                  上一步
                </button>
                <span>
                  {index + 1} / {props.steps.length}
                </span>
                {index === props.steps.length - 1 ? (
                  <button className="demo-tour-primary" onClick={finish}>
                    完成导览
                    <Check size={14} />
                  </button>
                ) : (
                  <button
                    className="demo-tour-primary"
                    onClick={() => move(index + 1)}
                  >
                    下一步
                    <ArrowRight size={14} />
                  </button>
                )}
              </div>

              <div className="demo-tour-foot">
                <span>键盘 ← → 切换章节 · 点击顶部编号直达 · Esc 退出</span>
                {index === props.steps.length - 1 ? (
                  <button onClick={() => move(0)}>
                    <RotateCcw size={11} />
                    重新播放
                  </button>
                ) : (
                  <button onClick={finish}>跳过导览</button>
                )}
              </div>
            </div>
          </dialog>,
          document.body
        )}
    </>
  );
}
