import { useText, message, type TextMessage } from './i18n.js';
import React,{useEffect,useRef,useState} from 'react';
import type {SuggestionModel} from './ai-suggestions.js';
import type {Draft,DraftFields} from '../drafts.js';
import type {DshRpc} from './contracts.js';
import type {Expression} from '../sample-catalog.js';
import {Conflict} from './ui.js';
export function Fields({value,onChange,showRights=true}:{value:DraftFields;onChange:(v:DraftFields)=>void;showRights?:boolean}){
 const t=useText();
 const optional=<T extends object>(value:T,key:keyof T,text:string):T=>{const next={...value};if(text==='')delete next[key];else next[key]=text as T[keyof T];return next;};
 const field=(label:string,key:keyof DraftFields['semantics'],list=false)=><label className={['meaning','fallback'].includes(key)?'wide':''}>{t(label)}<textarea aria-label={t(label)} value={list?(value.semantics[key] as string[]|undefined)?.join('\n')??'':value.semantics[key] as string??''} onInput={e=>onChange({...value,semantics:key==='tone'?optional(value.semantics,key,e.currentTarget.value):{...value.semantics,[key]:list?(e.currentTarget.value?e.currentTarget.value.split('\n'):[]):e.currentTarget.value}})}/></label>;
 return <div className="stack"><div className="fields"><label className="wide">{t("名称")}<input aria-label={t("名称")} placeholder={t("例如：进度如何")} value={value.name} onInput={e=>onChange({...value,name:e.currentTarget.value})}/></label>{field("固定含义",'meaning')}{field("文字回退",'fallback')}</div>
 <details className="amoji-advanced"><summary>{showRights?t("更多设置：语气、场景与来源"):t("更多设置：语气与场景")}</summary><div className="fields"><label>{t("语言")}<input aria-label={t("语言")} value={value.semantics.locale} onInput={e=>onChange({...value,semantics:{...value.semantics,locale:e.currentTarget.value}})}/></label>{field("语气",'tone')}{field("适用场景（每行一项）",'use_when',true)}{field("避免场景（每行一项）",'avoid_when',true)}<label>{t("标签（每行一项）")}<textarea aria-label={t("标签（每行一项）")} value={value.tags?.join('\n')??''} onInput={e=>onChange({...value,tags:e.currentTarget.value?e.currentTarget.value.split('\n'):[]})}/></label>{showRights&&(['license','creator','source'] as const).map(key=><label key={key}>{{license:t("使用许可"),creator:t("作者"),source:t("来源")}[key]}<input aria-label={{license:t("使用许可"),creator:t("作者"),source:t("来源")}[key]} value={value.rights[key]??''} onInput={e=>onChange({...value,rights:key==='license'?{...value.rights,[key]:e.currentTarget.value}:optional(value.rights,key,e.currentTarget.value)})}/></label>)}</div></details></div>;

}
function SemanticSummary({value}:{value:DraftFields}) {
 const t=useText();
 return <div className="amoji-semantic-summary"><h4>{value.name||t("未命名表情")}</h4><p>{value.semantics.meaning||t("写下这张表情想表达的意思。")}</p>{value.semantics.fallback&&<div className="amoji-fallback"><span>{t("图片无法显示时")}</span><q>{value.semantics.fallback}</q></div>}{value.semantics.tone&&<small>{value.semantics.tone}</small>}</div>;
}
const editorCache = new Map<string, {draft:Draft;fields:DraftFields;upload?:string;filename:string;intent:string;uncertain:boolean;artwork?:string}>();
export function discardEditor(id:string){editorCache.delete(id);}
export function DraftEditor({rpc,sessionId,initial,onCreated,onSaved}:{rpc:DshRpc;sessionId:string;initial:Draft;onCreated:(e:Expression)=>void;onSaved?:(draft:Draft)=>void}){
 const t=useText();
 const cached=editorCache.get(initial.draft_id);
 const [draft,setDraft]=useState(cached?.draft??initial),[fields,setFields]=useState(cached?.fields??initial.fields),[upload,setUpload]=useState<string|undefined>(cached?.upload),[filename,setFilename]=useState(cached?.filename??''),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>(),[status,setStatus]=useState<TextMessage>(''),[intent,setIntent]=useState(cached?.intent??''),[suggesting,setSuggesting]=useState(false),[candidate,setCandidate]=useState<DraftFields>(),[preview,setPreview]=useState<{token:number;draft:Draft;primary:string;poster:string|null}>(),[loaded,setLoaded]=useState(false),[checked,setChecked]=useState(false),[paused,setPaused]=useState(true),[uncertain,setUncertain]=useState(cached?.uncertain??false);
 const [artwork,setArtwork]=useState<string|undefined>(cached?.artwork);
 useEffect(()=>{if(draft.confirmed)editorCache.delete(initial.draft_id);else editorCache.set(initial.draft_id,{draft,fields,upload,filename,intent,uncertain,artwork});},[draft,fields,upload,filename,intent,uncertain,artwork]);
 const [models,setModels]=useState<SuggestionModel[]>([]),[modelKey,setModelKey]=useState(''),[modelError,setModelError]=useState(''),[loadingModels,setLoadingModels]=useState(false);
 const suggestionAbort=useRef<AbortController|undefined>(undefined);
 const modelsEpoch=useRef(0);
 const loadModels=async()=>{const epoch=++modelsEpoch.current;setLoadingModels(true);setModelError('');try{const result=await rpc.management(sessionId,'listSuggestionModels',{});if(epoch!==modelsEpoch.current)return;if(!Array.isArray(result.models))throw new Error();setModels(result.models);setModelKey(current=>result.models.some(m=>JSON.stringify([m.provider,m.model])===current)?current:result.current&&result.models.some(m=>m.provider===result.current!.provider&&m.model===result.current!.model)?JSON.stringify([result.current.provider,result.current.model]):'');if(!result.models.length)setModelError('没有可用模型，请先在 dsh 中配置模型，再刷新列表。');}catch{if(epoch===modelsEpoch.current)setModelError('无法读取模型列表，请检查 dsh 模型配置后重试。');}finally{if(epoch===modelsEpoch.current)setLoadingModels(false);}};
 useEffect(()=>{void loadModels();return()=>{modelsEpoch.current++;suggestionAbort.current?.abort();};},[rpc,sessionId]);
 const previewEpoch=useRef(0);
 const revokePreview=()=>{previewEpoch.current++;setPreview(undefined);setLoaded(false);setChecked(false);};
 const generation=useRef(0); const currentFields=useRef(fields);currentFields.current=fields;
 const invalidateSuggestion=()=>{suggestionAbort.current?.abort();generation.current++;setCandidate(undefined);setSuggesting(false);};
 const invalidate=()=>{invalidateSuggestion();revokePreview();};
 const change=(value:DraftFields)=>{invalidate();setFields(value);setStatus('有未保存修改');};
 useEffect(()=>()=>{generation.current++;previewEpoch.current++;},[]);
 const run=async(fn:()=>Promise<void>)=>{setBusy(true);setError(undefined);try{await fn();}catch(e){setError(e);if((e as {code?:string}).code==='DRAFT_OUTCOME_UNKNOWN')setUncertain(true);}finally{setBusy(false);}};
 const save=async()=>{invalidateSuggestion();const result=await rpc.management(sessionId,'saveDraft',{draft_id:draft.draft_id,version:draft.version,fields,...(upload?{upload}:{})});setDraft(result);setUpload(undefined);setUncertain(false);setStatus('草稿已保存');onSaved?.(result);return result;};
 const refresh=()=>void run(async()=>{invalidateSuggestion();const current=await rpc.management(sessionId,'getDraft',{draft_id:draft.draft_id});setError({message:'已读取当前草稿。你的输入仍保留，可继续编辑后重新保存。',current});setDraft(current);setUncertain(false);revokePreview();if(current.confirmed){setStatus('该草稿已确认，返回表情库可查看。');onCreated(await rpc.visual(sessionId,current.confirmed).then(v=>v.expression));}});
 const selectFile=async(file?:File)=>{if(!file)return;invalidate();if(file.size>10*1024*1024){setError(new Error('图片最多 10 MiB，请选择较小文件。'));return;}const token=generation.current;await run(async()=>{const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]!);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(file);});if(token!==generation.current)return;setUpload(data);setArtwork(`data:${file.type||'image/png'};base64,${data}`);setFilename(file.name);setStatus('素材尚未保存');});};
 const hasMeaning=!!(fields.name.trim()||fields.semantics.meaning.trim());
 const generate=()=>{
  if(suggestionAbort.current&&!suggestionAbort.current.signal.aborted)return;
  const model=models.find(m=>JSON.stringify([m.provider,m.model])===modelKey);if(!model)return;
  const controller=new AbortController();suggestionAbort.current=controller;
  const token=++generation.current;setCandidate(undefined);setSuggesting(true);setError(undefined);setStatus('');
  void rpc.management(sessionId,'suggestAiText',{intent,provider:model.provider,model:model.model},controller.signal)
   .then(result=>{if(token===generation.current){setCandidate({...result.fields,rights:currentFields.current.rights});setStatus(message('由 {name}（{provider} / {model}）生成文字建议；未读取图片。请修改并确认。',{name:model.name,provider:model.provider,model:model.model}));}})
   .catch(e=>{if(token===generation.current)setError(e);})
   .finally(()=>{if(token===generation.current){setSuggesting(false);suggestionAbort.current=undefined;}});
 };
 return <section className="stack amoji-draft-editor" aria-label={t("编辑表情草稿")}>
 <header className="amoji-create-heading"><h3>{draft.mode==='edit'?t("调整这张表情"):draft.mode==='copy'?t("做成自己的表情"):t("把想说的话，变成表情")}</h3><p>{t("描述你的意思，让 AI 帮你整理，再配上一张图。")}</p></header>
 <fieldset disabled={busy||uncertain||!!draft.confirmed} className="stack" style={{border:0,padding:0,margin:0,minWidth:0}}>
  <div className="amoji-creation-workspace">
   <div className="amoji-artwork"><label className="amoji-artwork-upload" title={t("选择或更换表情图片")}>
    {artwork?<img src={artwork} alt={t("待保存的表情图片")}/>:<svg aria-hidden="true" width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="9" cy="9" r="1.5"/><path d="m4 18 5-5 3 3 4-5 5 5"/></svg>}
    <span>{filename?t("更换图片"):draft.visual?t("更换已保存图片"):t("配一张表情图")}</span><small>{filename|| (draft.visual?t("图片已保存"):t("也可以稍后上传"))}</small>
    <input aria-label={t("上传表情图片")} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={e=>void selectFile(e.target.files?.[0])}/>
   </label><p>{t("PNG、JPG、WebP 或 GIF")}<br/>{t("最多 10 MiB · 动图不超过 10 秒")}</p></div>
   <section className="amoji-ai-composer" aria-label={t("AI 语义创作")}>
    <label className="amoji-intent-label">{t("想表达什么？")}<textarea aria-label={t("文字意图")} rows={4} maxLength={240} placeholder={t("告诉 AI：谁对谁说，在什么情境下，想表达什么，是什么语气。\n例如：AI 对遇到困难的用户说，别着急，我会陪你一步步解决。温暖一点，但不要暗示已经完成。")} value={intent} onInput={e=>{invalidate();setIntent(e.currentTarget.value);}}/></label>
    <div className="amoji-composer-controls"><label className="amoji-model-label"><span>{t("模型")}</span><select aria-label={t("建议模型")} value={modelKey} disabled={loadingModels||suggesting} onChange={e=>{invalidateSuggestion();setModelKey(e.currentTarget.value);}}><option value="">{loadingModels?t("正在读取…"):t("选择模型")}</option>{models.map(m=><option key={JSON.stringify([m.provider,m.model])} value={JSON.stringify([m.provider,m.model])}>{m.name} / {m.provider}</option>)}</select></label>
     {suggesting?<button type="button" onClick={()=>{invalidateSuggestion();setStatus('已取消生成，当前填写保持不变');}}>{t("取消生成")}</button>:<button className="primary" type="button" disabled={!modelKey||!intent.trim()} onClick={generate}>{t("AI 生成文字建议")}</button>}
    </div><div className="amoji-composer-note"><small>{suggesting?t("正在整理你的表达…"):t("仅根据文字生成，按所选模型计费。")}</small><button className="quiet" aria-label={t("刷新模型列表")} title={t("刷新模型列表")} type="button" disabled={loadingModels||suggesting} onClick={()=>void loadModels()}>{t("刷新模型")}</button></div>
    {modelError&&<p className="muted">{t(modelError)}</p>}
   </section>
  </div>
  {candidate?<section className="amoji-semantic-card" aria-label={t("待选建议")}><header><h3>{t("AI 建议")}</h3><span>{t("采用前可以修改")}</span></header><SemanticSummary value={candidate}/><details className="amoji-semantic-edit"><summary>{t("编辑建议")}</summary><Fields value={candidate} onChange={setCandidate} showRights={false}/></details><div className="amoji-candidate-actions"><button className="primary" type="button" onClick={()=>{change(candidate);setStatus('建议已采用，仍需保存和预览确认');}}>{t("采用建议")}</button><button className="quiet" type="button" onClick={()=>setCandidate(undefined)}>{t("放弃建议")}</button></div></section>:null}
  <section className="stack amoji-saved-semantics" hidden={!!candidate} aria-label={t("当前草稿语义")}>
   {hasMeaning&&<div className="amoji-semantic-card"><header><h3>{t("表情含义")}</h3><span>{t("AI 会读到下面这段意思")}</span></header><SemanticSummary value={fields}/></div>}
   <details className="amoji-semantic-edit" data-editor="manual"><summary>{hasMeaning?t("编辑语义与来源"):t("不使用 AI，手动填写语义")}</summary><Fields value={fields} onChange={change}/></details>
  </section>
  <div className="amoji-draft-actions"><small>{candidate?t("先采用建议，再预览确认"):!draft.visual&&!upload?t("配图后即可预览并加入表情库"):t("预览图片与含义后，再确认加入表情库")}</small><div className="row"><button type="button" onClick={()=>void run(async()=>{revokePreview();await save();})}>{t("保存草稿")}</button><button className="primary" type="button" disabled={!!candidate} onClick={()=>void run(async()=>{revokePreview();const token=previewEpoch.current;const saved=await save();const result=await rpc.management(sessionId,'previewDraft',{draft_id:saved.draft_id,version:saved.version});if(token===previewEpoch.current)setPreview({...result,token});})}>{t("保存并预览")}</button></div></div>
 </fieldset>
 {preview&&<section className="preview" aria-label={t("图文确认预览")}><h3>{t("这张表情准备好了吗？")}</h3><small>{draft.mode==='edit'?t("确认将创建新版本，旧消息中的图片和含义保持不变。"):t("核对图片与含义，确认后即可在对话中使用。")}</small><img key={`${preview.token}:${paused}`} src={paused&&preview.poster?preview.poster:preview.primary} alt={preview.draft.fields.semantics.fallback} onLoad={()=>{if(preview.token===previewEpoch.current)setLoaded(true);}} onError={()=>{if(preview.token!==previewEpoch.current)return;setLoaded(false);setChecked(false);setError(new Error('浏览器无法加载预览，不能确认，请重试预览。'));}}/>{preview.poster&&<button type="button" onClick={()=>{setPaused(!paused);setPreview({...preview,token:++previewEpoch.current});setLoaded(false);setChecked(false);}}>{paused?t("播放动图"):t("暂停动图")}</button>}<strong>{preview.draft.fields.name}</strong><p>{preview.draft.fields.semantics.meaning}</p><details><summary>{t("完整固定语义与许可")}</summary><dl className="amoji-semantic-details"><dt>{t("文字回退")}</dt><dd>{preview.draft.fields.semantics.fallback}</dd><dt>{t("语气")}</dt><dd>{preview.draft.fields.semantics.tone||t("未指定")}</dd><dt>{t("适用场景")}</dt><dd>{preview.draft.fields.semantics.use_when?.join('；')||t("未指定")}</dd><dt>{t("避免场景")}</dt><dd>{preview.draft.fields.semantics.avoid_when?.join('；')||t("未指定")}</dd><dt>{t("标签")}</dt><dd>{preview.draft.fields.tags?.join('、')||t("无")}</dd><dt>{t("使用许可")}</dt><dd>{preview.draft.fields.rights.license}</dd>{preview.draft.fields.rights.creator&&<><dt>{t("作者")}</dt><dd>{preview.draft.fields.rights.creator}</dd></>}{preview.draft.fields.rights.source&&<><dt>{t("来源")}</dt><dd>{preview.draft.fields.rights.source}</dd></>}</dl></details><label className="amoji-preview-confirm"><input type="checkbox" checked={checked} disabled={!loaded||busy} onChange={e=>{if(preview.token===previewEpoch.current&&loaded)setChecked(e.target.checked);}}/><span>{t("我已核对图片和固定语义")}</span></label><button className="primary" type="button" disabled={!loaded||!checked||busy||uncertain||!!draft.confirmed} onClick={()=>void run(async()=>{if(preview.token!==previewEpoch.current||!loaded||!checked)return;const result=await rpc.management(sessionId,'confirmDraft',{draft_id:draft.draft_id,version:preview.draft.version});setDraft({...draft,confirmed:result});setUncertain(false);setStatus('表情已加入共享库');onCreated(result);})}>{t("确认加入表情库")}</button></section>}
 <Conflict error={error} onRefresh={refresh}/>{(error as {code?:string})?.code==='ENTRY_CONFLICT'&&(error as {current?:import('../library-management.js').LibraryEntry}).current&&<button type="button" disabled={busy} onClick={()=>void run(async()=>{const entry=(error as {current:import('../library-management.js').LibraryEntry}).current;
 // Transfer the old saved primary bytes through the existing validated upload path.
 // Never inherit the newly current entry's media under a preserve-input action.
 let retained=upload;
 if(!retained){const previous=preview?.draft.draft_id===draft.draft_id&&preview.draft.version===draft.version?preview:await rpc.management(sessionId,'previewDraft',{draft_id:draft.draft_id,version:draft.version});const match=/^data:image\/[a-zA-Z0-9.+-]+;base64,([A-Za-z0-9+/]+={0,2})$/.exec(previous.primary);if(!match)throw new Error('无法迁移原草稿图片，旧草稿和填写已保留，请重试');retained=match[1]!;}
 invalidateSuggestion();const next=await rpc.management(sessionId,'startRevisionDraft',{ref:{asset_id:entry.expression.asset_id,revision_id:entry.expression.revision_id},version:entry.version});setDraft(next);setUpload(retained);revokePreview();setStatus('已从当前版本开始新草稿，本次填写仍保留，请保存并重新预览。');})}>{t("基于当前版本继续，保留本次填写")}</button>}<p role="status">{busy?t("处理中…"):t(status)}</p></section>;
}
