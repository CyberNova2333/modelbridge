import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
const source = await readFile(new URL('../_worker.js', import.meta.url), 'utf8');
const methods = ['geminiToOpenAIRequest', 'openAIToGeminiRequest', 'geminiToOpenAIResponse', 'openAIToGeminiResponse', 'geminiToOpenAIStream', 'openAIToGeminiStream'];
const api = await import('data:text/javascript;base64,' + Buffer.from(source + '\nexport {' + methods.join(',') + '};').toString('base64'));
const encoder = new TextEncoder();
function stream(frames, { bytes = false, cancel } = {}) {
 const encoded = encoder.encode(frames.map(x => typeof x === 'string' ? x : 'data: ' + JSON.stringify(x) + '\r\n\r\n').join(''));
 let index = 0;
 return new ReadableStream({ pull(c) { if(index >= encoded.length) { c.close(); return; } const end = bytes ? index + 1 : encoded.length; c.enqueue(encoded.slice(index, end)); index = end; }, cancel });
}
const parse = text => text.split('\n').filter(x => x.startsWith('data: ') && x !== 'data: [DONE]').map(x => JSON.parse(x.slice(6)));
const choice = (delta, finish_reason = null, index = 0) => ({ id: 'chatcmpl-test', choices: [{index, delta, finish_reason}] });

test('Gemini multi-turn tools, system instruction and media retain identity and signatures', () => {
 const body = {
  systemInstruction: { parts: [{text: 'Be precise.'}] },
  contents: [
   {role: 'user', parts: [{text: 'Weather?'}, {inlineData:{mimeType:'image/png',data:'AAAA'}}, {fileData:{mimeType:'image/webp',fileUri:'https://example.org/image.webp'}}]},
   {role: 'model', parts: [{text:'Thinking', thought:true}, {functionCall:{id:'first',name:'weather',args:{city:'Paris'}},thoughtSignature:'opaque-first'}, {functionCall:{id:'second',name:'weather',args:{city:'London'}},thoughtSignature:'opaque-second'}]},
   {role: 'user', parts: [{functionResponse:{id:'second',name:'weather',response:{temperature:12}}}, {functionResponse:{id:'first',name:'weather',response:{temperature:18}}}]},
  ],
  generationConfig: {temperature:0.4,topP:0.8,topK:20,maxOutputTokens:90,stopSequences:['END'],candidateCount:2,thinkingConfig:{includeThoughts:true,thinkingBudget:64},responseMimeType:'application/json',responseJsonSchema:{type:'object',properties:{ok:{type:'boolean'}}}},
  tools: [{functionDeclarations:[{name:'weather',description:'Look up weather',parametersJsonSchema:{type:'object',properties:{city:{type:'string'}},required:['city']}}]}],
  toolConfig: {functionCallingConfig:{mode:'ANY',allowedFunctionNames:['weather']}},
  safetySettings:[{category:'HARM_CATEGORY_HARASSMENT',threshold:'BLOCK_ONLY_HIGH'}],
 };
 const o = api.geminiToOpenAIRequest(body,'gemini:test');
 assert.equal(o.messages[0].role,'system');
 assert.deepEqual(o.messages.filter(m=>m.role==='tool').map(m=>m.tool_call_id), ['second','first']);
 assert.equal(o.messages[2].tool_calls[0].gemini_thought_signature,'opaque-first');
 assert.equal(o.messages[1].content[1].image_url.url,'data:image/png;base64,AAAA');
 assert.equal(o.max_tokens,90);assert.equal(o.top_k,20);assert.equal(o.tool_choice.function.name,'weather');
 const g=api.openAIToGeminiRequest(o);
 assert.deepEqual(g.contents,body.contents);
 assert.deepEqual(g.generationConfig,body.generationConfig);
 assert.deepEqual(g.safetySettings,body.safetySettings);
 assert.deepEqual(g.systemInstruction,body.systemInstruction);
 assert.equal(g.tools[0].functionDeclarations[0].parametersJsonSchema.required[0],'city');
});

test('OpenAI messages become Gemini function results, media, declarations and constrained choices', () => {
 const request = {model:'gemini:test',messages:[{role:'developer',content:'System.'},{role:'user',content:[{type:'text',text:'Picture'},{type:'image_url',image_url:{url:'data:image/jpeg;base64,BBBB'}}]},{role:'assistant',content:null,tool_calls:[{id:'a',type:'function',function:{name:'search',arguments:'{"query":"hello"}'}}]},{role:'tool',tool_call_id:'a',content:'found'}],tools:[{type:'function',function:{name:'search',parameters:{type:'object'}}}],tool_choice:'required',max_completion_tokens:20,stop:'STOP'};
 const result=api.openAIToGeminiRequest(request);
 assert.equal(result.systemInstruction.parts[0].text,'System.');
 assert.equal(result.contents[1].parts[0].functionCall.args.query,'hello');
 assert.deepEqual(result.contents[2].parts[0].functionResponse,{name:'search',id:'a',response:{result:'found'}});
 assert.equal(result.contents[0].parts[1].inlineData.mimeType,'image/jpeg');
 assert.equal(result.toolConfig.functionCallingConfig.mode,'ANY');
 assert.equal(result.generationConfig.maxOutputTokens,20);
 assert.deepEqual(result.generationConfig.stopSequences,['STOP']);
});

test('Non-streaming conversion preserves tool arguments, thought signatures, usage and stop conditions', () => {
 const original={responseId:'response-id',modelVersion:'gemini-version',candidates:[{index:0,content:{role:'model',parts:[{text:'Let me think.',thought:true},{text:'Done'},{functionCall:{id:'c1',name:'calc',args:{x:2}},thoughtSignature:'opaque'}]},finishReason:'STOP',safetyRatings:[]}],usageMetadata:{promptTokenCount:10,candidatesTokenCount:4,thoughtsTokenCount:3,totalTokenCount:17,cachedContentTokenCount:5}};
 const o=api.geminiToOpenAIResponse(original,'public-alias');assert.equal(o.id,'response-id');assert.equal(o.choices[0].finish_reason,'tool_calls');assert.equal(o.choices[0].message.content,'Done');assert.equal(o.choices[0].message.reasoning_content,'Let me think.');assert.equal(o.usage.completion_tokens,7);assert.equal(o.usage.completion_tokens_details.reasoning_tokens,3);
 const g=api.openAIToGeminiResponse(o,'public-alias');assert.deepEqual(g.candidates,original.candidates);assert.deepEqual(g.usageMetadata,original.usageMetadata);assert.equal(g.modelVersion,'gemini-version');
 assert.equal(api.geminiToOpenAIResponse({candidates:[{finishReason:'MAX_TOKENS'}]},'m').choices[0].finish_reason,'length');
 assert.equal(api.openAIToGeminiResponse({choices:[{message:{content:'partial'},finish_reason:'length'}]},'m').candidates[0].finishReason,'MAX_TOKENS');
 const blocked=api.geminiToOpenAIResponse({promptFeedback:{blockReason:'SAFETY'}},'m');assert.equal(blocked.choices[0].finish_reason,'content_filter');assert.equal(api.openAIToGeminiResponse(blocked,'m').promptFeedback.blockReason,'SAFETY');
});

test('Gemini SSE converts byte-fragmented UTF8, tool ids and final usage to OpenAI SSE', async () => {
 const upstream=stream([{responseId:'r',candidates:[{index:0,content:{parts:[{text:'你好'}]}}]},{candidates:[{index:0,content:{parts:[{functionCall:{id:'a',name:'calc',args:{x:1}},thoughtSignature:'sig'}]},finishReason:'STOP'}]},{usageMetadata:{promptTokenCount:3,candidatesTokenCount:4,totalTokenCount:7}}],{bytes:true});
 const text=await new Response(api.geminiToOpenAIStream(upstream,'alias')).text();const events=parse(text);
 assert.equal(events[0].choices[0].delta.content,'你好');assert.equal(events[1].choices[0].delta.tool_calls[0].id,'a');assert.equal(events[1].choices[0].delta.tool_calls[0].gemini_thought_signature,'sig');assert.equal(events[1].choices[0].finish_reason,'tool_calls');assert.equal(events[2].usage.total_tokens,7);assert.deepEqual(events[2].choices,[]);assert.equal((text.match(/data: \[DONE\]/g)||[]).length,1);
});

test('OpenAI SSE accumulates interleaved tool JSON by index and emits Gemini SSE or JSON array', async () => {
 const frames=[choice({content:'你好'}),choice({tool_calls:[{index:0,id:'a',type:'function',function:{name:'weather',arguments:'{"city":'}},{index:1,id:'b',type:'function',function:{name:'search',arguments:'{"query":'}}]}),choice({tool_calls:[{index:1,function:{arguments:'"news"}'}},{index:0,function:{arguments:'"Paris"}'}}]}),choice({},'tool_calls'),{choices:[],usage:{prompt_tokens:9,completion_tokens:5,total_tokens:14}},'data: [DONE]\n\n'];
 for(const sse of [true,false]){
  const text=await new Response(api.openAIToGeminiStream(stream(frames,{bytes:true}),'alias',{sse})).text();const events=sse?parse(text):JSON.parse(text);
  assert.equal(events[0].candidates[0].content.parts[0].text,'你好');const final=events.find(e=>e.candidates?.[0].finishReason);assert.deepEqual(final.candidates[0].content.parts.map(p=>p.functionCall.args),[{city:'Paris'},{query:'news'}]);assert.deepEqual(final.candidates[0].content.parts.map(p=>p.functionCall.id),['a','b']);assert.equal(events.at(-1).usageMetadata.totalTokenCount,14);
 }
});

test('Truncated streamed tool JSON reports MAX_TOKENS and never emits an executable function', async () => {
 const events=parse(await new Response(api.openAIToGeminiStream(stream([choice({tool_calls:[{index:0,id:'a',function:{name:'calc',arguments:'{"x":'}}]}),choice({},'length'),'data: [DONE]\n\n']),'alias')).text());
 assert.equal(events.at(-1).candidates[0].finishReason,'MAX_TOKENS');assert.equal(events.at(-1).candidates[0].content.parts.length,0);
});

test('Malformed or unsupported tools and content fail explicitly', async () => {
 assert.throws(()=>api.geminiToOpenAIRequest({contents:[]},'m'),/non-empty/);
 assert.throws(()=>api.geminiToOpenAIRequest({contents:[{role:'user',parts:[{text:'x'}]}],tools:[{googleSearch:{}}]},'m'),/functionDeclarations/);
 assert.throws(()=>api.openAIToGeminiRequest({messages:[{role:'tool',tool_call_id:'missing',content:'{}'}]}),/matching tool name/);
 assert.throws(()=>api.openAIToGeminiResponse({choices:[{message:{tool_calls:[{id:'t',function:{name:'bad',arguments:'{broken'}}]}}]},'m'),/valid JSON/);
 const failed=await new Response(api.geminiToOpenAIStream(stream(['data: broken\n\n']),'m')).text();
 assert.equal(parse(failed)[0].error.type,'upstream_error');assert.equal(failed.includes('[DONE]'),false);
});

test('SSE adapters propagate downstream cancellation and flush a final unterminated frame', async () => {
 let canceled=false;
 const source=new ReadableStream({start(controller){controller.enqueue(encoder.encode('data: '+JSON.stringify(choice({content:'hello'}))+'\n\n'));},cancel(){canceled=true;}});
 const reader=api.openAIToGeminiStream(source,'alias').getReader();await reader.read();await reader.cancel('stop');assert.equal(canceled,true);
 const text='data: '+JSON.stringify({candidates:[{content:{parts:[{text:'尾'}]},finishReason:'STOP'}]});
 const result=parse(await new Response(api.geminiToOpenAIStream(stream([text],{bytes:true}),'alias')).text());assert.equal(result[0].choices[0].delta.content,'尾');assert.equal(result[0].choices[0].finish_reason,'stop');
});

test('Gemini schemas normalize uppercase types without losing properties named type', () => {
 const body={contents:[{role:'user',parts:[{text:'x'}]}],generationConfig:{responseMimeType:'application/json',responseSchema:{type:'OBJECT',properties:{kind:{type:'STRING'}}}},tools:[{functionDeclarations:[{name:'f',parameters:{type:'OBJECT',properties:{x:{type:'ARRAY',items:{type:'INTEGER'}}}}}]}]};
 const o=api.geminiToOpenAIRequest(body,'m');assert.equal(o.tools[0].function.parameters.type,'object');assert.equal(o.tools[0].function.parameters.properties.x.items.type,'integer');assert.equal(o.response_format.json_schema.schema.properties.kind.type,'string');
 const g=api.openAIToGeminiRequest(o);assert.equal(g.generationConfig.responseSchema,undefined);assert.equal(g.generationConfig.responseJsonSchema.type,'object');
});

test('Gemini SSE round-trip retains raw thought signatures and a stable response id', async () => {
 const original=[{responseId:'stable-id',candidates:[{index:0,content:{parts:[{text:'reason',thought:true,thoughtSignature:'opaque-text-signature'}]}}]},{candidates:[{index:0,content:{parts:[{functionCall:{id:'a',name:'f',args:{x:1}},thoughtSignature:'opaque-function-signature'}]},finishReason:'STOP'}]}];
 const oStream=api.geminiToOpenAIStream(stream(original),'m');const tee=oStream.tee();const oa=parse(await new Response(tee[0]).text());assert.ok(oa.every(e=>e.id==='stable-id'));
 const roundTrip=parse(await new Response(api.openAIToGeminiStream(tee[1],'m')).text());assert.deepEqual(roundTrip[0].candidates[0].content.parts,original[0].candidates[0].content.parts);assert.deepEqual(roundTrip[1].candidates[0].content.parts,original[1].candidates[0].content.parts);
});

test('Text streaming produces output before upstream closure', async () => {
 let upstreamController;
 const upstream=new ReadableStream({start(c){upstreamController=c;c.enqueue(encoder.encode('data: '+JSON.stringify(choice({content:'early'}))+'\n\n'));}});
 const reader=api.openAIToGeminiStream(upstream,'m').getReader();
 const value=await Promise.race([reader.read(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Text was buffered until stream end')),500))]);
 assert.equal(parse(new TextDecoder().decode(value.value))[0].candidates[0].content.parts[0].text,'early');upstreamController.close();await reader.cancel();
});
