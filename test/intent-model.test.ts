import test from 'node:test';
import assert from 'node:assert/strict';
import {createIntentModel} from '../scripts/intent-model.ts';
import {defaultIntent,allocateGrid} from '../src/grid.ts';

const env={LLM_BASE_URL:'https://model.example/v1/',LLM_MODEL:'deepseek-flash',LLM_API_KEY:'test-only-secret'};
const input={text:'十层，上下各六个百分点，偏多，买入八百 USDC，库存两百 MON',defaults:defaultIntent};
const expected={levels:10,rangeBps:600,budgetQuote:800,baseInventory:200,bias:'bullish'};
const completion=(content:unknown,finish_reason='stop')=>Response.json({choices:[{finish_reason,message:{content:typeof content==='string'?content:JSON.stringify(content)}}]});
const fails=(status:number)=>(e:any)=>e.status===status&&!e.message.includes(env.LLM_API_KEY);

test('real model route returns validated preview inputs and server-only authentication',async()=>{
 const parse=createIntentModel(env,{fetch:async(url,init)=>{
  assert.equal(url,'https://model.example/v1/chat/completions');
  assert.equal((init?.headers as Record<string,string>).Authorization,`Bearer ${env.LLM_API_KEY}`);
  const body=JSON.parse(String(init?.body));assert.equal(body.model,'deepseek-flash');
  assert.deepEqual(body.thinking,{type:'disabled'});assert.equal(body.response_format.type,'json_object');
  assert.equal(body.messages[1].content,input.text);assert.equal(init?.redirect,'error');
  return completion({...expected,privateKey:'must not pass through',transaction:'must not execute'});
 }});
 const result=await parse(input);assert.deepEqual(result,{intent:expected,source:'LLM · deepseek-flash'});
 const preview=allocateGrid(result.intent,100n);assert.equal(preview.orders.length,10);
 assert.ok(preview.quoteRequired<=800n*10n**6n);assert.ok(preview.baseRequired<=200n*10n**18n);
 assert.ok(!JSON.stringify(result).includes('privateKey'));
});

test('invalid requests never reach model, missing config is explicit',async()=>{
 let calls=0;const parse=createIntentModel(env,{fetch:async()=>{calls++;return completion(expected);}});
 for(const data of [null,{}, {...input,text:''},{...input,text:'x'.repeat(2001)},{...input,defaults:{...defaultIntent,levels:99}}]) await assert.rejects(parse(data),fails(400));
 assert.equal(calls,0);await assert.rejects(createIntentModel({})(input),fails(503));
});

test('malformed, truncated, rejected and out-of-range responses cannot become orders',async()=>{
 for(const [response,status] of [
  [completion('not JSON'),502],[completion(expected,'length'),502],[completion(''),502],
  [completion({error:'unsupported intent'}),422],[completion({...expected,budgetQuote:-1}),422],
  [completion({...expected,levels:'10'}),422],[completion({...expected,bias:'moon'}),422],
  [new Response('provider detail '+env.LLM_API_KEY,{status:401}),502],
 ] as const) await assert.rejects(createIntentModel(env,{fetch:async()=>response})(input),fails(status));
 await assert.rejects(createIntentModel(env,{fetch:async()=>{throw Error(env.LLM_API_KEY);}})(input),fails(502));
});

test('timeout releases concurrency slot and simultaneous excess is rejected',async()=>{
 let calls=0;const parse=createIntentModel(env,{maxConcurrent:1,timeoutMs:20,fetch:async(_url,init)=>{
  if(++calls===1)return await new Promise<Response>((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));
  return completion(expected);
 }});
 const first=assert.rejects(parse(input),fails(504));
 await assert.rejects(parse(input),fails(429));await first;
 assert.deepEqual((await parse(input)).intent,expected);assert.equal(calls,2);
});
