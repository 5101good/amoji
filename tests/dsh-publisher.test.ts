import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,stat,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DshPublisher} from '../src/dsh/publisher.js';
import type {AdapterRuntime} from '../src/adapter-runtime.js';
test('Host pairing persists privately, polls at five seconds, never returns tokens and cancels safely',async t=>{
 const root=await mkdtemp(join(tmpdir(),'amoji-publisher-'));t.after(()=>rm(root,{recursive:true,force:true}));let now=1000,calls=0;
 const secret='f'.repeat(64),access='a'.repeat(64),refresh='b'.repeat(64);
 const request:typeof fetch=async(input)=>{const path=new URL(String(input)).pathname;calls++;if(path.endsWith('/device-authorizations'))return Response.json({id:'pair',device_secret:secret,user_code:'ABCD1234',device_name:'dsh',expires_at:301000,verification_uri:'https://market.test/device?authorization=pair',interval:5});if(path.endsWith('/token'))return Response.json({access_token:access,refresh_token:refresh,expires_in:900,refresh_expires_in:2592000,account_id:'owner',device_id:'pair',scope:['creator']});return Response.json({revoked:true});};
 const publisher=new DshPublisher(root,{} as AdapterRuntime,'https://market.test',request,()=>now);
 const p=await publisher.call('beginLogin',{device_name:'dsh'});assert.equal(p.user_code,'ABCD1234');assert.equal(JSON.stringify(p).includes(secret),false);
 assert.equal((await publisher.call('loginStatus',{})).state,'pending');assert.equal(calls,1);
 now+=5000;assert.equal((await publisher.call('loginStatus',{})).state,'authenticated');assert.equal(calls,2);
 assert.equal((await stat(root)).mode&0o777,0o700);assert.equal((await stat(join(root,'credentials.json'))).mode&0o777,0o600);
 const restored=new DshPublisher(root,{} as AdapterRuntime,'https://market.test',request,()=>now);
 const state=await restored.call('loginStatus',{});assert.equal(state.state,'authenticated');assert.equal(JSON.stringify(state).includes(access),false);
 await restored.call('logout',{});assert.equal((await restored.call('loginStatus',{})).state,'signed_out');assert.equal((await readFile(join(root,'credentials.json'),'utf8')).includes(refresh),false);
});
import {SharedClient,stopSharedService} from '../src/shared-client.js';
import {ConnectedRuntime} from '../src/adapter-runtime.js';
import {randomUUID} from 'node:crypto';
import {withValidatedPack} from '../src/packs.js';
test('publishing persists steps, sends selected bytes only, reconciles unknown once and revises a returned release',async t=>{
 const root=await mkdtemp(join(tmpdir(),'amoji-publishing-'));const c=await SharedClient.connect({directory:join(root,'library')});t.after(async()=>{await c.close();await stopSharedService(join(root,'library'),c.identity.serviceId);await rm(root,{recursive:true,force:true});});
 const expressions=await c.list();const selected=expressions[0]!;const local=await c.createScenarioDraft([{asset_id:selected.asset_id,revision_id:selected.revision_id}]);const source=await c.confirmScenarioDraft(local.draft_id,local.version);
 let now=1000,submitCount=0,uploaded:Uint8Array|undefined,operation='',review='pending';const calls:string[]=[];let version=0;let upload:any;let submission:any;
 const transport:typeof fetch=async(input,init)=>{
  const u=new URL(String(input));calls.push(u.pathname);const body=init?.body&&typeof init.body==='string'?JSON.parse(init.body):{};
  if(u.hostname.endsWith('r2.cloudflarestorage.com')){assert.equal((init?.headers as any)?.authorization,undefined);uploaded=init?.body as Uint8Array;return new Response('',{status:200});}
  if(u.pathname==='/v1/device-authorizations')return Response.json({id:randomUUID(),device_secret:'f'.repeat(64),user_code:'ABC12345',device_name:'test',expires_at:301000,verification_uri:'https://market.test/device',interval:5});
  if(u.pathname.endsWith('/token'))return Response.json({access_token:'a'.repeat(64),refresh_token:'b'.repeat(64),expires_in:900,account_id:'owner',device_id:'device'});
  if(u.pathname==='/v1/uploads'){upload={id:randomUUID(),pack_id:body.pack_id??randomUUID(),release_id:randomUUID(),version:++version,row_version:1,state:'reserved'};return Response.json({upload});}
  if(u.pathname.endsWith('/authorize')){upload={...upload,row_version:2};return Response.json({upload,authorization:{url:'https://account.r2.cloudflarestorage.com/bucket/selected',headers:{'content-type':'application/zip'}}});}
  if(u.pathname.endsWith('/complete')){upload={...upload,row_version:4,state:'valid'};return Response.json({upload});}
  if(u.pathname.startsWith('/v1/uploads/'))return Response.json({upload});
  if(u.pathname==='/v1/submissions'){submitCount++;operation=(init?.headers as Record<string,string>)['idempotency-key']!;submission={id:randomUUID(),pack_id:upload.pack_id,release_id:upload.release_id,version:upload.version,state:'pending',reason:null,row_version:1};throw Error('synthetic lost response');}
  if(u.pathname.startsWith('/v1/operations/')){assert.equal(u.pathname,'/v1/operations/'+operation);return Response.json({status:201,result:{submission}});}
  if(u.pathname.startsWith('/v1/me/submissions/'))return Response.json({submission:{...submission,state:review,reason:review==='changes_requested'?'补充说明':null}});
  throw Error('Unexpected route '+u.pathname);
 };
 const dir=join(root,'publisher'),p=new DshPublisher(dir,new ConnectedRuntime(c),'https://market.test',transport,()=>now);
 await p.call('beginLogin',{device_name:'test'});now+=5000;await p.call('loginStatus',{});
 let draft=await p.call('create',{release_id:source.release_id});draft=await p.call('save',{id:draft.id,version:draft.version,step:3,name:'只发布选择项',description:'公开说明',license:'CC0-1.0',creator:'测试创作者',source:'自己创作',actions:[]});
 const restored=new DshPublisher(dir,new ConnectedRuntime(c),'https://market.test',transport,()=>now);assert.equal((await restored.call('drafts',{}))[0].step,3);
 draft=await restored.call('upload',{id:draft.id});assert.equal(draft.state,'uploaded');assert.ok(uploaded);await withValidatedPack(uploaded!,async pack=>{assert.equal(pack.manifest.expressions.length,1);assert.equal(pack.manifest.expressions[0]!.revision_id,selected.revision_id);assert.equal('credentials' in pack.manifest,false);},'market');
 await assert.rejects(restored.call('submit',{id:draft.id,rights_confirmed:true}),/网络中断/);assert.equal((await restored.call('drafts',{}))[0].state,'unknown');
 draft=await restored.call('submit',{id:draft.id,rights_confirmed:true});assert.equal(draft.state,'submitted');assert.equal(submitCount,1);
 review='changes_requested';draft=await restored.call('reconcile',{id:draft.id});assert.equal(draft.submission.reason,'补充说明');const revision=await restored.call('create',{release_id:source.release_id,revise_id:draft.id});assert.equal(revision.pack_id,draft.submission.pack_id);assert.notEqual(revision.submit_operation,draft.submit_operation);assert.equal(revision.state,'draft');
});
