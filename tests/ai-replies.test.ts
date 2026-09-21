import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {LibraryStore} from '../src/library-store.js';
import {searchExpressions} from '../src/search.js';
const seed=new URL('../assets/base-library/base.amoji',import.meta.url);
const names=['我来处理','正在核对','需要你确认','是我理解错了','暂时没把握','不客气','辛苦了','准备好了'];
test('AI发送者视角的自然查询命中对应回应，两套画风不重复',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'amoji-ai-replies-'));const store=await LibraryStore.open(dir,seed);
 t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});
 const queries=['接手用户已授权的任务，我来处理','正在核对资料和结果','需要用户确认一个具体选择','承认是我理解错了并纠正','目前证据不足，坦诚表达不确定','回应用户的感谢，说不客气','体谅用户投入的努力，辛苦了','结果已经准备好，请用户查看'];
 for(const appearance of ['classic','office'] as const){
  const s=store.getSettings();store.updateSettings(s.version,{style:s.style,frequency:s.frequency,paused:s.paused,appearance});
  for(let i=0;i<names.length;i++){
   const found=searchExpressions(store.list(),queries[i]!,3);
   assert.ok(found.some(e=>e.name===names[i]),`${appearance}: ${queries[i]} -> ${found.map(e=>e.name)}`);
   const expression=store.list().find(e=>e.name===names[i]);assert.ok(expression);
   assert.ok(expression.tags?.includes('amoji:appearance:'+appearance));
   assert.ok(expression.semantics.use_when?.some(s=>s.includes('AI')));
   const context={host:'dsh' as const,sessionId:`ai-${appearance}-${i}`,turnId:'1'};
   const result=store.search(context,queries[i]!,3);
   assert.ok(!JSON.stringify(result).includes('visual'));
   const chosen=result.candidates.find(e=>e.name===names[i]);assert.ok(chosen);
   const message=store.emit(context,chosen.selection_token);
   assert.equal(message.direction,'ai_to_human');assert.deepEqual(message.revision,expression);
   assert.equal(store.emit(context,chosen.selection_token).message_id,message.message_id);
  }
 }
});
test('v3升级只追加AI回应，完整保留32个旧定义、归档选择及历史',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'amoji-ai-upgrade-'));let store=await LibraryStore.open(dir,new URL('./fixtures/base-library-v3/base.amoji',import.meta.url));
 t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});
 const prior=JSON.parse(await readFile(new URL('./fixtures/base-library-v3/manifest.json',import.meta.url),'utf8'));
 const current=JSON.parse(await readFile(new URL('../assets/base-library/manifest.json',import.meta.url),'utf8'));
 for(const old of prior.expressions)assert.deepEqual(current.expressions.find((e:any)=>e.asset_id===old.asset_id),old);
 const e=store.list()[0]!;const context={host:'dsh' as const,sessionId:'keep',turnId:'1'};const message=store.receive(context,e,'one');
 const entry=store.getEntry(e.asset_id);store.setArchived(e.asset_id,entry.version,true);
 store.close();store=await LibraryStore.open(dir,seed);
 for(const old of prior.expressions)assert.deepEqual(store.resolve(old),old);
 assert.equal(store.getEntry(e.asset_id).archived,true);assert.deepEqual(store.history(context),[message]);
 assert.equal(store.listEntries().length,48);assert.equal(store.list().length,23);
 for(const name of names)assert.ok(store.list().some(e=>e.name===name));
 store.close();store=await LibraryStore.open(dir,seed);assert.equal(store.listEntries().length,48);
});
