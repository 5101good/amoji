import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {SharedClient,stopSharedService} from '../src/shared-client.js';
import {withValidatedPack,exportManifest} from '../src/packs.js';
import type {ScenarioPack} from '../src/packs.js';
async function client(t:any){const directory=await mkdtemp(join(tmpdir(),'amoji-scenario-'));const c=await SharedClient.connect({directory});t.after(async()=>{await c.close();await stopSharedService(directory,c.identity.serviceId);await rm(directory,{recursive:true,force:true});});return c;}
test('公开API：可恢复草稿、预览、保存、0.2完整往返及0.1显式导出，固定语义不变',async t=>{
 const c=await client(t);assert.equal(c.identity.apiVersion,2);assert.equal(c.identity.databaseVersion,5);assert.ok(c.identity.capabilities?.includes('versioned-packs-v1'));assert.ok(c.identity.capabilities?.includes('collaboration-v1'));assert.ok(c.identity.capabilities?.includes('marketplace-v1'));
 const e=(await c.list())[0]!;const ref={asset_id:e.asset_id,revision_id:e.revision_id};
 let d=await c.createScenarioDraft([ref]);const a={action_id:randomUUID(),action_revision_id:randomUUID(),kind:'hook' as const,scope:'conversation' as const,locale:'zh-CN',effect_summary:'先说答案',conflict_group:'response-organization' as const,template:'response-organization@1' as const,config:{layout:'answer-first' as const},rights:{license:'CC0-1.0'}};
 d=await c.saveScenarioDraft(d.draft_id,d.version,{...d.manifest,name:'解释场景',actions:[a],bindings:[{expression:ref,actions:[{action_id:a.action_id,action_revision_id:a.action_revision_id}]}]});
 assert.deepEqual((await c.listScenarioDrafts())[0],d);await c.reconnect();assert.deepEqual(await c.getScenarioDraft(d.draft_id),d);
 assert.deepEqual((await c.previewScenarioDraft(d.draft_id,d.version)).expressions[0],e);
 const saved=await c.confirmScenarioDraft(d.draft_id,d.version);assert.deepEqual(await c.confirmScenarioDraft(d.draft_id,d.version),saved);
 await assert.rejects(c.saveScenarioDraft(d.draft_id,d.version,{...d.manifest,name:'变更'}),/DRAFT_FINALIZED/);
 const bytes=await c.exportScenarioPack(saved.release_id);const other=await client(t);const result=await other.importPack(bytes);assert.equal(result.actions?.[0]?.enabled,false);assert.ok(result.actions?.[0]?.reason);assert.deepEqual(await other.getScenarioPack(saved.release_id),saved);
 await withValidatedPack(await other.exportScenarioPack(saved.release_id),async p=>assert.deepEqual(p.manifest,saved));
 await withValidatedPack(await c.exportScenarioPack(saved.release_id,true),async p=>{assert.equal(p.manifest.schema_version,'0.1');assert.equal('actions' in p.manifest,false);assert.deepEqual(p.manifest.expressions[0],e);});
 const visual=await c.createScenarioDraft([ref]);assert.equal(visual.manifest.actions.length,0);assert.equal((await c.previewScenarioDraft(visual.draft_id,visual.version)).expressions[0]!.schema_version,'0.1');
 const binding=await c.bind({host:'dsh',sessionId:'history-check',turnId:'1'});await c.receive(binding,ref,'original');const history=await c.history(binding);
 const settings=await c.getSettings();await c.updateSettings(settings.version,{style:settings.style,frequency:settings.frequency,paused:settings.paused,appearance:'office'});assert.deepEqual(await c.getScenarioPack(saved.release_id),saved);assert.deepEqual(await c.history(binding),history);
 const bad:ScenarioPack={...saved,release_id:randomUUID(),version:2,name:'冲突',actions:[{...a,effect_summary:'替换不可变版本'}]};
 const badBytes=await exportManifest(bad,async blob=>{const fs=await import('node:fs/promises');return fs.readFile(await c.blobPath(blob.sha256));});
 await assert.rejects(other.importPack(badBytes),/ACTION_REVISION_CONFLICT/);await assert.rejects(other.getScenarioPack(bad.release_id),/PACK_NOT_FOUND/);
});
