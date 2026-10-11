import type {Env} from './worker';
import {body,digest,failure,reply} from './upload-shared';
const opaque=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
const hash=(v:string)=>digest(new TextEncoder().encode(v));
const valid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
type Pair={id:string;secret_hash:string;user_code:string;device_name:string;expires_at:number;polled_at:number;owner:string|null;state:string};
type Family={id:string;owner:string;device_name:string;refresh_hash:string;refresh_expires:number;revoked:number};
export async function deviceActor(request:Request,env:Env){
 const value=request.headers.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];if(!value)return null;
 return env.DB.prepare('SELECT a.id,a.display_name FROM market_device_family f JOIN market_account a ON a.id=f.owner WHERE f.access_hash=? AND f.access_expires>? AND f.refresh_expires>? AND f.revoked=0 AND a.disabled=0').bind(await hash(value),Date.now(),Date.now()).first<{id:string;display_name:string}>();
}
export async function revokeDevices(env:Env,owner:string){await env.DB.prepare('UPDATE market_device_family SET revoked=1 WHERE owner=?').bind(owner).run();await env.DB.prepare("UPDATE market_device_authorization SET state='cancelled' WHERE owner=? AND state='approved'").bind(owner).run();}
export async function deviceRoute(request:Request,env:Env,owner?:string):Promise<Response>{
 const path=new URL(request.url).pathname,now=Date.now();
 try{
 if(path==='/v1/device-authorizations'&&request.method==='POST'){
  const data=await body(request);if(Object.keys(data).some(k=>k!=='device_name')||typeof data.device_name!=='string'||!data.device_name.trim()||data.device_name.length>80)return failure('INVALID_BODY',400);
  const ip=request.headers.get('x-amoji-edge-ip');if(!ip)return failure('UNTRUSTED_PROXY',403);
  const count=await env.DB.prepare('INSERT INTO auth_rate_limit(key,bucket,count) VALUES(?,?,1) ON CONFLICT(key,bucket) DO UPDATE SET count=count+1 RETURNING count').bind('device:'+await hash(ip),Math.floor(now/3600000)).first<{count:number}>();
  if(!count||count.count>10)return failure('RATE_LIMITED',429);
  const secret=opaque(),id=crypto.randomUUID(),code=opaque().slice(0,8).toUpperCase(),expires=now+300000;
  await env.DB.prepare('INSERT INTO market_device_authorization(id,secret_hash,user_code,device_name,expires_at) VALUES(?,?,?,?,?)').bind(id,await hash(secret),code,data.device_name.trim(),expires).run();
  return reply({id,device_secret:secret,user_code:code,device_name:data.device_name.trim(),expires_at:expires,interval:5,verification_uri:env.APP_ORIGIN+'/device?authorization='+id},201);
 }
 const match=/^\/v1\/device-authorizations\/([0-9a-f-]{36})(?:\/(approve|token|cancel))?$/.exec(path);
 if(match){
  const p=await env.DB.prepare('SELECT * FROM market_device_authorization WHERE id=?').bind(match[1]).first<Pair>();
  if(!p)return failure('NOT_FOUND',404);
  if(request.method==='GET'&&!match[2])return owner?reply({id:p.id,user_code:p.user_code,device_name:p.device_name,expires_at:p.expires_at,state:p.state}):failure('UNAUTHENTICATED',401);
  if(request.method!=='POST')return failure('NOT_FOUND',404);
  const data=await body(request);
  if(match[2]==='approve'){
   if(!owner)return failure('UNAUTHENTICATED',401);
   if(Object.keys(data).some(k=>!['user_code','approved'].includes(k))||data.approved!==true||data.user_code!==p.user_code)return failure('INVALID_BODY',400);
   const changed=await env.DB.prepare("UPDATE market_device_authorization SET owner=?,state='approved' WHERE id=? AND state='pending' AND expires_at>? AND EXISTS(SELECT 1 FROM market_account WHERE id=? AND disabled=0)").bind(owner,p.id,now,owner).run();
   return changed.meta.changes===1?reply({approved:true}):failure('PAIRING_EXPIRED',410);
  }
  if(Object.keys(data).some(k=>k!=='device_secret')||!valid(data.device_secret)||await hash(data.device_secret)!==p.secret_hash)return failure('UNAUTHENTICATED',401);
  if(match[2]==='cancel'){
   await env.DB.batch([env.DB.prepare("UPDATE market_device_authorization SET state='cancelled' WHERE id=?").bind(p.id),env.DB.prepare('UPDATE market_device_family SET revoked=1 WHERE id=?').bind(p.id)]);return reply({cancelled:true});
  }
  if(match[2]!=='token')return failure('NOT_FOUND',404);
  if(p.expires_at<=now||['redeemed','cancelled'].includes(p.state))return failure('PAIRING_EXPIRED',410);
  if(now-p.polled_at<5000)return failure('POLL_TOO_FAST',429);
  await env.DB.prepare('UPDATE market_device_authorization SET polled_at=? WHERE id=?').bind(now,p.id).run();
  if(p.state==='pending')return reply({state:'pending'},202);
  const access=opaque(),refresh=opaque(),ah=await hash(access),rh=await hash(refresh);
  await env.DB.batch([
   env.DB.prepare("INSERT INTO market_device_family(id,owner,device_name,access_hash,access_expires,refresh_hash,refresh_expires) SELECT id,owner,device_name,?,?,?,? FROM market_device_authorization WHERE id=? AND state='approved' AND expires_at>? AND EXISTS(SELECT 1 FROM market_account WHERE id=owner AND disabled=0)").bind(ah,now+900000,rh,now+2592000000,p.id,now),
   env.DB.prepare('INSERT INTO market_device_refresh(hash,family) SELECT refresh_hash,id FROM market_device_family WHERE id=? AND access_hash=?').bind(p.id,ah),
   env.DB.prepare("UPDATE market_device_authorization SET state='redeemed' WHERE id=? AND EXISTS(SELECT 1 FROM market_device_family WHERE id=? AND access_hash=?)").bind(p.id,p.id,ah)
  ]);
  const issued=await env.DB.prepare('SELECT id FROM market_device_family WHERE id=? AND access_hash=?').bind(p.id,ah).first();
  return issued?reply({access_token:access,refresh_token:refresh,expires_in:900,refresh_expires_in:2592000,scope:['creator'],device_id:p.id,account_id:p.owner}):failure('UNAUTHENTICATED',401);
 }
 if(path==='/v1/device-tokens/refresh'&&request.method==='POST'){
  const data=await body(request);if(Object.keys(data).some(k=>k!=='refresh_token')||!valid(data.refresh_token))return failure('UNAUTHENTICATED',401);
  const oldHash=await hash(data.refresh_token),f=await env.DB.prepare('SELECT f.* FROM market_device_refresh r JOIN market_device_family f ON f.id=r.family WHERE r.hash=?').bind(oldHash).first<Family>();
  if(!f)return failure('UNAUTHENTICATED',401);
  if(f.refresh_hash!==oldHash){await env.DB.prepare('UPDATE market_device_family SET revoked=1 WHERE id=?').bind(f.id).run();return failure('UNAUTHENTICATED',401);}
  if(f.revoked||f.refresh_expires<=now)return failure('UNAUTHENTICATED',401);
  const access=opaque(),refresh=opaque(),ah=await hash(access),rh=await hash(refresh);
  await env.DB.batch([
   env.DB.prepare('UPDATE market_device_family SET access_hash=?,access_expires=?,refresh_hash=?,refresh_expires=? WHERE id=? AND refresh_hash=? AND revoked=0 AND refresh_expires>? AND EXISTS(SELECT 1 FROM market_account WHERE id=owner AND disabled=0)').bind(ah,now+900000,rh,now+2592000000,f.id,oldHash,now),
   env.DB.prepare('INSERT INTO market_device_refresh(hash,family) SELECT refresh_hash,id FROM market_device_family WHERE id=? AND refresh_hash=?').bind(f.id,rh),
   env.DB.prepare('UPDATE market_device_refresh SET used=1 WHERE hash=? AND EXISTS(SELECT 1 FROM market_device_family WHERE id=? AND refresh_hash=?)').bind(oldHash,f.id,rh)
  ]);
  const issued=await env.DB.prepare('SELECT id FROM market_device_family WHERE id=? AND access_hash=?').bind(f.id,ah).first();
  return issued?reply({access_token:access,refresh_token:refresh,expires_in:900,refresh_expires_in:2592000,scope:['creator'],device_id:f.id,account_id:f.owner}):failure('UNAUTHENTICATED',401);
 }
 if(path==='/v1/device-tokens/revoke'&&request.method==='POST'){
  const data=await body(request);if(Object.keys(data).some(k=>k!=='refresh_token')||!valid(data.refresh_token))return failure('UNAUTHENTICATED',401);
  const result=await env.DB.prepare('UPDATE market_device_family SET revoked=1 WHERE id IN (SELECT family FROM market_device_refresh WHERE hash=?)').bind(await hash(data.refresh_token)).run();return result.meta.changes?reply({revoked:true}):failure('UNAUTHENTICATED',401);
 }
 return failure('NOT_FOUND',404);
 }catch(e){return failure(e instanceof SyntaxError||String(e).includes('INVALID_BODY')?'INVALID_BODY':'DEVICE_UNAVAILABLE',e instanceof SyntaxError||String(e).includes('INVALID_BODY')?400:503);}
}
