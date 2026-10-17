import React,{lazy,Suspense} from 'react';import{createRoot}from'react-dom/client';import App from'./App';import './style.css';
const FairBatch=lazy(()=>import('./fairbatch/App'));
createRoot(document.getElementById('root')!).render(<React.StrictMode>{location.pathname.startsWith('/fairbatch')?<Suspense fallback={<div style={{padding:'32px 24px',color:'#c9a254',background:'#0b0e13',minHeight:'100vh',fontFamily:'ui-monospace, SFMono-Regular, Menlo, monospace',fontSize:12,letterSpacing:'0.06em'}}>FAIRBATCH // 正在同步链上密封竞价市场…</div>}><FairBatch/></Suspense>:<App/>}</React.StrictMode>);
