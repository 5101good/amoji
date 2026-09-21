import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm';
import { AiSuggestions, conversationModel, type SuggestionLlm } from '../src/dsh/ai-suggestions.js';
const fields = { name:'谢谢你', semantics:{locale:'zh-CN',meaning:'向对方表达受到帮助后的真诚感谢',fallback:'谢谢你',tone:'真诚',use_when:['得到帮助后'],avoid_when:['讽刺他人时']},tags:['感谢'] };
const route = {provider:'configured',model:'deepseek-v4-flash'};
function fixture(chunks: StreamChunk[] = [{type:'text-delta',index:0,text:JSON.stringify(fields)},{type:'finish',reason:{kind:'stop'}}]) {
 const calls:GenerateOptions[]=[];
 const llm:SuggestionLlm={listProviders:()=>[{id:'configured',name:'Configured'}],listModels:async()=>[{provider:'configured',id:'large-model',name:'Large'},{provider:'configured',id:route.model,name:'Flash'}],resolveModelInfo:async()=>({provider:route.provider,id:route.model,name:'Flash',reasoning:{efforts:[{id:'off' as never,name:'Off'}]}}),async *stream(options){calls.push(options);yield* chunks;}};
 return {llm,calls,ai:new AiSuggestions(llm)};
}
test('真实模型接口只收到短文字，关闭可用思考、无工具和聊天历史，返回可校验语义',async()=>{
 const f=fixture(); assert.equal((await f.ai.models(new AbortController().signal)).length,2);
 const result=await f.ai.suggest('s',{intent:'谢谢你帮忙，温暖但克制',...route},new AbortController().signal);
 assert.equal(result.method,'dsh-llm-v1');assert.deepEqual(result.fields,fields);assert.match(result.notice,/Flash/);
 assert.equal(f.calls.length,1);const call=f.calls[0]!;assert.equal(call.maxTokens,1200);assert.equal(call.reasoningEffort,'off');assert.equal(call.tools,undefined);assert.equal(call.messages.length,1);assert.match(JSON.stringify(call.messages),/温暖但克制/);assert.doesNotMatch(JSON.stringify(call),/data:image|base64/);
});
test('未配置模型、非法输入、未知字段在请求前拒绝',async()=>{
 const f=fixture();const signal=new AbortController().signal;
 for(const args of [{...route,intent:''},{...route,intent:'x',image:'private'},{...route,intent:'x',model:'unknown'}])await assert.rejects(f.ai.suggest('s',args,signal));
 assert.equal(f.calls.length,0);await assert.rejects(new AiSuggestions(undefined).models(signal),/SUGGESTION_UNAVAILABLE/);
});
test('失败、截断、非法JSON、越界语义及夹带权限字段不退回模板，不自动重试',async()=>{
 for(const chunks of [
  [{type:'finish',reason:{kind:'error',failure:{code:'AUTH',message:'secret-provider-value'}}}],
  [{type:'text-delta',index:0,text:JSON.stringify(fields)},{type:'finish',reason:{kind:'max-tokens'}}],
  [{type:'text-delta',index:0,text:'not json'},{type:'finish',reason:{kind:'stop'}}],
  [{type:'text-delta',index:0,text:JSON.stringify({...fields,rights:{license:'invented'}})},{type:'finish',reason:{kind:'stop'}}],
  [{type:'text-delta',index:0,text:JSON.stringify({...fields,semantics:{...fields.semantics,meaning:'a'.repeat(241)}})},{type:'finish',reason:{kind:'stop'}}],
  [{type:'text-delta',index:0,text:JSON.stringify(fields)}],
 ] as StreamChunk[][]){const f=fixture(chunks);await assert.rejects(f.ai.suggest('s',{...route,intent:'感谢'},new AbortController().signal),e=>!String(e).includes('secret-provider-value'));assert.equal(f.calls.length,1);}
});
test('取消与超时终止生成，同会话不能并发计费，结束后允许重试',async()=>{
 const f=fixture();let seen:AbortSignal|undefined;
 f.llm.stream=async function*(options){seen=options.signal;await new Promise<void>(resolve=>options.signal!.addEventListener('abort',()=>resolve(),{once:true}));};
 const ai=new AiSuggestions(f.llm,30);const first=ai.suggest('s',{...route,intent:'感谢'},new AbortController().signal);
 await assert.rejects(ai.suggest('s',{...route,intent:'感谢'},new AbortController().signal),/SUGGESTION_BUSY/);
 await assert.rejects(first,/SUGGESTION_TIMEOUT/);assert.equal(seen?.aborted,true);
 const abort=new AbortController();const second=ai.suggest('s',{...route,intent:'感谢'},abort.signal);abort.abort();await assert.rejects(second,/SUGGESTION_CANCELLED/);
});

test('默认模型遵循当前对话：待用选择优先于旧请求，消费后使用最新请求',()=>{
 const header=(model:string)=>({type:'request/header',seq:1,data:{header:{config:{provider:'p',model}}}});
 const select={type:'model/selection',seq:2,data:{provider:'p',model:'chosen'}};
 assert.equal(conversationModel([]),null);
 assert.deepEqual(conversationModel([header('large')]),{provider:'p',model:'large'});
 assert.deepEqual(conversationModel([header('large'),select,header('large')]),{provider:'p',model:'chosen'});
 assert.deepEqual(conversationModel([select,header('chosen'),header('new')]),{provider:'p',model:'new'});
});
