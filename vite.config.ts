import {defineConfig,loadEnv} from 'vite';import react from '@vitejs/plugin-react';
import {validateIntent} from './src/grid.ts';
export default defineConfig(({mode})=>{
 const env=loadEnv(mode,process.cwd(),'');
 return {plugins:[react(),{
  name:'optional-intent-model',
  configureServer(server){
    server.middlewares.use('/api/intent',async(req,res)=>{
      res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
      if(req.method!=='POST'){res.statusCode=405;res.end(JSON.stringify({error:'POST required'}));return;}
      // Dev-only endpoint. No keys reach the client; it has no wallet or execution rights.
      const origin=req.headers.origin;
      if(origin&&!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)){res.statusCode=403;res.end('{}');return;}
      if(!env.LLM_BASE_URL||!env.LLM_MODEL){res.statusCode=503;res.end(JSON.stringify({error:'模型未配置。可使用标明来源的规则解析，或编辑网格参数。'}));return;}
      try {
        let body='';for await(const chunk of req){body+=chunk;if(body.length>6000)throw new Error('输入过长');}
        const {text,defaults}=JSON.parse(body);
        if(typeof text!=='string'||text.length>2000)throw new Error('输入无效');
        const fallback=validateIntent(defaults);
        const response=await fetch(`${env.LLM_BASE_URL.replace(/\/$/,'')}/chat/completions`,{method:'POST',headers:{'Content-Type':'application/json',...(env.LLM_API_KEY?{Authorization:`Bearer ${env.LLM_API_KEY}`}:{})},signal:AbortSignal.timeout(30000),body:JSON.stringify({model:env.LLM_MODEL,temperature:0,response_format:{type:'json_object'},messages:[{role:'system',content:`Translate the user's trading intent to JSON only. Keys: levels (integer 2-16), rangeBps (integer 100-3000), budgetQuote (USDC buy budget), baseInventory (MON available to sell), bias (neutral|bullish|bearish). Never give profit forecasts or invent available funds. Omitted fields default to ${JSON.stringify(fallback)}. Reject non-grid requests with {"error":"unsupported intent"}.`},{role:'user',content:text}]})});
        if(!response.ok)throw new Error(`模型服务返回 ${response.status}`);
        const result=await response.json() as any;
        const intent=validateIntent(JSON.parse(result.choices[0].message.content));
        res.end(JSON.stringify({intent,source:`LLM · ${env.LLM_MODEL}`}));
      }catch(error){res.statusCode=400;res.end(JSON.stringify({error:error instanceof Error?error.message:'解析失败'}));}
    });
  }
 }],server:{host:'127.0.0.1',port:5177,strictPort:true,proxy:{'/api/fairbatch':{target:'http://127.0.0.1:5197',changeOrigin:true},'/api/demo/fund':{target:'http://127.0.0.1:5197',changeOrigin:true},'/rpc':{target:'http://127.0.0.1:5197',changeOrigin:true}}},build:{target:'es2022'}};
});
