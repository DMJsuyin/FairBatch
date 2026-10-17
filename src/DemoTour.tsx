import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {ArrowLeft,ArrowRight,Check,ChevronRight,CircleHelp,Lightbulb,RotateCcw,X} from 'lucide-react';
import {tourLayout,type Rect} from './tourLayout';
import type {TourStep} from './tourSteps';
import './tour.css';

type Props={
  name:string;
  steps:TourStep[];
  dark?:boolean;
  onStart?:()=>void;
  onStep?:(step:TourStep)=>void;
  onFinish?:()=>void;
  nextTour:{href:string;label:string};
};

export default function DemoTour(props:Props){
  const [index,setIndex]=useState<number|null>(null);
  const [rect,setRect]=useState<Rect|null>(null);
  const [viewport,setViewport]=useState({width:window.innerWidth,height:window.innerHeight});
  const [cardHeight,setCardHeight]=useState(340);
  const dialog=useRef<HTMLDialogElement>(null),card=useRef<HTMLDivElement>(null);
  const origin=useRef({x:0,y:0,focus:null as HTMLElement|null});
  const callbacks=useRef(props);callbacks.current=props;
  const autoStarted=useRef(false);
  const active=index!==null,step=active?props.steps[index]:null;
  const layout=tourLayout(rect,viewport,cardHeight);

  function start(){
    origin.current={x:window.scrollX,y:window.scrollY,focus:document.activeElement as HTMLElement};
    callbacks.current.onStart?.();
    setRect(null);setIndex(0);
    callbacks.current.onStep?.(callbacks.current.steps[0]);
  }
  function move(next:number){
    if(next<0||next>=callbacks.current.steps.length)return;
    setRect(null);setIndex(next);
    callbacks.current.onStep?.(callbacks.current.steps[next]);
  }
  function finish(){setIndex(null);callbacks.current.onFinish?.();}

  useEffect(()=>{
    const url=new URL(window.location.href);
    if(url.searchParams.get('tour')==='1'&&!autoStarted.current){
      autoStarted.current=true;url.searchParams.delete('tour');
      window.history.replaceState(window.history.state,'',url);
      start();
    }
  },[]);

  useEffect(()=>{
    if(!active)return;
    const node=dialog.current!,previousOverflow=document.body.style.overflow;
    node.showModal();document.body.style.overflow='hidden';
    return()=>{
      node.close();document.body.style.overflow=previousOverflow;
      const saved=origin.current;
      requestAnimationFrame(()=>{
        if(saved.focus?.isConnected)saved.focus.focus({preventScroll:true});
        window.scrollTo({left:saved.x,top:saved.y,behavior:'instant'});
      });
    };
  },[active]);

  useEffect(()=>{
    if(!step)return;
    let frame=0,disposed=false;
    const target=()=>document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
    const measure=()=>{
      if(disposed)return;
      const element=target(),r=element?.getBoundingClientRect();
      setRect(r&&r.width&&r.height?{left:r.left,top:r.top,width:r.width,height:r.height}:null);
      setViewport({width:window.innerWidth,height:window.innerHeight});
      if(card.current)setCardHeight(card.current.getBoundingClientRect().height);
    };
    const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(measure);};
    const position=()=>{
      const element=target();
      if(element){
        const r=element.getBoundingClientRect(),mobile=window.innerWidth<720;
        const available=window.innerHeight-(mobile?(card.current?.offsetHeight||340)+48:80);
        const offset=mobile||r.height>available?24:Math.max(24,(window.innerHeight-r.height)/2);
        window.scrollTo({top:Math.max(0,window.scrollY+r.top-offset),behavior:'instant'});
      }
      measure();
    };
    // Wait for the host's tab change to commit before resolving its target.
    frame=requestAnimationFrame(()=>{position();card.current?.focus({preventScroll:true});});
    const observer=new ResizeObserver(schedule);
    if(card.current)observer.observe(card.current);
    if(target())observer.observe(target()!);
    window.addEventListener('resize',position);
    window.addEventListener('scroll',schedule,true);
    return()=>{disposed=true;cancelAnimationFrame(frame);observer.disconnect();window.removeEventListener('resize',position);window.removeEventListener('scroll',schedule,true);};
  },[step]);

  return <>
    <button className={`demo-tour-trigger${props.dark?' is-dark':''}`} onClick={start} aria-haspopup="dialog"><CircleHelp size={16}/><span>演示导览</span><ChevronRight size={13}/></button>
    {active&&step&&createPortal(<dialog ref={dialog} className={`demo-tour${props.dark?' is-dark':''}`} aria-label={`${props.name}演示导览`} aria-describedby="demo-tour-description" onCancel={e=>{e.preventDefault();finish();}} onKeyDown={e=>{
      if(e.key==='ArrowRight'){e.preventDefault();move(index+1);}
      if(e.key==='ArrowLeft'){e.preventDefault();move(index-1);}
    }}>
      <svg className="demo-tour-shade" width={viewport.width} height={viewport.height} aria-hidden="true">
        <defs><mask id="demo-tour-cutout"><rect width="100%" height="100%" fill="white"/>{layout.spot&&<rect {...{x:layout.spot.left,y:layout.spot.top,width:layout.spot.width,height:layout.spot.height}} rx="12" fill="black"/>}</mask></defs>
        <rect width="100%" height="100%" fill="#080d1c" fillOpacity=".66" mask="url(#demo-tour-cutout)"/>
      </svg>
      {layout.spot&&<div className="demo-tour-spot" aria-hidden="true" style={layout.spot}><span>{String(index+1).padStart(2,'0')}</span></div>}
      <div ref={card} className="demo-tour-card" tabIndex={-1} style={{left:layout.card.left,top:layout.card.top,width:layout.card.width}}>
        <div className="demo-tour-top"><span><CircleHelp size={14}/>{props.name} · 演示导览</span><button className="demo-tour-close" aria-label="跳过导览" title="跳过导览 · Esc" onClick={finish}><X size={17}/></button></div>
        <div className="demo-tour-progress" aria-label={`第 ${index+1} 步，共 ${props.steps.length} 步`}>{props.steps.map((s,i)=><span key={s.id} className={i<=index?'visited':''}/>)}</div>
        <div className="demo-tour-copy" aria-live="polite" aria-atomic="true">
          <div className="demo-tour-chapter"><span>{String(index+1).padStart(2,'0')}</span>{step.chapter}</div>
          <h2>{step.title}</h2><p id="demo-tour-description">{step.description}</p>
          <div className="demo-tour-cue"><Lightbulb size={16}/><p>{step.cue}</p></div>
          {!rect&&<p className="demo-tour-unavailable">此区域暂未显示，仍可继续阅读或进入下一步。</p>}
          {index===props.steps.length-1&&<a className="demo-tour-next-route" href={props.nextTour.href}>{props.nextTour.label}<ArrowRight size={14}/></a>}
        </div>
        <div className="demo-tour-actions"><button className="demo-tour-back" disabled={index===0} onClick={()=>move(index-1)}><ArrowLeft size={14}/>上一步</button><span>{index+1} / {props.steps.length}</span>{index===props.steps.length-1?<button className="demo-tour-primary" onClick={finish}>完成导览<Check size={15}/></button>:<button className="demo-tour-primary" onClick={()=>move(index+1)}>下一步<ArrowRight size={15}/></button>}</div>
        <div className="demo-tour-foot"><span>← → 切换步骤 · Esc 退出</span>{index===props.steps.length-1?<button onClick={()=>move(0)}><RotateCcw size={11}/>重新播放</button>:<button onClick={finish}>跳过导览</button>}</div>
      </div>
    </dialog>,document.body)}
  </>;
}
