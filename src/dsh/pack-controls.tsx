import { useText, message, type TextMessage } from './i18n.js';
import React,{useEffect,useRef,useState} from 'react';
import type {ExpressionRef} from '../sample-catalog.js';
import type {DshRpc} from './contracts.js';
import {Conflict} from './ui.js';
export function PackControls({rpc,sessionId,refs,onImported}:{rpc:DshRpc;sessionId:string;refs:ExpressionRef[];onImported:()=>void}){
 const t=useText();
 const [file,setFile]=useState<File>(),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>(),[status,setStatus]=useState<TextMessage>(''),[unknown,setUnknown]=useState(false);
 const downloadLink=useRef<HTMLAnchorElement>(null);
 const [download,setDownload]=useState<{url:string;count:number}>();
 useEffect(()=>{if(!download)return;downloadLink.current?.click();return()=>URL.revokeObjectURL(download.url);},[download]);
 const importFile=async()=>{if(!file)return;setBusy(true);setError(undefined);try{const r=await rpc.importPack(sessionId,file);setUnknown(false);setStatus(message('导入完成：新增 {added} 个版本，已有 {existing} 个。已有条目的当前版本保持不变。',{added:r.added,existing:r.existing}));onImported();}catch(e){setError(e);if((e as {code?:string}).code==='PACK_OUTCOME_UNKNOWN')setUnknown(true);}finally{setBusy(false);}};
 return <section className="stack amoji-pack-settings"><h3>{t("完整表情包")}</h3><p>{t("包中包含固定版本、语义、许可和素材，不包含个人设置或会话。")}</p><label>{t("选择 .amoji 或 ZIP 文件")}<input aria-label={t("导入表情包")} type="file" accept=".amoji,.zip,application/zip" disabled={busy||unknown} onChange={e=>{const next=e.target.files?.[0];if(next&&next.size>260*1024*1024){setError(new Error('完整包最多 260 MiB'));return;}setFile(next);setError(undefined);}}/></label>{file&&<p>{file.name}</p>}<div className="row"><button type="button" disabled={!file||busy} onClick={()=>void importFile()}>{unknown?t("重试同一包并核对"):t("导入完整包")}</button>{unknown&&<button type="button" onClick={onImported}>{t("刷新库核对结果")}</button>}</div><button type="button" disabled={!refs.length||busy} onClick={()=>{setBusy(true);setError(undefined);void rpc.exportPack(sessionId,refs,t('我的表情')).then(blob=>{if(!blob.size)throw new Error('导出内容为空');setDownload({url:URL.createObjectURL(blob),count:refs.length});setStatus(message('已生成 {count} 个所选版本的表情包。若下载未开始，可点击下方链接保存。',{count:refs.length}));}).catch(setError).finally(()=>setBusy(false));}}>{t('导出所选 {count} 个版本',{count:refs.length})}</button><Conflict error={error}/>{download&&<a ref={downloadLink} className="amoji-download" href={download.url} download={t("我的表情.amoji")}>{t('下载表情包 · {count} 个版本',{count:download.count})}</a>}<p role="status">{busy?t("正在处理完整包…"):t(status)}</p></section>;
}
