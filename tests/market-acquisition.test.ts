import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { LibraryStore } from '../src/library-store.js';
import { exportManifest } from '../src/packs.js';
import { LocalAcquisition } from '../src/local-acquisition.js';
import type { Effect, Expression, Pack } from '../src/protocol/index.js';
import { SEEDS as seed } from './helpers/store-runtime.js';
const both=(zh:string,en:string)=>({'zh-CN':zh,en});
/** A bilingual 0.1 pack around exact expressions. */
const packOf=(name:string,expressions:Expression[],extra:Partial<Pack>={}):Pack=>({kind:'amoji.pack',amoji:'0.1',pack_id:randomUUID(),release_id:randomUUID(),version:1,original_locale:'zh-CN',locales:['zh-CN','en'],name:both(name,name),description:both(name,name),expressions,rights:{license:'CC0-1.0',creator:'test'},...extra});
const habit=(title:string):Effect=>({effect_id:randomUUID(),effect_revision_id:randomUUID(),kind:'template',template:'response-organization@1',config:{layout:'answer-first'},title:both(title,title),summary:both(title,title)});
/** Rule choices that come from one test pack, ignoring the built-in packs' effects. */
const choicesOf=(store:LibraryStore,context:{host:'dsh';hostInstanceId:string;sessionId:string},packId:string)=>store.ruleChoices(context).filter(c=>c.source.pack_id===packId);
const target=(e:Expression)=>({asset_id:e.asset_id,revision_id:e.revision_id});
test('LocalAcquisition: verified atomic install, collection ownership, update and operation reconciliation',async t=>{
 const root=await mkdtemp(join(tmpdir(),'amoji-market-')); const store=await LibraryStore.open(root,seed);t.after(async()=>{store.close();await rm(root,{recursive:true,force:true});});
 const original=store.list()[0]!;const expression={...original,asset_id:randomUUID(),revision_id:randomUUID(),name:both('市场测试','Market test')};
 let pack=packOf('测试包',[expression]);
 let bytes=await exportManifest(pack,b=>readFile(join(root,'blobs',b.sha256)));let digest=createHash('sha256').update(bytes).digest('hex');let offline=false,bad=false,checks=0,removed=false;
 const fetcher:typeof fetch=async input=>{if(offline)throw Error('offline');const url=String(input);if(url.endsWith('/archive'))return new Response(new Uint8Array(bad?Buffer.from('bad'):bytes));checks++;if(removed&&checks%2===0)return new Response('',{status:410});return Response.json({pack_id:pack.pack_id,release_id:pack.release_id,archive_sha256:digest,manifest:pack});};
 const market=new LocalAcquisition(store,'https://market.test',fetcher);const op=randomUUID();
 const result=await market.install({pack_id:pack.pack_id,release_id:pack.release_id,operation_id:op});assert.equal(result.status,'committed');assert.equal(checks,2);assert.ok(store.list().some(e=>e.asset_id===expression.asset_id));
 assert.deepEqual(await market.install({pack_id:pack.pack_id,release_id:pack.release_id,operation_id:op}),result);assert.equal(checks,2);
 await market.collect({pack_id:pack.pack_id,release_id:pack.release_id,ref:{asset_id:expression.asset_id,revision_id:expression.revision_id},operation_id:randomUUID()});await market.remove({pack_id:pack.pack_id});assert.ok(store.list().some(e=>e.asset_id===expression.asset_id));
 await market.uncollect({ref:{asset_id:expression.asset_id,revision_id:expression.revision_id}});assert.ok(!store.list().some(e=>e.asset_id===expression.asset_id));assert.deepEqual(store.resolve(expression),expression);
 bad=true;await assert.rejects(market.install({pack_id:pack.pack_id,release_id:pack.release_id,operation_id:randomUUID()}),/DIGEST/);assert.ok(!store.list().some(e=>e.asset_id===expression.asset_id));bad=false;
 removed=true;checks=0;await assert.rejects(market.install({pack_id:pack.pack_id,release_id:pack.release_id,operation_id:randomUUID()}),/RELEASE/);assert.ok(!store.list().some(e=>e.asset_id===expression.asset_id));removed=false;
 await market.install({pack_id:pack.pack_id,release_id:pack.release_id,operation_id:randomUUID()});offline=true;assert.ok(store.list().some(e=>e.asset_id===expression.asset_id));assert.equal((await market.installStatus({operation_id:op})).status,'committed');
});
test('LocalAcquisition: atomic updates preserve old selections on faults and disable old rules; retained imports survive removal',async t=>{
 const root=await mkdtemp(join(tmpdir(),'amoji-market-update-'));const store=await LibraryStore.open(root,seed);t.after(async()=>{store.close();await rm(root,{recursive:true,force:true});});
 const e={...store.list()[0]!,asset_id:randomUUID(),revision_id:randomUUID()};const effect=habit('先说答案');
 const one=packOf('更新测试',[e],{effects:[effect],bindings:[{target:target(e),effects:[effect.effect_id]}]});
 const e2={...e,revision_id:randomUUID(),semantics:{...e.semantics,'zh-CN':{...e.semantics['zh-CN']!,meaning:'新版本固定语义'}}};const {effects:_e,bindings:_b,...plain}=one;const two:Pack={...plain,release_id:randomUUID(),version:2,expressions:[e2]};
 let current:Pack=one,fault=false,replaceDigest=false,details=0;const packs=new Map<string,Buffer>();for(const p of [one,two])packs.set(p.release_id,await exportManifest(p,b=>readFile(join(root,'blobs',b.sha256))));
 const fetcher:typeof fetch=async input=>{const path=String(input);const p=path.includes(two.release_id)?two:path.includes(one.release_id)?one:current;const bytes=packs.get(p.release_id)!;if(path.endsWith('/archive')){if(fault)throw Error('connection reset');return new Response(new Uint8Array(bytes));}details++;return Response.json({pack_id:p.pack_id,release_id:p.release_id,manifest:p,archive_sha256:replaceDigest&&details%2===0?'0'.repeat(64):createHash('sha256').update(bytes).digest('hex')});};
 const collection=new LocalAcquisition(store,'https://market.test',fetcher);const onlyRef={asset_id:e.asset_id,revision_id:e.revision_id};
 await collection.collect({pack_id:one.pack_id,release_id:one.release_id,ref:onlyRef,operation_id:randomUUID()});
 const collectionContext={host:'dsh' as const,hostInstanceId:'collection-host',sessionId:'collection-session'};
 store.changeRules(collectionContext,{kind:'enable',generation:0,selection:choicesOf(store,collectionContext,one.pack_id)[0]!.selection,replace:null,checkpoint:{version:1,profile:'collection-host',session:'collection-session',createdAt:1,rules:[],intents:[]}});
 const twin={...one,pack_id:randomUUID(),release_id:randomUUID()};packs.set(twin.release_id,await exportManifest(twin,b=>readFile(join(root,'blobs',b.sha256))));current=twin;
 await collection.collect({pack_id:twin.pack_id,release_id:twin.release_id,ref:onlyRef,operation_id:randomUUID()});assert.equal(store.rules(collectionContext).rules[0]!.enabled,false,'replacing last collection source disables the prior release');current=one;
 await collection.uncollect({ref:onlyRef});assert.equal(store.rules(collectionContext).rules[0]!.enabled,false,'last collection removal disables rules');assert.equal(choicesOf(store,collectionContext,one.pack_id).length+choicesOf(store,collectionContext,twin.pack_id).length,0,'removed collection cannot reactivate rules');
 await collection.collect({pack_id:one.pack_id,release_id:one.release_id,ref:onlyRef,operation_id:randomUUID()});assert.equal(choicesOf(store,collectionContext,one.pack_id).length,1);
 const m=new LocalAcquisition(store,'https://market.test',fetcher);await m.install({pack_id:one.pack_id,release_id:one.release_id,operation_id:randomUUID()});const context={host:'dsh' as const,hostInstanceId:'test-host',sessionId:'test-session'};const choices=choicesOf(store,context,one.pack_id);assert.equal(choices.length,1);
 const selected=choices[0]!.selection;store.changeRules(context,{kind:'enable',generation:0,selection:selected,replace:null,checkpoint:{version:1,profile:'test-host',session:'test-session',createdAt:1,rules:[],intents:[]}});assert.equal(store.rules(context).rules[0]!.enabled,true);
 current=two;const changes=await m.updateCheck({pack_id:one.pack_id});assert.equal(changes.changed,true);assert.equal(changes.enabled,false);assert.equal(changes.semantics.after[0]!.semantics['zh-CN']!.meaning,'新版本固定语义');
 fault=true;await assert.rejects(m.install({pack_id:one.pack_id,release_id:two.release_id,operation_id:randomUUID()}),/MARKET_UNAVAILABLE/);assert.equal(store.getEntry(e.asset_id).expression.revision_id,e.revision_id);assert.equal(store.rules(context).rules[0]!.enabled,true);fault=false;
 details=0;replaceDigest=true;await assert.rejects(m.install({pack_id:one.pack_id,release_id:two.release_id,operation_id:randomUUID()}),/DIGEST/);assert.equal(store.getEntry(e.asset_id).expression.revision_id,e.revision_id);replaceDigest=false;
 await m.install({pack_id:one.pack_id,release_id:two.release_id,operation_id:randomUUID()});assert.equal(store.getEntry(e.asset_id).expression.revision_id,e2.revision_id);assert.equal(store.rules(context).rules[0]!.enabled,false);
 const entry=store.getEntry(e.asset_id);store.selectRevision({asset_id:e.asset_id,revision_id:e.revision_id},entry.version);assert.equal(store.getEntry(e.asset_id).expression.revision_id,e.revision_id);
 await m.collect({pack_id:one.pack_id,release_id:one.release_id,ref:{asset_id:e.asset_id,revision_id:e.revision_id},operation_id:randomUUID()});
 const alternate=store.getEntry(e.asset_id);store.selectRevision({asset_id:e2.asset_id,revision_id:e2.revision_id},alternate.version);
 assert.ok(store.list().some(x=>x.revision_id===e.revision_id),'independent collection remains selectable beside pack default');
 store.receive({...context,turnId:'collection'}, {ref:target(e)},'collection-send');
 await store.importPack(packs.get(one.release_id)!);await m.remove({pack_id:one.pack_id});assert.ok(store.list().some(x=>x.revision_id===e.revision_id));
 await assert.rejects(m.search({query:'',origin:'https://evil.test'}),/INVALID_ARGUMENT/);
});
test('LocalAcquisition: process death before atomic commit stays invisible and reconciles original operation without replay',async t=>{
 const {spawn}=await import('node:child_process');const {writeFile}=await import('node:fs/promises');const root=await mkdtemp(join(tmpdir(),'amoji-market-crash-'));let store=await LibraryStore.open(root,seed);t.after(async()=>{store.close();await rm(root,{recursive:true,force:true});});
 const e={...store.list()[0]!,asset_id:randomUUID(),revision_id:randomUUID()};const pack=packOf('崩溃验证',[e]);
 const bytes=await exportManifest(pack,b=>readFile(join(root,'blobs',b.sha256)));const archive=join(root,'fixture.amoji');await writeFile(archive,bytes);store.close();const operation_id=randomUUID();const identity={pack_id:pack.pack_id,release_id:pack.release_id,operation_id};
 const script=`import {readFile} from 'node:fs/promises';import {LibraryStore} from ${JSON.stringify(new URL('../src/library-store.ts',import.meta.url).href)};import {LocalAcquisition} from ${JSON.stringify(new URL('../src/local-acquisition.ts',import.meta.url).href)};const store=await LibraryStore.open(${JSON.stringify(root)},${JSON.stringify(seed.map(u=>u.href))}.map(h=>new URL(h)));let checks=0;const m=new LocalAcquisition(store,'https://market.test',async url=>{if(String(url).endsWith('/archive'))return new Response(new Uint8Array(await readFile(${JSON.stringify(archive)})));if(++checks===2){console.log('PRECOMMIT');await new Promise(()=>{});}return Response.json(${JSON.stringify({pack_id:pack.pack_id,release_id:pack.release_id,manifest:pack,archive_sha256:createHash('sha256').update(bytes).digest('hex')})});});const timer=setInterval(()=>{},1000);await m.install(${JSON.stringify(identity)});clearInterval(timer);`;
 const child=spawn(process.execPath,['--import','tsx','--input-type=module','-e',script],{stdio:['ignore','pipe','pipe']});let errors='';child.stderr.on('data',b=>errors+=String(b));
 await new Promise<void>((resolve,reject)=>{const timeout=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Child did not reach precommit: '+errors));},10000);child.stdout.on('data',b=>{if(String(b).includes('PRECOMMIT')){clearTimeout(timeout);resolve();}});child.on('error',reject);});
 child.kill('SIGKILL');await new Promise<void>(resolve=>child.once('exit',()=>resolve()));store=await LibraryStore.open(root,seed);const m=new LocalAcquisition(store,'https://market.test',async()=>{throw Error('must not replay');});assert.equal((await m.installStatus({operation_id})).status,'pending');assert.equal((await m.install(identity)).status,'pending');assert.ok(!store.list().some(x=>x.asset_id===e.asset_id));
});
test('market installation enforces smaller media profile while local pack compatibility remains unchanged',async t=>{
 const sharp=(await import('sharp')).default;const root=await mkdtemp(join(tmpdir(),'amoji-market-budget-'));const store=await LibraryStore.open(root,seed);t.after(async()=>{store.close();await rm(root,{recursive:true,force:true});});
 const png=await sharp({create:{width:1025,height:1,channels:4,background:'#123456'}}).png().toBuffer();const e={...store.list()[0]!,asset_id:randomUUID(),revision_id:randomUUID(),visual:{animated:false,text_locale:null,primary:{sha256:createHash('sha256').update(png).digest('hex'),bytes:png.length,width:1025,height:1,mime:'image/png'}}};
 const p=packOf('限额',[e]);const bytes=await exportManifest(p,async()=>png);
 const m=new LocalAcquisition(store,'https://market.test',async url=>String(url).endsWith('/archive')?new Response(new Uint8Array(bytes)):Response.json({pack_id:p.pack_id,release_id:p.release_id,manifest:p,archive_sha256:createHash('sha256').update(bytes).digest('hex')}));
 await assert.rejects(m.install({pack_id:p.pack_id,release_id:p.release_id,operation_id:randomUUID()}),/MEDIA_LIMIT_EXCEEDED/);assert.ok(!store.list().some(x=>x.asset_id===e.asset_id));await store.importPack(bytes);assert.equal(store.resolve(e).visual.primary.width,1025);
});

test('market filters reach public catalog and offline caches remain query-specific',async t=>{
 const root=await mkdtemp(join(tmpdir(),'amoji-market-filter-'));const store=await LibraryStore.open(root,seed);t.after(async()=>{store.close();await rm(root,{recursive:true,force:true});});
 let offline=false;const seen:string[]=[];const m=new LocalAcquisition(store,'https://market.test',async url=>{if(offline)throw Error('offline');seen.push(String(url));return Response.json({packs:[]});});
 const filter={query:'hello',act:'core:thanks',locale:'zh-CN',effects:'true'};await m.search(filter);const parsed=new URL(seen.find(x=>x.includes('/v1/packs?'))!);assert.equal(parsed.searchParams.get('act'),'core:thanks');assert.equal(parsed.searchParams.get('locale'),'zh-CN');assert.equal(parsed.searchParams.get('effects'),'true');
 offline=true;assert.equal((await m.search(filter) as any).stale,true);await assert.rejects(m.search({...filter,effects:'false'}),/MARKET_UNAVAILABLE/);await assert.rejects(m.search({...filter,effects:'invalid'}),/INVALID_ARGUMENT/);await assert.rejects(m.search({...filter,scenario:'work'}),/INVALID_ARGUMENT/);
});
test('safety revocation atomically disables rules and blocks identity replay while preserving expression history',async t=>{
 const root=await mkdtemp(join(tmpdir(),'amoji-revocation-'));const store=await LibraryStore.open(root,seed);t.after(async()=>{store.close();await rm(root,{recursive:true,force:true});});
 const e=store.list()[0]!;const p=packOf('安全测试',[e],{effects:[habit('安全测试')]});
 const bytes=await exportManifest(p,b=>readFile(join(root,'blobs',b.sha256)));await store.importPack(bytes);
 const context={host:'dsh' as const,hostInstanceId:'test',sessionId:'test'},choice=choicesOf(store,context,p.pack_id)[0]!;
 store.changeRules(context,{kind:'enable',generation:0,selection:choice.selection,checkpoint:{version:1,profile:'test',session:'test',createdAt:1,rules:[],intents:[]}});
 let online=true;const fetcher:typeof fetch=async()=>{if(!online)throw Error('offline');return Response.json({revocations:[{pack_id:p.pack_id,release_id:p.release_id,archive_sha256:createHash('sha256').update(bytes).digest('hex'),state:'safety_removed',reason_code:'safety'}],cursor:'cursor',has_more:false});};
 const market=new LocalAcquisition(store,'https://market.test',fetcher);const state=await market.refreshRevocations({});assert.equal(state.stale,false);assert.ok(state.last_checked_at);
 assert.equal(store.rules(context).rules[0]!.enabled,false);assert.equal(choicesOf(store,context,p.pack_id).length,0);assert.deepEqual(store.resolve(e),e);
 await assert.rejects(store.importPack(bytes),/SAFETY_REMOVED/);
 const replay={...p,release_id:randomUUID(),version:2};await assert.rejects(store.importPack(await exportManifest(replay,b=>readFile(join(root,'blobs',b.sha256)))),/SAFETY_REMOVED/);
 online=false;const offline=await market.refreshRevocations({});assert.equal(offline.stale,true);assert.equal(offline.last_checked_at,state.last_checked_at);
});
