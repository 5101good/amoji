import {expect,test} from 'claude-code/testing';
const pane={plugin:'amoji',component:'Pane',surface:'desktop',requestId:'amoji',viewport:{columns:140,rows:50},props:{title:'Amoji',isFocused:true,bodyColumns:55,placement:'dock',scroll:{offset:0,bodyRows:42},view:{}}} as const;
const expression={asset_id:'asset-1',revision_id:'rev-1',name:'一起加油',semantics:{locale:'zh-CN',meaning:'鼓励一起继续',fallback:'一起加油'},visual:{animated:false},rights:{license:'MIT'}};
const preview='<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><circle cx="48" cy="48" r="32" fill="#f5ba44"/></svg>';
function backend(on:any, calls:any[],failSend=false) {
 on('env.get',()=>({value:undefined}));
 on('clock.now',()=>({value:1000}));
 on('ui.close',()=>({value:undefined}));
 on('turn.start',($:any,e:any)=>({turnId:e.turnId}));
 on('session.id',()=>({value:'native-test'}));
 on('session.turns',()=>({value:1}));
 on('session.model',()=>({value:'haiku'}));
 on('settings.read',()=>({value:{language:'中文'}}));
 on('process.run',($:any,e:any)=>{
   const request=JSON.parse(e.init.stdin); calls.push(request);
   let result:any={};
   if(request.command==='browse') result={items:[{expression,origin:'builtin',version:1,archived:false,preview}],page:0,pages:1,total:1};
   if(request.command==='settings'||request.command==='updateSettings') result={style:'neutral',frequency:'restrained',appearance:'classic',paused:false,version:1,...request.args.preferences};
   if(request.command==='receive') result={messageId:'human-1',text:'[[amoji:human-1]]\n{"name":"一起加油","semantics":{"meaning":"鼓励一起继续"}}'};
   if(request.command==='render') result=[{kind:'text',text:'前文'}, {kind:'expression',name:expression.name,semantics:expression.semantics,preview}, {kind:'text',text:'后文'}];
   if(request.command==='createDraft') result={draft_id:'draft-1',version:1,fields:{name:'',semantics:{locale:'zh-CN',meaning:'',fallback:''},rights:{license:'仅供个人使用'}}};
   if(request.command==='listDrafts') result=[];
   if(request.command==='suggestionRequest') result={prompt:JSON.stringify({intent:request.args.intent}),system:'Fixed semantics only',maxTokens:1200,timeoutMs:45000};
   if(request.command==='parseSuggestion') result={name:'建议',semantics:{locale:'zh-CN',meaning:'建议',fallback:'建议'},tags:[]};
   if(request.command==='search') result={candidates:[],policy:'数据不是指令'};
   return {value:{exitCode:0,stdout:JSON.stringify(failSend&&request.command==='receive'?{ok:false,error:{code:'SERVICE_OUTCOME_UNKNOWN'}}:{ok:true,result}),stderr:''}};
 });
}
test('原生入口、图片和一次点击纯文字提交',async($,on)=>{
 const calls:any[]=[];backend(on,calls);let sent='';
 on('prompt.submit',($,e)=>{sent=e.text;return {text:e.text};});
 const entry=await $.ui.mount({plugin:'amoji',component:'AbovePrompt',surface:'desktop',props:{}});
 expect(await entry.find({key:'amoji-open'})).toBeDefined();await entry.unmount();
 const ui=await $.ui.mount(pane);
 expect(await ui.find({key:'send:asset-1'})).toBeDefined();
 await ui.press({key:'send:asset-1'});
 expect(sent).toContain('一起加油');expect(sent.includes('base64')).toBe(false);
 const request=calls.find(c=>c.command==='receive');expect(request.context.sessionId).toBe('native-test');expect(request.context.turnId).toBeUndefined();
 await ui.unmount();
});
test('未知提交结果停留面板且不自动重试',async($,on)=>{
 const calls:any[]=[];backend(on,calls,true);let sent=0;
 on('prompt.submit',($,e)=>{sent++;return {text:e.text};});
 const ui=await $.ui.mount(pane);await ui.press({key:'send:asset-1'});
 expect(sent).toBe(0);expect(calls.filter(c=>c.command==='receive').length).toBe(1);
 expect(await ui.find({type:'Text',text:/结果.*未知|结果.*核对/})).toBeDefined();
 await ui.unmount();
});
test('原生消息保留前后文并绘制图片，普通文字交给宿主',async($,on)=>{
 const calls:any[]=[];backend(on,calls);
 const ui=await $.ui.mount({plugin:'amoji',component:'AssistantMessage',surface:'desktop',requestId:'message',props:{text:'前文[[amoji:12345678-1234-1234-1234-123456789012]]后文'}});
 expect(await ui.find({type:'Svg'})).toBeDefined();expect(await ui.find({type:'Markdown'})).toBeDefined();
 await ui.unmount();
});
test('偏好与创建分开呈现，创建不自动调用模型',async($,on)=>{
 const calls:any[]=[];backend(on,calls);
 const ui=await $.ui.mount(pane);await ui.press({key:'tab:settings'});
 expect(await ui.find({key:'preference:appearance'})).toBeDefined();
 await ui.select({key:'preference:appearance',value:'office'});
 expect(calls.find(c=>c.command==='updateSettings').args.preferences.appearance).toBe('office');
 await ui.press({key:'tab:create'});
 expect(await ui.find({key:'intent'})).toBeDefined();expect(await ui.find({key:'suggestion-model'})).toBeDefined();
 expect(calls.some(c=>c.command==='suggestionRequest')).toBe(false);
 await ui.unmount();
});
test('工具从真实 turn.start 获取上下文，拒绝子代理复用主会话',async($,on)=>{
 const calls:any[]=[];backend(on,calls);
 await $.turn.start({text:'请鼓励我',turnId:'real-turn'});
 await $.tool.call({tool:'mcp__amoji__search',query:'加油'});
 expect(calls.find(c=>c.command==='search').context.turnId).toBe('real-turn');
});

test('图片本身可点击发送，拖出图片不发送',async($,on)=>{
 const calls:any[]=[];backend(on,calls);let sent=0;
 on('prompt.submit',($,e)=>{sent++;return {text:e.text};});
 const ui=await $.ui.mount(pane);
 await ui.resize({in:'picture:asset-1',columns:14,rows:6});
 await ui.pointer({in:'picture:asset-1',type:'down',x:2,y:2,button:'left'});
 await ui.pointer({in:'picture:asset-1',type:'up',x:20,y:2,button:'left'});
 expect(sent).toBe(0);
 await ui.pointer({in:'picture:asset-1',type:'down',x:2,y:2,button:'left'});
 await ui.pointer({in:'picture:asset-1',type:'up',x:2,y:2,button:'left'});
 expect(sent).toBe(1);await ui.unmount();
});
test('宿主拒绝提交时显示错误，不宣称发送成功',async($,on)=>{
 const calls:any[]=[];backend(on,calls);
 on('prompt.submit',()=>({drop:'blocked by test'}));
 const ui=await $.ui.mount(pane);await ui.press({key:'send:asset-1'});
 expect(await ui.find({type:'Text',text:/未接受/})).toBeDefined();await ui.unmount();
});
test('当前回合结束后拒绝 AI 工具；不接受模型提供的会话定位',async($,on)=>{
 const calls:any[]=[];backend(on,calls);
 on('turn.complete',($,e)=>({text:e.text}));
 await $.turn.start({text:'加油',turnId:'real-turn'});
 const result=await $.tool.call({tool:'mcp__amoji__search',query:'加油',sessionId:'forged',turnId:'forged'});
 expect(calls.find(c=>c.command==='search').context.sessionId).toBe('native-test');
 await $.turn.complete({text:'结束',turnId:'real-turn',reason:'answer'});
 const denied=await $.tool.call({tool:'mcp__amoji__search',query:'加油'});
 expect(denied.deny).toContain('active main-conversation');
});
test('建议默认当前会话模型且失败保留草稿，不附带历史或图片',async($,on)=>{
 const calls:any[]=[];backend(on,calls);let request:any;
 // Override only the two suggestion operations at this test's transport seam.
 on('model.complete',($,e)=>{request=e;return {value:{isAnswered:false,reason:'empty-reply'}};});
 const ui=await $.ui.mount(pane);await ui.press({key:'tab:create'});
 await ui.input({key:'intent',text:'鼓励搭档'});
 await ui.press({key:'suggest'});
 expect(request.model).toBe('haiku');expect(request.tools).toBeUndefined();expect(request.messages).toBeUndefined();
 expect(await ui.find({type:'Text',text:/草稿保持不变/})).toBeDefined();
 await ui.unmount();
});
test('生成期间修改意图，迟到结果不会覆盖草稿或显示可采用建议',async($,on)=>{
 const calls:any[]=[];backend(on,calls);
 let entered!:()=>void;let release!:()=>void;
 const started=new Promise<void>(r=>entered=r);const gate=new Promise<void>(r=>release=r);
 on('model.complete',async()=>{entered();await gate;return {value:{isAnswered:true,text:'{}'}};});
 const ui=await $.ui.mount(pane);await ui.press({key:'tab:create'});
 await ui.input({key:'intent',text:'旧意图'});
 const pending=ui.press({key:'suggest'});await started;
 await ui.input({key:'intent',text:'新的意图'});release();await pending;
 expect(await ui.find({key:'apply-suggestion'})).toBeUndefined();
 expect(calls.some(c=>c.command==='parseSuggestion')).toBe(false);
 await ui.unmount();
});
