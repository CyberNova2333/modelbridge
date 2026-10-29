import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
const source = await readFile(new URL('../_worker.js', import.meta.url), 'utf8');
let serial = 0;
const tick = () => new Promise(resolve => setImmediate(resolve));
const account = (id, provider = 'openai') => ({id, provider, accountId:'configured-account', apiToken:'upstream-secret/'+id, status:'active', models:[]});
const payload = {model:'openai:chat', messages:[{role:'user',content:'hello'}]};
const completion = () => Response.json({id:'done', choices:[{message:{role:'assistant',content:'OK'},finish_reason:'stop'}]});
async function harness(network, accounts = [account('one')], fakeClock = false) {
 const state = {network, calls:[], timers:[]};
 const name = '__upstreamSafety'+serial++;
 globalThis[name] = state;
 const prefix = `const test=globalThis.${name};const fetch=async(...args)=>{test.calls.push(args);return test.network(...args);};` + (fakeClock ? `const setTimeout=(fn,ms)=>{const timer={fn,ms,active:true};test.timers.push(timer);return timer;};const clearTimeout=t=>{if(t)t.active=false;};` : '');
 const module = await import('data:text/javascript;base64,'+Buffer.from(prefix+source+'\nexport {callOpenAICompatibleAPI,handleCompletions,handleEmbeddings,fetchUpstream,cloudflareModelPath};').toString('base64'));
 const config={accounts,apiKeys:[{id:'test',key:'gateway-only'}],customModelMap:{}};
 const env={ADMIN_PASSWORD:'fixture-password',KV:{},CONFIG_STORE:{idFromName:x=>x,get:()=>({fetch:async()=>Response.json(config)})}};
 return {module,env,...state,close(){delete globalThis[name];}};
}

test('HTTP 200 error envelopes are rejected and cannot reflect raw or URL-encoded credentials', async () => {
 for (const make of [secret=>({success:false,errors:[{message:secret}]}),secret=>({error:{message:secret}}),secret=>({type:'error',message:secret}),secret=>({errors:[{message:encodeURIComponent(secret)}]})]) {
  const a=account('one'), h=await harness(()=>Response.json(make(a.apiToken)),[a]);
  try {const result=await h.module.callOpenAICompatibleAPI(payload,h.env,false); assert.equal(result.success,false);assert.equal(result.status,502);assert.ok(!JSON.stringify(result).includes(a.apiToken));assert.ok(!JSON.stringify(result).includes(encodeURIComponent(a.apiToken)));assert.equal(h.calls.length,1);}finally{h.close();}
 }
});

test('successful but unusable responses and uncertain failures never cause another generation', async () => {
 for(const [response,stream] of [[()=>completion(),true],[()=>new Response('{invalid'),false],[()=>Response.json({debug:'not a completion'}),false],[()=>Response.json({error:{message:'failed'}},{status:500}),false],[()=>{throw new Error('connection lost after execution');},false]]) {
  const h=await harness(response,[account('one'),account('two'),account('three')]);
  try {const result=await h.module.callOpenAICompatibleAPI(payload,h.env,stream);assert.equal(result.success,false);assert.equal(h.calls.length,1);}finally{h.close();}
 }
});

test('explicit rate-limit rejection can fail over, with a bounded three-account budget', async () => {
 let count=0;const h=await harness(()=>++count===1?Response.json({error:{message:'limited'}},{status:429}):completion(),[account('one'),account('two')]);
 try {assert.equal((await h.module.callOpenAICompatibleAPI(payload,h.env,false)).success,true);assert.equal(h.calls.length,2);}finally{h.close();}
 const denied=await harness(()=>Response.json({error:{message:'limited'}},{status:429}),Array.from({length:8},(_,i)=>account(String(i))));
 try {assert.equal((await denied.module.callOpenAICompatibleAPI(payload,denied.env,false)).status,429);assert.equal(denied.calls.length,3);}finally{denied.close();}
});

test('Cloudflare model paths cannot escape an account or introduce a query or fragment', async () => {
 const h=await harness(()=>{throw new Error('must not call upstream');},[account('cf','cloudflare')]);
 try {
  for(const model of ['@cf/../../../../../accounts/other/ai/run/@cf/a/b','@cf/a/%2e%2e','@cf/a/%252e%252e','@cf/a/b?key=x','@cf/a/b#fragment','@cf/a/b\\..\\other','@cf/a/b/extra']) {
   const response=await h.module.handleEmbeddings(new Request('https://gateway.test/v1/embeddings',{method:'POST',body:JSON.stringify({model,input:'test'})}),h.env);
   assert.equal(response.status,400,model);
   assert.equal((await h.module.callOpenAICompatibleAPI({...payload,model},h.env,false)).status,400,model);
  }
  assert.equal(h.calls.length,0);assert.equal(h.module.cloudflareModelPath('@cf/meta/llama-3.2-3b-instruct'),'@cf/meta/llama-3.2-3b-instruct');
 } finally {h.close();}
});

test('client cancellation before headers reaches upstream and never retries', async () => {
 let signal;const h=await harness((_url,options)=>{signal=options.signal;return new Promise(()=>{});},[account('one'),account('two')],true);
 try {
  const client=new AbortController();
  const pending=h.module.handleCompletions(new Request('https://gateway.test/v1/chat/completions',{method:'POST',signal:client.signal,body:JSON.stringify(payload)}),h.env,'/v1/chat/completions');
  for(let i=0;i<5&&!signal;i++)await tick();
  client.abort();const result=await pending;assert.equal(result.status,499);assert.equal(signal.aborted,true);assert.equal(h.calls.length,1);assert.ok(h.timers.every(t=>!t.active));
 }finally{h.close();}
});

test('header timeout, body idle timeout and size limit abort the reader and clean timers', async () => {
 const headers=await harness(()=>new Promise(()=>{}),[],true);
 try {const pending=headers.module.fetchUpstream('https://upstream.test',{});await tick();headers.timers.find(t=>t.active).fn();await assert.rejects(pending,/timed out/);assert.ok(headers.timers.every(t=>!t.active));}finally{headers.close();}
 let cancelled=false,signal;
 const body=await harness((_url,options)=>{signal=options.signal;return new Response(new ReadableStream({cancel(){cancelled=true;}}));},[],true);
 try {const response=await body.module.fetchUpstream('https://upstream.test',{});const read=response.text();body.timers.find(t=>t.active).fn();await assert.rejects(read,/timed out/);assert.equal(signal.aborted,true);assert.equal(cancelled,true);assert.ok(body.timers.every(t=>!t.active));}finally{body.close();}
 const size=await harness(()=>new Response('too large'),[],true);
 try {const response=await size.module.fetchUpstream('https://upstream.test',{}, {maxResponseBytes:2});await assert.rejects(response.text(),/size limit/);assert.ok(size.timers.every(t=>!t.active));}finally{size.close();}
});

test('completed bodies and downstream cancellation release timeout resources', async () => {
 const done=await harness(()=>new Response('OK'),[],true);
 try {assert.equal(await (await done.module.fetchUpstream('https://upstream.test',{})).text(),'OK');assert.ok(done.timers.every(t=>!t.active));}finally{done.close();}
 let cancelled=false,signal;const h=await harness((_url,options)=>{signal=options.signal;return new Response(new ReadableStream({cancel(){cancelled=true;}}));},[],true);
 try {const response=await h.module.fetchUpstream('https://upstream.test',{});await response.body.cancel();assert.equal(cancelled,true);assert.equal(signal.aborted,true);assert.ok(h.timers.every(t=>!t.active));}finally{h.close();}
});
