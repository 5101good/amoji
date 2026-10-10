import {L,refOf} from './transport.js';
import {perform,navigate,load,send,changePreference,edit,save,suggest,call,invalidate} from './controller.js';

export function pane($,e,s,makePicture) {
  const {Box,Text,Button,Input,Select,Link,Svg}= $.ui.resolve(e);
  const t=(value,dim=false)=>Text({children:[value],...(dim?{dimColor:true}:{})});
  const row=children=>Box({flexDirection:'row',flexWrap:'wrap',gap:1,alignItems:'center',children:children.filter(Boolean)});
  const col=children=>Box({flexDirection:'column',gap:1,children:children.filter(Boolean)});
  const button=(key,label,action,primary=false)=>s.busy?t(label,true):Button({key,label,...(primary?{variant:'primary'}:{plain:true}),onPress:()=>perform($,s,action)});
  const input=(key,label,value,change,placeholder='')=>Input({key,label,value,placeholder,onInput:value=>{if(!s.busy)change(value);},onSubmit:value=>{if(!s.busy)change(value);}});
  const select=(key,label,value,options,change)=>col([t(label,true),Select({key,value,options:options.map(([value,label])=>({value,label})),onSelect:change})]);
  const picture=(preview,name)=>preview&&Svg?Box({width:14,children:[Svg({source:preview,alt:name,width:96,height:96})]}):t(L(s,'预览不可用','Preview unavailable'),true);
  const tabs=row([['picker','表情','Expressions'],['library','个人库','Library'],['create','创建','Create'],['settings','偏好','Preferences']].map(([tab,zh,en])=>button('tab:'+tab,L(s,zh,en),()=>navigate($,s,tab),s.tab===tab)));
  const header=row([t('Amoji'),Button({key:'close',label:L(s,'关闭','Close'),role:'dismiss',onPress:()=>$.ui.close({id:'amoji'})})]);
  const refresh=button('refresh',L(s,'刷新','Refresh'),async()=>{s.collection=null;s.preferences=null;await load($,s);});
  let body;
  if(s.tab==='settings') {
    const p=s.preferences;
    body=p?col([
      t(L(s,'这些偏好控制 AI 选图和发送频率，不会改变固定语义。','Preferences guide AI selection and frequency. Fixed meanings stay unchanged.'),true),
      select('preference:appearance',L(s,'表情画风','Appearance'),p.appearance,[['classic',L(s,'经典 · 温暖手绘','Classic · warm illustrations')],['office',L(s,'办公 · 简洁克制','Office · clear and calm')]],value=>changePreference($,s,'appearance',value)),
      select('preference:style',L(s,'AI 语气偏好','AI tone'),p.style,[['neutral',L(s,'自然','Natural')],['warm',L(s,'温暖','Warm')],['playful',L(s,'活泼','Playful')]],value=>changePreference($,s,'style',value)),
      select('preference:frequency',L(s,'AI 使用频率','AI frequency'),p.frequency,[['restrained',L(s,'克制','Restrained')],['moderate',L(s,'适中','Moderate')],['active',L(s,'活跃','Active')]],value=>changePreference($,s,'frequency',value)),
      select('preference:paused',L(s,'AI 表情','AI expressions'),String(p.paused),[['false',L(s,'开启','Enabled')],['true',L(s,'暂停','Paused')]],value=>changePreference($,s,'paused',value==='true')),
      t(L(s,'语言跟随 Claude Code 的 language 配置，支持中文和英文。','Language follows Claude Code’s language setting (Chinese or English).'),true),refresh,
    ]):refresh;
  } else if(s.tab==='create') {
    const d=s.draft;
    const editField=(key,value)=>edit(s,()=>{d.fields[key]=value;});
    const semantic=(key,value)=>edit(s,()=>{d.fields.semantics[key]=value;});
    if(s.drafts) body=col([t(L(s,'未完成的草稿','Unfinished drafts')), ...s.drafts.slice(0,30).map(draft=>button('draft:'+draft.draft_id,draft.fields.name||L(s,'未命名草稿','Untitled draft'),async()=>{s.draft=await call($,s.context,'getDraft',{id:draft.draft_id});s.drafts=null;s.step='edit';s.preview=null;s.imagePath='';})),button('draft-back',L(s,'返回','Back'),async()=>{s.drafts=null;})]);
    else if(!d) body=refresh;
    else if(s.step==='review'&&s.preview) body=col([
      t(L(s,'确认后，图片与语义将固定为一个版本。','Confirming fixes this image and meaning as one version.')),
      picture(s.preview.preview,d.fields.name),t(d.fields.name),t(d.fields.semantics.meaning),t(d.fields.semantics.fallback,true),
      d.fields.semantics.tone&&t(L(s,'语气：','Tone: ')+d.fields.semantics.tone,true),
      t(L(s,'适用：','Use when: ')+(d.fields.semantics.use_when||[]).join(' / '),true),
      t(L(s,'避免：','Avoid when: ')+(d.fields.semantics.avoid_when||[]).join(' / '),true),
      t(L(s,'许可：','License: ')+d.fields.rights.license,true),
      s.preview.visual?.animated&&t(L(s,'动态素材在 Claude 中显示静态封面。','Animated assets display their static cover in Claude.'),true),
      s.preview.preview?button('reviewed',(s.reviewed?'☑ ':'☐ ')+L(s,'我已核对图片和固定语义','I reviewed the image and fixed meaning'),async()=>{s.reviewed=!s.reviewed;}):t(L(s,'图片预览失败，暂不能确认。','Preview failed; confirmation is unavailable.')),
      row([button('edit-again',L(s,'返回编辑','Back to editing'),async()=>{s.step='edit';s.reviewed=false;}),s.reviewed&&s.preview.preview&&button('confirm',L(s,'确认创建','Confirm expression'),async()=>{await call($,s.context,'confirmDraft',{id:d.draft_id,version:d.version,reviewed:true});s.draft=null;s.preview=null;s.step='idea';s.intent='';s.suggestion=null;await navigate($,s,'library');s.notice=L(s,'表情已加入个人库','Expression added to your library');},true)])
    ]);
    else if(s.step==='idea') body=col([
      t(L(s,'从你想表达的意思开始。','Start with what you want to express.')),
      input('intent',L(s,'想表达什么','Your intent'),s.intent,value=>edit(s,()=>{s.intent=value;}),L(s,'例如：温柔地提醒搭档休息一下，适合工作太久时使用','For example: gently remind a teammate to take a break after working too long')),
      select('suggestion-model',L(s,'生成建议的模型','Suggestion model'),s.model,[[s.model,s.model],...['haiku','sonnet','opus'].filter(x=>x!==s.model).map(x=>[x,x]),['custom',L(s,'自定义模型 ID…','Custom model ID…')]],value=>{edit(s,()=>{s.model=value;});invalidate($);}),
      s.model==='custom'&&input('custom-model',L(s,'模型 ID','Model ID'),s.customModel||'',value=>{s.customModel=value;}),
      t(L(s,'默认使用当前对话模型；只发送这段意图，不读取图片或聊天记录。','Defaults to the current conversation model. Only this intent is sent, without images or chat history.'),true),
      s.generating?row([t(L(s,'正在生成…','Generating…')),Button({key:'cancel-suggestion',label:L(s,'取消','Cancel'),onPress:()=>{s.suggestionAbort?.abort();s.editEpoch++;invalidate($);}})]):Button({key:'suggest',label:L(s,'AI 生成文字建议','Generate with AI'),variant:'primary',onPress:()=>{if(s.model==='custom'){s.model=s.customModel||'';}return suggest($,s);}}),
      s.suggestion&&col([t(s.suggestion.name),t(s.suggestion.semantics.meaning),t(s.suggestion.semantics.fallback,true),row([button('apply-suggestion',L(s,'采用并编辑','Use and edit'),async()=>{edit(s,()=>{d.fields={...d.fields,...s.suggestion};});s.suggestion=null;s.step='edit';}),button('discard-suggestion',L(s,'放弃建议','Discard'),async()=>{s.suggestion=null;})])]),
      row([button('manual-edit',L(s,'手工填写','Write manually'),async()=>{s.step='edit';}),button('resume-drafts',L(s,'继续草稿','Resume a draft'),async()=>{s.drafts=await call($,s.context,'listDrafts');})]),
    ]);
    else body=col([
      input('image-path',L(s,'图片文件','Image file'),s.imagePath,value=>edit(s,()=>{s.imagePath=value;}),L(s,'粘贴本地图片的绝对路径；PNG / JPEG / WebP / GIF','Paste an absolute local path; PNG / JPEG / WebP / GIF')),
      d.visual&&!s.imagePath&&t(L(s,'已保存图片；留空保留原图。','Image saved; leave empty to keep it.'),true),
      input('field:name',L(s,'名称','Name'),d.fields.name,value=>editField('name',value)),
      input('field:meaning',L(s,'固定语义','Fixed meaning'),d.fields.semantics.meaning,value=>semantic('meaning',value)),
      input('field:fallback',L(s,'纯文字替代','Text fallback'),d.fields.semantics.fallback,value=>semantic('fallback',value)),
      input('field:license',L(s,'使用许可','Usage license'),d.fields.rights.license,value=>edit(s,()=>{d.fields.rights.license=value;})),
      button('advanced',L(s,s.advanced?'收起更多选项':'语气、场景与署名',s.advanced?'Fewer options':'Tone, context and attribution'),async()=>{s.advanced=!s.advanced;}),
      ...(s.advanced?[
        input('field:locale',L(s,'语义语言','Meaning language'),d.fields.semantics.locale,value=>semantic('locale',value)),
        input('field:tone',L(s,'语气','Tone'),d.fields.semantics.tone||'',value=>semantic('tone',value)),
        input('field:use',L(s,'适用场景（分号分隔）','Use when (semicolon separated)'),(d.fields.semantics.use_when||[]).join('; '),value=>semantic('use_when',value.split(/[;；]/).map(x=>x.trim()).filter(Boolean))),
        input('field:avoid',L(s,'避免场景（分号分隔）','Avoid when (semicolon separated)'),(d.fields.semantics.avoid_when||[]).join('; '),value=>semantic('avoid_when',value.split(/[;；]/).map(x=>x.trim()).filter(Boolean))),
        input('field:tags',L(s,'标签（分号分隔）','Tags (semicolon separated)'),(d.fields.tags||[]).join('; '),value=>editField('tags',value.split(/[;；]/).map(x=>x.trim()).filter(Boolean))),
        input('field:creator',L(s,'作者','Creator'),d.fields.rights.creator||'',value=>edit(s,()=>{d.fields.rights.creator=value;})),
        input('field:source',L(s,'来源','Source'),d.fields.rights.source||'',value=>edit(s,()=>{d.fields.rights.source=value;})),
      ]:[]),
      row([button('save-draft',L(s,'保存草稿','Save draft'),()=>save($,s)),button('preview-draft',L(s,'预览并核对','Preview and review'),()=>save($,s,true),true)]),
      button('back-idea',L(s,'返回 AI 建议','Back to AI suggestions'),async()=>{s.step='idea';}),
    ]);
  } else if(s.transfer) {
    body=col([t(s.transfer==='import'?L(s,'导入 .amoji 表情包','Import an .amoji pack'):L(s,`导出已选的 ${Object.keys(s.selected).length} 个表情`,`Export ${Object.keys(s.selected).length} selected expressions`)),input('pack-path',L(s,'文件路径','File path'),s.path,value=>{s.path=value;},L(s,'绝对路径，例如 /Users/me/Downloads/team.amoji','Absolute path, e.g. /Users/me/Downloads/team.amoji')),t(L(s,'仅在你点击下方按钮时读写这个文件；导出不会覆盖已有文件。','The file is accessed only when you press below. Export never overwrites a file.'),true),row([button('transfer-back',L(s,'返回','Back'),async()=>{s.transfer=null;}),button('transfer-confirm',s.transfer==='import'?L(s,'导入','Import'):L(s,'导出','Export'),async()=>{if(s.transfer==='import'){const result=await call($,s.context,'importPack',{path:s.path});s.notice=L(s,`已导入 ${result.added} 个新版本`,`Imported ${result.added} new revisions`);}else{await call($,s.context,'exportPack',{path:s.path,refs:Object.values(s.selected)});s.notice=L(s,'已导出','Exported');}s.transfer=null;s.collection=null;await load($,s);},true)])]);
  } else if(s.detail) {
    const item=s.detail;const x=item.expression;
    body=col([button('detail-back',L(s,'返回列表','Back to list'),async()=>{s.detail=null;}),picture(item.preview,x.name),t(x.name),t(x.semantics.meaning),t(x.semantics.fallback,true),x.semantics.tone&&t(x.semantics.tone,true),t(L(s,'适用：','Use when: ')+(x.semantics.use_when||[]).join(' / '),true),t(L(s,'避免：','Avoid when: ')+(x.semantics.avoid_when||[]).join(' / '),true),t(L(s,'许可：','License: ')+x.rights.license,true),
      row([!item.archived&&Button({key:'detail-send',label:L(s,'发送','Send'),variant:'primary',onPress:()=>send($,s,x)}),button('revise',L(s,item.origin==='local'?'创建新版本':'复制后编辑',item.origin==='local'?'Create a revision':'Copy and edit'),async()=>{s.draft=await call($,s.context,'startRevisionDraft',{ref:refOf(x),version:item.version});s.step='edit';s.preview=null;s.imagePath='';await navigate($,s,'create');}),button('archive',L(s,item.archived?'恢复':'归档',item.archived?'Restore':'Archive'),async()=>{await call($,s.context,'archive',{assetId:x.asset_id,version:item.version,archived:!item.archived});s.detail=null;s.collection=null;await load($,s);})]),
      button('versions',L(s,'查看版本','Show revisions'),async()=>{s.revisions=await call($,s.context,'revisions',{assetId:x.asset_id});}),
      ...(s.revisions||[]).map(revision=>t(`${revision.created_at.slice(0,10)} · ${revision.revision_id.slice(0,8)} · ${revision.name}${revision.revision_id===x.revision_id?' ✓':''}`,true)),
      s.revisions?.length>1&&item.origin!=='local'&&select('choose-revision',L(s,'用于新消息的版本','Version for new messages'),x.revision_id,s.revisions.map(r=>[r.revision_id,r.name+' · '+r.revision_id.slice(0,8)]),value=>perform($,s,async()=>{const updated=await call($,s.context,'selectRevision',{ref:{asset_id:x.asset_id,revision_id:value},version:item.version});s.detail=null;s.collection=null;s.revisions=null;await load($,s);})),
    ]);
  } else {
    const collection=s.collection;
    const cards=(collection?.items||[]).map(item=>{
      const x=item.expression;
      // Client is mounted by register.js, whose literal module path the loader resolves.
      const visual=makePicture? makePicture(item):picture(item.preview,x.name);
      return Box({key:'card:'+x.asset_id,width:18,flexDirection:'column',gap:0,children:[visual,
        s.tab==='picker'?Button({key:'send:'+x.asset_id,label:x.name,plain:true,onPress:()=>send($,s,x)}):button('details:'+x.asset_id,x.name,async()=>{s.detail=item;s.revisions=null;}),
        s.tab==='picker'?button('details:'+x.asset_id,L(s,'含义','Meaning'),async()=>{s.detail=item;s.revisions=null;}):button('select:'+x.asset_id,(s.selected[x.asset_id]?'☑ ':'☐ ')+L(s,'选入导出','Select for export'),async()=>{if(s.selected[x.asset_id])delete s.selected[x.asset_id];else s.selected[x.asset_id]=refOf(x);}),
      ]});
    });
    body=col([
      Input({key:'search',label:L(s,'搜索','Search'),placeholder:L(s,'名称、情绪或场景','Name, emotion or context'),value:s.query,onInput:value=>{s.query=value;},onSubmit:value=>perform($,s,async()=>{s.query=value;s.page=0;s.collection=null;await load($,s);})}),
      s.tab==='picker'?t(L(s,'点击图片即可发送 · AI 只接收固定文字语义','Click an image to send · AI receives only fixed text'),true):row([button('archived',L(s,s.archived?'查看使用中':'查看已归档',s.archived?'Show active':'Show archived'),async()=>{s.archived=!s.archived;s.page=0;s.collection=null;await load($,s);}),button('import',L(s,'导入','Import'),async()=>{s.transfer='import';s.path='';}),Object.keys(s.selected).length>0&&button('export',L(s,`导出 (${Object.keys(s.selected).length})`,`Export (${Object.keys(s.selected).length})`),async()=>{s.transfer='export';s.path='';})]),
      cards.length?Box({flexDirection:'row',flexWrap:'wrap',gap:1,children:cards}):t(L(s,'没有找到表情。试试其他关键词，或创建自己的表情。','No expressions found. Try another search or create your own.')),
      collection&&row([collection.page>0&&button('previous',L(s,'上一页','Previous'),async()=>{s.page=collection.page-1;s.collection=null;await load($,s);}),t(`${collection.page+1} / ${collection.pages}`,true),collection.page+1<collection.pages&&button('next',L(s,'下一页','Next'),async()=>{s.page=collection.page+1;s.collection=null;await load($,s);}),refresh])
    ]);
  }
  return col([header,tabs,s.busy&&t(L(s,'处理中…','Working…'),true),s.error&&t(s.error),s.notice&&t(s.notice),body,Link({href:'https://github.com/5101good/amoji',children:[L(s,'Amoji · 开源的 AI 原生表情','Amoji · open-source AI-native expressions')]})]);
}
