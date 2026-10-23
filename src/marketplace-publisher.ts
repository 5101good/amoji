import {mkdir,chmod,lstat,readFile,writeFile,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import type {AdapterRuntime} from './adapter-runtime.js';
import {exportManifest,withValidatedPack} from './packs.js';
import type {Pack} from './protocol/index.js';
import {fail,object,nonempty} from './shared-contract.js';
export const MARKET_ORIGIN='https://amoji.ai-web.ai';
type Tokens={access_token:string;refresh_token:string;account_id:string;device_id:string;expires_at:number;refreshing?:boolean};
type Pair={id:string;device_secret:string;user_code:string;device_name:string;expires_at:number;verification_uri:string;next_poll:number};
type Credentials={origin:string;tokens?:Tokens;pair?:Pair};
export type PublisherDraft={id:string;version:number;step:number;source_release_id:string;manifest:Pack;account_id?:string;pack_id?:string;state:'draft'|'uploading'|'uploaded'|'unknown'|'submitted';unknown_absent?:boolean;reserve_operation:string;authorize_operation:string;complete_operation:string;submit_operation:string;upload?:{id:string;pack_id:string;release_id:string;version:number;row_version:number;state:string};submission?:{id:string;pack_id:string;release_id:string;version:number;state:string;reason:string|null;row_version:number}};
/** Credentials stay host-owned; RPC returns public draft snapshots only. All mutations serialize. */
export class MarketplacePublisher{
 private tail:Promise<unknown>=Promise.resolve();
 constructor(private directory:string,private runtime:{packs?:{getPack(releaseId:string):Promise<Pack>};readBlob?:AdapterRuntime['readBlob']},private origin=MARKET_ORIGIN,private fetcher:typeof fetch=fetch,private now=Date.now){const u=new URL(origin);if(u.origin!==origin||!(u.protocol==='https:'||(u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname))))throw Error('INVALID_MARKET_ORIGIN');}
 call(method:string,raw:unknown):Promise<any>{const work=this.tail.then(()=>this.execute(method,raw));this.tail=work.catch(()=>{});return work;}
 private async read<T>(name:string,fallback:T):Promise<T>{try{return JSON.parse(await readFile(join(this.directory,name),'utf8')) as T;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return fallback;throw e;}}
 private async write(name:string,value:unknown){const tmp=join(this.directory,'.'+randomUUID());try{await writeFile(tmp,JSON.stringify(value),{mode:0o600,flag:'wx'});await rename(tmp,join(this.directory,name));}finally{await rm(tmp,{force:true});}}
 private async init(){await mkdir(this.directory,{recursive:true,mode:0o700});if(!(await lstat(this.directory)).isDirectory())fail('PUBLISHER_STORAGE','发布存储不可用');await chmod(this.directory,0o700);}
 private async credentials(){const c=await this.read<Credentials>('credentials.json',{origin:this.origin});if(c.origin!==this.origin)fail('PUBLISHER_ORIGIN','市场地址已变化，请使用独立发布目录');return c;}
 private async request(path:string,data?:object,token?:string,headers:Record<string,string>={}){
  let r:Response;try{r=await this.fetcher(this.origin+'/v1/'+path,{method:data===undefined?'GET':'POST',headers:{...(data===undefined?{}:{'content-type':'application/json'}),...(token?{authorization:'Bearer '+token}:{}),...headers},...(data===undefined?{}:{body:JSON.stringify(data)}),redirect:'error',signal:AbortSignal.timeout(30000)});}catch{fail('PUBLISHER_OFFLINE','网络中断，请恢复后核对原操作');}
  let value:any;try{value=await r!.json();}catch{fail('PUBLISHER_OFFLINE','响应无法核对，请恢复后查询');}
  if(!r!.ok){const code=typeof value?.error?.code==='string'&&/^[A-Z_]{1,64}$/.test(value.error.code)?value.error.code:'PUBLISHER_REQUEST';fail(code,'市场请求未完成，请保留草稿并核对');}return value;
 }
 private async token(){const c=await this.credentials();if(!c.tokens||c.tokens.refreshing)fail('PUBLISHER_LOGIN','请在浏览器重新授权，草稿已保留');if(c.tokens.expires_at>this.now()+10000)return c.tokens;
  const old=c.tokens;c.tokens={...old,refreshing:true};await this.write('credentials.json',c);
  // A lost rotation response is not safely replayable. Persist the uncertainty first.
  const value=await this.request('device-tokens/refresh',{refresh_token:old.refresh_token});c.tokens=this.tokens(value);await this.write('credentials.json',c);return c.tokens;
 }
 private tokens(value:any):Tokens{if(!/^[a-f0-9]{64}$/.test(value.access_token)||!/^[a-f0-9]{64}$/.test(value.refresh_token)||typeof value.account_id!=='string'||typeof value.device_id!=='string'||value.expires_in!==900)fail('PUBLISHER_LOGIN','授权响应无效');return{access_token:value.access_token,refresh_token:value.refresh_token,account_id:value.account_id,device_id:value.device_id,expires_at:this.now()+900000};}
 private async execute(method:string,raw:unknown):Promise<any>{
  await this.init();const schemas:Record<string,string[]>={beginLogin:['device_name'],loginStatus:[],cancelLogin:[],logout:[],drafts:[],create:['release_id','revise_id'],save:['id','version','step','name','description','license','creator','source','effects'],upload:['id'],submit:['id','rights_confirmed'],retrySubmit:['id','rights_confirmed'],reconcile:['id'],submissions:[],withdraw:['id']};
  if(!schemas[method])fail('INVALID_ARGUMENT','未知发布操作');const a=object(raw,schemas[method]!,[]);
  if(method==='beginLogin'){
   const c=await this.credentials();if(c.pair)await this.request(`device-authorizations/${c.pair.id}/cancel`,{device_secret:c.pair.device_secret});
   const value=await this.request('device-authorizations',{device_name:nonempty(a.device_name)});c.pair={...value,next_poll:this.now()+5000};await this.write('credentials.json',c);return this.pairView(c.pair!);
  }
  if(method==='loginStatus'){
   const c=await this.credentials();if(c.pair){
    if(c.pair.expires_at<=this.now()){delete c.pair;await this.write('credentials.json',c);return{state:'expired'};}
    if(c.pair.next_poll>this.now())return this.pairView(c.pair);
    c.pair.next_poll=this.now()+5000;await this.write('credentials.json',c);
    try{const result=await this.request(`device-authorizations/${c.pair.id}/token`,{device_secret:c.pair.device_secret});if(result.state==='pending')return this.pairView(c.pair);c.tokens=this.tokens(result);delete c.pair;await this.write('credentials.json',c);}catch(e){if((e as {code?:string}).code==='PAIRING_EXPIRED'){delete c.pair;await this.write('credentials.json',c);return{state:'expired'};}throw e;}
   }
   return c.tokens&&!c.tokens.refreshing?{state:'authenticated',account_id:c.tokens.account_id}:{state:'signed_out'};
  }
  if(method==='cancelLogin'){
   const c=await this.credentials();if(c.pair)await this.request(`device-authorizations/${c.pair.id}/cancel`,{device_secret:c.pair.device_secret});delete c.pair;await this.write('credentials.json',c);return{state:'cancelled'};
  }
  if(method==='logout'){
   const c=await this.credentials();if(c.tokens){try{await this.request('device-tokens/revoke',{refresh_token:c.tokens.refresh_token});}catch(e){if(!['PUBLISHER_LOGIN','UNAUTHENTICATED'].includes((e as {code:string}).code))throw e;}}
   if(c.pair)await this.request(`device-authorizations/${c.pair.id}/cancel`,{device_secret:c.pair.device_secret});await this.write('credentials.json',{origin:this.origin});return{state:'signed_out'};
  }
  const drafts=await this.read<PublisherDraft[]>('drafts.json',[]);
  if(method==='drafts')return drafts;
  const save=async(d:PublisherDraft)=>{d.version++;await this.write('drafts.json',drafts);return d;};
  if(method==='create'){
   if(!this.runtime.packs)fail('CAPABILITY_UNAVAILABLE','本地表情包不可用');const source=await this.runtime.packs.getPack(nonempty(a.release_id));
   const old=a.revise_id?drafts.find(d=>d.id===a.revise_id):undefined;
   if(a.revise_id&&(!old||!old.submission||!['changes_requested','published','withdrawn'].includes(old.submission.state)))fail('PUBLISHER_STATE','请先核对投稿状态');
   const d:PublisherDraft={id:randomUUID(),version:1,step:1,source_release_id:source.release_id,manifest:source,state:'draft',reserve_operation:randomUUID(),authorize_operation:randomUUID(),complete_operation:randomUUID(),submit_operation:randomUUID(),...(old?{pack_id:old.submission!.pack_id,account_id:old.account_id}:{})};drafts.unshift(d);await this.write('drafts.json',drafts);return d;
  }
  if(method==='submissions'){const token=await this.token();return this.request('me/submissions',undefined,token.access_token);}
  const d=drafts.find(d=>d.id===a.id);if(!d)fail('PUBLISHER_DRAFT','找不到发布草稿');
  if(method==='save'){
   if(d.state!=='draft'||a.version!==d.version)fail('PUBLISHER_CONFLICT','草稿已变化，请重新打开');
   if(!Number.isInteger(a.step)||Number(a.step)<1||Number(a.step)>3)fail('INVALID_ARGUMENT','无效向导步骤');
   if(!Array.isArray(a.effects)||a.effects.some(id=>typeof id!=='string'))fail('INVALID_ARGUMENT','无效效果选择');
   const original=await this.runtime.packs!.getPack(d.source_release_id);const ids=a.effects as string[];
   if(ids.some(id=>!(original.effects??[]).some(x=>x.effect_revision_id===id)))fail('INVALID_ARGUMENT','效果不属于选择的本地包');
   for(const key of ['license','creator','source'])if(typeof a[key]!=='string'||Buffer.byteLength(a[key] as string)>4096)fail('INVALID_ARGUMENT','发布说明过长或无效');
   // A plain string applies to every language the pack declares; a map must cover them all.
   const localized=(value:unknown,max:number):Record<string,string>=>{const map=typeof value==='string'?Object.fromEntries(original.locales.map(l=>[l,value])):value;if(!map||typeof map!=='object'||Array.isArray(map)||original.locales.some(l=>typeof (map as Record<string,unknown>)[l]!=='string'||![...(map as Record<string,string>)[l]!.trim()].length||[...(map as Record<string,string>)[l]!].length>max))fail('INVALID_ARGUMENT','名称或说明需要覆盖包的全部语言');return Object.fromEntries(original.locales.map(l=>[l,(map as Record<string,string>)[l]!.trim()]));};
   const effects=(original.effects??[]).filter(x=>ids.includes(x.effect_revision_id));const kept=new Set(effects.map(e=>e.effect_id));
   const bindings=(original.bindings??[]).map(b=>({...b,effects:b.effects.filter(id=>kept.has(id))})).filter(b=>b.effects.length);
   const {effects:_,bindings:__,...rest}=original;
   d.manifest={...rest,name:localized(a.name,60),description:localized(a.description,280),rights:{license:a.license as string,...(a.creator?{creator:a.creator as string}:{}),...(a.source?{source:a.source as string}:{})},...(effects.length?{effects}:{}),...(bindings.length?{bindings}:{})};d.step=Number(a.step);return save(d);
  }
  const token=await this.token();if(d.account_id&&d.account_id!==token.account_id)fail('PUBLISHER_ACCOUNT','请使用原投稿账号');d.account_id=token.account_id;
  if(method==='upload'){
   if(['unknown','submitted'].includes(d.state))return this.reconcile(d,token,save);
   if(d.state==='uploaded')return d;
   if(!this.runtime.readBlob)fail('BLOB_UNAVAILABLE','素材不可用');
   if(d.state==='draft'){const preview=await exportManifest(d.manifest,b=>this.runtime.readBlob!(b.sha256));await withValidatedPack(preview,async()=>{},'market');}
   d.state='uploading';await save(d);
   if(!d.upload){const r=await this.request('uploads',d.pack_id?{pack_id:d.pack_id}:{},token.access_token,{'idempotency-key':d.reserve_operation});d.upload=r.upload;await save(d);}
   const u=d.upload!;const path=join(this.directory,d.id+'.amoji');let bytes:Buffer;
   try{bytes=await readFile(path);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;const m={...d.manifest,pack_id:u.pack_id,release_id:u.release_id,version:u.version,derived_from:{pack_id:d.manifest.pack_id,release_id:d.manifest.release_id},rights:{...d.manifest.rights,source:d.manifest.rights.source||`amoji:pack/${d.manifest.pack_id}/${d.manifest.release_id}`}};bytes=await exportManifest(m,b=>this.runtime.readBlob!(b.sha256));await withValidatedPack(bytes,async()=>{},'market');await writeFile(path,bytes,{mode:0o600,flag:'wx'});}
   const current=(await this.request('uploads/'+u.id,undefined,token.access_token)).upload;d.upload=current;await save(d);
   if(current.state!=='valid'){
    if(current.state==='reserved'){
     const auth=await this.request(`uploads/${u.id}/authorize`,{length:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')},token.access_token,{'idempotency-key':d.authorize_operation,'if-match':`"${current.row_version}"`});d.upload=auth.upload;await save(d);
     const url=new URL(auth.authorization.url);if(url.protocol!=='https:'||!url.hostname.endsWith('.r2.cloudflarestorage.com'))fail('PUBLISHER_UPLOAD_TARGET','上传目标无效');
     let response:Response;try{response=await this.fetcher(url,{method:'PUT',headers:auth.authorization.headers,body:new Uint8Array(bytes),redirect:'error',signal:AbortSignal.timeout(60000)});}catch{fail('PUBLISHER_OFFLINE','上传中断，可恢复原上传');}if(!response!.ok)fail('PUBLISHER_UPLOAD','上传未完成，可恢复原上传');
    }
    const result=await this.request(`uploads/${u.id}/complete`,{},token.access_token,{'idempotency-key':d.complete_operation,'if-match':`"${d.upload!.row_version}"`});d.upload=result.upload;await save(d);
   }
   if(d.upload?.state!=='valid')fail('PUBLISHER_VALIDATING','内容仍在校验，请核对原上传');d.state='uploaded';return save(d);
  }
  if(method==='reconcile')return this.reconcile(d,token,save);
  if(method==='retrySubmit'){
   if(d.state!=='unknown'||!d.unknown_absent||a.rights_confirmed!==true)fail('PUBLISHER_CONFIRM','请先核对原操作并确认重试');
   const reconciled=await this.reconcile(d,token,save);if(reconciled.state==='submitted')return reconciled;
   d.state='uploaded';delete d.unknown_absent;await save(d);
  }
  if(method==='submit'||method==='retrySubmit'){
   if(d.state==='unknown'||d.state==='submitted')return this.reconcile(d,token,save);
   if(d.state!=='uploaded'||!d.upload||a.rights_confirmed!==true)fail('PUBLISHER_CONFIRM','请完整预览并确认再投稿');
   d.state='unknown';await save(d);
   const result=await this.request('submissions',{upload_id:d.upload.id,rights_confirmed:true},token.access_token,{'idempotency-key':d.submit_operation,'if-match':`"${d.upload.row_version}"`});d.submission=result.submission;d.state='submitted';return save(d);
  }
  if(method==='withdraw'){
   if(!d.submission||d.submission.state!=='pending')fail('PUBLISHER_STATE','此版本不可撤回');
   // Persist a stable withdraw identity before dispatch and reconcile by it after uncertainty.
   const operation=d.id;const result=await this.request(`submissions/${d.submission.id}/withdraw`,{},token.access_token,{'idempotency-key':operation,'if-match':`"${d.submission.row_version}"`});d.submission=result.submission;return save(d);
  }
  fail('INVALID_ARGUMENT','未知发布操作');
 }
 private pairView(p:Pair){return{state:'pending',id:p.id,user_code:p.user_code,device_name:p.device_name,expires_at:p.expires_at,verification_uri:p.verification_uri};}
 private async reconcile(d:PublisherDraft,token:Tokens,save:(d:PublisherDraft)=>Promise<PublisherDraft>){
  if(d.state==='unknown'){try{const op=await this.request('operations/'+d.submit_operation,undefined,token.access_token);if(op.result?.submission){d.submission=op.result.submission;d.state='submitted';await save(d);}}catch(e){if((e as {code?:string}).code!=='NOT_FOUND')throw e;d.unknown_absent=true;await save(d);return d;}}
  if(d.submission){d.submission=(await this.request('me/submissions/'+d.submission.id,undefined,token.access_token)).submission;await save(d);}return d;
 }
}
