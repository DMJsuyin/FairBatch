import {defineConfig,loadEnv} from 'vite';import react from '@vitejs/plugin-react';
import {createIntentModel,IntentError} from './scripts/intent-model.ts';
export default defineConfig(({mode})=>{
 const parseModelIntent=createIntentModel(loadEnv(mode,process.cwd(),''));
 return {plugins:[react(),{
  name:'optional-intent-model',
  configureServer(server){
    server.middlewares.use('/api/intent',async(req,res)=>{
      res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
      if(req.method!=='POST'){res.statusCode=405;res.end(JSON.stringify({error:'POST required'}));return;}
      // Dev-only endpoint. No keys reach the client; it has no wallet or execution rights.
      const origin=req.headers.origin;
      if(origin&&!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)){res.statusCode=403;res.end('{}');return;}
      try {
        let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>10000)throw new IntentError(400,'输入过长');}
        let body;try{body=JSON.parse(raw);}catch{throw new IntentError(400,'输入格式无效');}
        res.end(JSON.stringify(await parseModelIntent(body)));
      }catch(e){res.statusCode=e instanceof IntentError?e.status:500;res.end(JSON.stringify({error:e instanceof IntentError?e.message:'AI 解析暂时失败'}));}
    });
  }
 }],server:{host:'127.0.0.1',port:5177,strictPort:true,proxy:{'/api/fairbatch':{target:'http://127.0.0.1:5197',changeOrigin:true},'/api/demo/fund':{target:'http://127.0.0.1:5197',changeOrigin:true},'/api/demo/arena':{target:'http://127.0.0.1:5197',changeOrigin:true},'/deployment.json':{target:'http://127.0.0.1:5197',changeOrigin:true},'/fairbatch.json':{target:'http://127.0.0.1:5197',changeOrigin:true},'/health':{target:'http://127.0.0.1:5197',changeOrigin:true},'/rpc':{target:'http://127.0.0.1:5197',changeOrigin:true}}},build:{target:'es2022',rollupOptions:{output:{manualChunks(id){if(id.includes('node_modules/viem')||id.includes('node_modules/@noble')||id.includes('node_modules/ox'))return 'vendor-viem';if(id.includes('node_modules/react')||id.includes('node_modules/lucide-react'))return 'vendor-ui';}}}}};
});
