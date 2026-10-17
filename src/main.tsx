import React,{lazy,Suspense} from 'react';import{createRoot}from'react-dom/client';import App from'./App';import './style.css';
const FairBatch=lazy(()=>import('./fairbatch/App'));
createRoot(document.getElementById('root')!).render(<React.StrictMode>{location.pathname.startsWith('/fairbatch')?<Suspense fallback={<div style={{padding:40,color:'#bba5ef',background:'#090e17',minHeight:'100vh'}}>FairBatch · 正在连接交易市场…</div>}><FairBatch/></Suspense>:<App/>}</React.StrictMode>);
