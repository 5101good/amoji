import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { LibraryStore } from './library-store.js';
import { withValidatedPack, validatePackManifest } from './packs.js';
import type { ExpressionRef, Pack } from './protocol/index.js';
import { expressionRef } from './library-management.js';
import { fail, nonempty, object } from './shared-contract.js';
export interface MarketRelease { pack_id:string; release_id:string; archive_sha256:string; manifest:Pack; last_checked_at:string; stale?:boolean; author?:string; share_url:string }
export interface MarketOperation { origin:string; operation_id:string; pack_id:string; release_id:string; ref?:ExpressionRef; status:'pending'|'committed'|'failed'; error?:string; last_checked_at?:string }
const id=(value:unknown)=>{const v=nonempty(value);if(!/^[0-9a-f-]{36}$/.test(v))fail('INVALID_ARGUMENT','无效市场标识');return v;};
/** Network boundary: only a deployment-selected origin, never a caller or manifest URL. */
export class LocalAcquisition {
 readonly origin:string;
 constructor(private store:LibraryStore,origin:string,private fetcher:typeof fetch=fetch){
  const url=new URL(origin);if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||!(url.protocol==='https:'||(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname))))fail('INVALID_MARKET_ORIGIN','市场 origin 必须为 HTTPS 或显式本地测试地址');this.origin=url.origin;
 }
 private readonly stopController=new AbortController();
 async stop(){this.stopController.abort();await this.refreshPending;}
 private refreshPending?:Promise<{cursor?:string;last_checked_at:string|null;stale:boolean}>;
 revocationStatus(){return this.store.marketRead<{cursor?:string;last_checked_at:string|null;stale:boolean}>('revocation:'+this.origin)??{last_checked_at:null,stale:true};}
 async refreshRevocations(raw:unknown):Promise<{cursor?:string;last_checked_at:string|null;stale:boolean}>{
  object(raw,[]);if(this.refreshPending)return this.refreshPending;
  this.refreshPending=this.refreshFeed();try{return await this.refreshPending;}finally{this.refreshPending=undefined;}
 }
 private async refreshFeed(){
  const previous=this.revocationStatus();let cursor=previous.cursor;let reset=false;const deadline=AbortSignal.any([AbortSignal.timeout(3000),this.stopController.signal]);
  try{for(let page=0;page<1000;page++){
   const response=await this.fetcher(this.origin+'/v1/revocations'+(cursor?'?after='+encodeURIComponent(cursor):''),{redirect:'error',signal:deadline});
   if(response.status===410&&!reset){cursor=undefined;reset=true;continue;}
   if(!response.ok)throw Error('REVOCATION_UNAVAILABLE');
   const reader=response.body?.getReader();if(!reader)throw Error();let size=0;const chunks:Uint8Array[]=[];
   try{for(;;){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>128*1024)throw Error();chunks.push(r.value);}}finally{await reader.cancel();}
   const value=JSON.parse(Buffer.concat(chunks).toString());
   if(!Array.isArray(value.revocations)||value.revocations.length>50||typeof value.cursor!=='string'||value.cursor.length>512||typeof value.has_more!=='boolean'||!value.revocations.every((r:any)=>r&&/^[0-9a-f-]{36}$/.test(r.pack_id)&&/^[0-9a-f-]{36}$/.test(r.release_id)&&/^[a-f0-9]{64}$/.test(r.archive_sha256)&&['unpublished','safety_removed'].includes(r.state)&&typeof r.reason_code==='string'))throw Error();
   if(value.has_more&&value.cursor===cursor)throw Error();cursor=value.cursor;
   this.store.applyRevocations(this.origin,value.revocations,cursor!,value.has_more?previous.last_checked_at??'':new Date().toISOString());
   if(value.has_more)this.store.marketWrite('revocation:'+this.origin,{...this.revocationStatus(),last_checked_at:previous.last_checked_at,stale:true});
   if(!value.has_more)return this.revocationStatus();
  }throw Error();}catch{const current={...this.revocationStatus(),last_checked_at:previous.last_checked_at,stale:true};this.store.marketWrite('revocation:'+this.origin,current);return current;}
 }
 private async request(path:string,limit=10*1024*1024):Promise<Buffer>{
  let response:Response;try{response=await this.fetcher(this.origin+path,{redirect:'error',signal:AbortSignal.timeout(15000)});}catch{fail('MARKET_UNAVAILABLE','市场暂不可用，已安装内容仍可使用');}
  if(!response.ok)fail(response.status===410?'RELEASE_REMOVED':'MARKET_UNAVAILABLE','市场内容当前不可获取');
  const reader=response.body?.getReader();if(!reader)fail('MARKET_UNAVAILABLE','市场响应为空');const chunks:Uint8Array[]=[];let length=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>limit)fail('PACK_LIMIT_EXCEEDED','市场响应超过预算');chunks.push(value);}}finally{await reader.cancel();}
  return Buffer.concat(chunks);
 }
 private path(pack:string,release?:string){return `/v1/packs/${id(pack)}${release?`/releases/${id(release)}`:''}`;}
 async detail(raw:unknown):Promise<MarketRelease>{const a=object(raw,['pack_id','release_id'],['pack_id']);const path=this.path(id(a.pack_id),a.release_id===undefined?undefined:id(a.release_id));
  const value=JSON.parse((await this.request(path)).toString());const manifest=validatePackManifest(value.manifest);if(value.pack_id!==a.pack_id||manifest.pack_id!==a.pack_id||(a.release_id&&value.release_id!==a.release_id)||manifest.release_id!==value.release_id||!/^[a-f0-9]{64}$/.test(value.archive_sha256))fail('MARKET_INVALID','市场版本身份无效');
  const prior=this.store.marketRead<MarketRelease>(`detail:${this.origin}:${path}`);if(prior&&prior.release_id===value.release_id&&prior.archive_sha256!==value.archive_sha256)fail('DIGEST_MISMATCH','已知发布版本的摘要不可替换');
  const result={pack_id:value.pack_id,release_id:value.release_id,archive_sha256:value.archive_sha256,manifest,author:typeof value.author==='string'?value.author:undefined,share_url:`${this.origin}/packs/${value.pack_id}/releases/${value.release_id}`,last_checked_at:new Date().toISOString()};this.store.marketWrite(`detail:${this.origin}:${path}`,result);return result;
 }
 async search(raw:unknown):Promise<unknown>{await this.refreshRevocations({});const a=object(raw,['query','act','locale','effects'],['query']);const params=new URLSearchParams();for(const key of ['query','act','locale','effects']){const v=a[key];if(v===undefined||v==='')continue;if(typeof v!=='string'||v.length>256||(key==='effects'&&!['true','false'].includes(v)))fail('INVALID_ARGUMENT','无效市场筛选');params.set(key==='query'?'q':key,v);}if(typeof a.query!=='string')fail('INVALID_ARGUMENT','无效搜索词');const path=`/v1/packs?${params.toString()}`;
  try{const data=JSON.parse((await this.request(path,512*1024)).toString());if(!Array.isArray(data.packs)||data.packs.length>50||!data.packs.every((p:any)=>p&&typeof p.pack_id==='string'&&/^[0-9a-f-]{36}$/.test(p.pack_id)&&typeof p.release_id==='string'&&/^[0-9a-f-]{36}$/.test(p.release_id)&&p.manifest?.name&&typeof p.manifest.name==='object'&&Number.isSafeInteger(p.manifest?.version)))fail('MARKET_INVALID','市场列表响应无效');const result={...data,last_checked_at:new Date().toISOString(),stale:false};this.store.marketWrite(`search:${this.origin}:${path}`,result);return result;}catch(error){const cache=this.store.marketRead<Record<string,unknown>>(`search:${this.origin}:${path}`);if(cache)return {...cache,stale:true};throw error;}
 }
 async install(raw:unknown):Promise<MarketOperation>{return this.acquire(raw,false);}
 async collect(raw:unknown):Promise<MarketOperation>{return this.acquire(raw,true);}
 private async acquire(raw:unknown,collect:boolean):Promise<MarketOperation>{
  const a=object(raw,collect?['pack_id','release_id','operation_id','ref']:['pack_id','release_id','operation_id']);const identity={origin:this.origin,operation_id:id(a.operation_id),pack_id:id(a.pack_id),release_id:id(a.release_id),...(collect?{ref:expressionRef(a.ref)}:{})};
  const previous=this.store.marketRead<MarketOperation>(`operation:${identity.operation_id}`);
  if(previous){const {status,error,last_checked_at,...prior}=previous;if(!isDeepStrictEqual(prior,identity))fail('OPERATION_CONFLICT','operation 已绑定其他选择');return previous;}
  this.store.marketWrite(`operation:${identity.operation_id}`,{...identity,status:'pending'});
  try{
   const before=await this.detail({pack_id:identity.pack_id,release_id:identity.release_id});const bytes=await this.request(this.path(identity.pack_id,identity.release_id)+'/archive');
   if(createHash('sha256').update(bytes).digest('hex')!==before.archive_sha256)fail('DIGEST_MISMATCH','下载摘要与已预览版本不符');
   await withValidatedPack(bytes,async pack=>{if(!isDeepStrictEqual(pack.manifest,before.manifest))fail('RELEASE_CONFLICT','下载内容与发布清单不符');await this.store.marketCommit(pack,{...identity,origin:this.origin,digest:before.archive_sha256},async()=>{const after=await this.detail({pack_id:identity.pack_id,release_id:identity.release_id});if(after.archive_sha256!==before.archive_sha256||!isDeepStrictEqual(after.manifest,before.manifest))fail('DIGEST_MISMATCH','提交前发布内容发生变化');});},'market');
  }catch(error){this.store.marketWrite(`operation:${identity.operation_id}`,{...identity,status:'failed',error:(error as {code?:string}).code??'MARKET_UNAVAILABLE'});throw error;}
  return this.installStatus({operation_id:identity.operation_id});
 }
 async installStatus(raw:unknown):Promise<MarketOperation>{const a=object(raw,['operation_id']);return this.store.marketRead<MarketOperation>(`operation:${id(a.operation_id)}`)??fail('OPERATION_NOT_FOUND','没有此 operation，请勿自动重试');}
 async remove(raw:unknown){const a=object(raw,['pack_id']);this.store.marketRemove(id(a.pack_id));return this.local({});}
 async uncollect(raw:unknown){const a=object(raw,['ref']);this.store.marketUncollect(expressionRef(a.ref));return this.local({});}
 async local(raw:unknown){object(raw,[]);return {revocations:this.revocationStatus(),installs:this.store.marketInstalls().filter(i=>i.state==='installed').map(i=>({...i,manifest:this.store.getPack(i.release_id)})),collections:this.store.marketCollections()};}
 async updateCheck(raw:unknown){const a=object(raw,['pack_id']);const next=await this.detail({pack_id:id(a.pack_id)});const current=this.store.marketInstalls().find(i=>i.state==='installed'&&this.store.getPack(i.release_id).pack_id===a.pack_id);const old=current?this.store.getPack(current.release_id):undefined;return {current:old??null,next,changed:old?.release_id!==next.release_id,semantics:{before:old?.expressions.map(e=>({act:e.realizes,name:e.name,semantics:e.semantics}))??[],after:next.manifest.expressions.map(e=>({act:e.realizes,name:e.name,semantics:e.semantics}))},effects:{before:old?.effects??[],after:next.manifest.effects??[]},enabled:false};}
 async visual(raw:unknown){const a=object(raw,['pack_id','release_id','digest']);if(!/^[a-f0-9]{64}$/.test(String(a.digest)))fail('INVALID_ARGUMENT','无效素材摘要');const detail=await this.detail({pack_id:id(a.pack_id),release_id:id(a.release_id)});const blob=detail.manifest.expressions.flatMap(e=>[e.visual.primary,e.visual.poster]).find(b=>b?.sha256===a.digest);if(!blob)fail('REVISION_NOT_FOUND','素材不属于发布');const bytes=await this.request(this.path(detail.pack_id,detail.release_id)+'/media/'+blob.sha256,1024*1024);if(createHash('sha256').update(bytes).digest('hex')!==blob.sha256)fail('DIGEST_MISMATCH','图片摘要不符');return `data:${blob.mime};base64,${bytes.toString('base64')}`;}
}
