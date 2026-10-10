import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startSharedService } from '../src/shared-service.js';
import { SharedClient } from '../src/shared-client.js';
import { ConnectedRuntime } from '../src/adapter-runtime.js';
import { ExpressionApplication } from '../src/application/expressions.js';
import { SESSION_BINDINGS_CAPABILITY } from '../src/shared-contract.js';
import { humanText, messageMarker, renderSegments } from '../src/claude-mods/messages.js';
import { thumbnailSvg } from '../src/claude-mods/thumbnail.js';
import { executeBridge } from '../src/claude-mods/bridge.js';

async function setup(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'amoji-mods-'));
  const service = await startSharedService(directory, new URL('../assets/samples/', import.meta.url));
  const client = await SharedClient.connect({ directory });
  t.after(async () => { await client.close(); await service.close(); await rm(directory, { recursive: true, force: true }); });
  const app = new ExpressionApplication(new ConnectedRuntime(client), client);
  const context = { host: 'claude-code' as const, hostInstanceId: 'mods', sessionId: 'session-a' };
  return { directory, client, app, context };
}

test('宿主空闲时人工表情按请求幂等，AI 仍需真实回合；当前会话隔离', async t => {
  const {client,app,context} = await setup(t);
  assert.ok(client.identity.capabilities?.includes(SESSION_BINDINGS_CAPABILITY));
  const page = await app.browse({ query:'', page:0 });
  const ref = page.items[0]!.expression;
  const a = await app.receive(context, ref, 'human-1');
  assert.equal((await app.receive(context, ref, 'human-1')).message_id, a.message_id);
  assert.equal((await app.history(context)).length, 1);
  assert.deepEqual(await app.history({...context,sessionId:'session-b'}), []);
  await assert.rejects(app.search(context, '加油'), /TURN_REQUIRED/);
  const turn = {...context,turnId:'real-turn',turnOrdinal:1};
  const search = await app.search(turn, '加油');
  assert.ok(search.candidates.length);
  await assert.rejects(app.emit({...turn,sessionId:'session-b'}, search.candidates[0]!.selection_token));
  const ai = await app.emit(turn, search.candidates[0]!.selection_token);
  assert.equal((await app.emit(turn, search.candidates[0]!.selection_token)).message_id, ai.message_id);
  assert.doesNotMatch(JSON.stringify(search), /visual|base64|sha256|image\//);
  const prefs = await client.getSettings();
  await client.updateSettings(prefs.version, {style:prefs.style,frequency:prefs.frequency,appearance:prefs.appearance,paused:true});
  assert.equal((await app.search({...turn,turnId:'next',turnOrdinal:2}, '庆祝')).candidates.length, 0);
});

test('只重绘同会话同方向的完整标记，保留普通文字、未知标记和历史固定语义', async t => {
  const {app,client,context} = await setup(t);
  const ref = (await app.browse({query:'',page:0})).items[0]!.expression;
  const human = await app.receive(context,ref,'human');
  const wire = humanText(human);
  assert.doesNotMatch(wire,/base64|sha256|visual|image\//);
  assert.equal((await renderSegments(app,context,'human_to_ai',wire))[0]!.kind,'expression');
  assert.equal((await renderSegments(app,{...context,sessionId:'other'},'human_to_ai',wire))[0]!.kind,'text');
  assert.equal((await renderSegments(app,context,'ai_to_human',messageMarker(human)))[0]!.kind,'text');
  assert.equal((await renderSegments(app,context,'human_to_ai',wire.replace(ref.name,'篡改')))[0]!.kind,'text');
  const turn = {...context,turnId:'turn',turnOrdinal:1};
  const token = (await app.search(turn,'加油')).candidates[0]!.selection_token;
  const ai = await app.emit(turn,token);
  const rendered = await renderSegments(app,context,'ai_to_human',`前文\n${messageMarker(ai)}\n后文`);
  assert.deepEqual(rendered.map(s=>s.kind),['text','expression','text']);
  assert.equal(rendered[0]!.kind === 'text' && rendered[0]!.text,'前文\n');
  assert.deepEqual(await renderSegments(app,context,'ai_to_human','[[amoji:not-a-message]]'),[{kind:'text',text:'[[amoji:not-a-message]]'}]);
  const entry = await client.getEntry(ref.asset_id);
  await client.setArchived(ref.asset_id, entry.version, true);
  assert.equal((await renderSegments(app,context,'human_to_ai',wire))[0]!.kind,'expression');
});

test('缩略图实际解码且有预算，桥接分页不泄露库路径；越界页收敛', async t => {
  const {app,client,context} = await setup(t);
  const item = (await client.list())[0]!;
  const raw = await readFile(await client.blobPath((item.visual.poster ?? item.visual.primary).sha256));
  const svg = await thumbnailSvg(raw);
  assert.match(svg,/^<svg/);
  assert.ok(svg.length <= 8500);
  const result:any = await executeBridge(app,client,{command:'browse',context,args:{query:'',page:99}});
  assert.equal(result.page,0);
  assert.equal(result.items.length,3);
  assert.ok(JSON.stringify(result).length<85000);
  assert.doesNotMatch(JSON.stringify(result),/secret|file:\/\/|Application Support/);
  await assert.rejects(executeBridge(app,client,{command:'unknown',context,args:{}}),/INVALID_ARGUMENT/);
});

test('通过管理用例创建、核对、确认、归档和包导出导入；拒绝静默覆盖文件', async t => {
  const {app,client,context,directory} = await setup(t);
  const run = (command:string,args:unknown={}) => executeBridge(app,client,{command,context,args}) as Promise<any>;
  const draft = await run('createDraft');
  const original = (await client.list())[0]!;
  const imagePath = join(directory,'chosen.png');
  await writeFile(imagePath,await readFile(await client.blobPath(original.visual.primary.sha256)));
  const fields = {name:'一起稳步推进',semantics:{locale:'zh-CN',meaning:'认可双方稳步推进',fallback:'稳步推进'},rights:{license:'仅供个人使用'},tags:['协作']};
  const saved = await run('saveDraft',{id:draft.draft_id,version:draft.version,fields,imagePath});
  const preview = await run('previewDraft',{id:saved.draft_id,version:saved.version});
  assert.match(preview.preview,/^<svg/);
  await assert.rejects(run('confirmDraft',{id:saved.draft_id,version:saved.version,reviewed:false}),/REVIEW_REQUIRED/);
  const expression = await run('confirmDraft',{id:saved.draft_id,version:saved.version,reviewed:true});
  assert.equal(expression.name,fields.name);
  const path = join(directory,'export.amoji');
  await run('exportPack',{refs:[{asset_id:expression.asset_id,revision_id:expression.revision_id}],path});
  const bytes = await readFile(path);
  await assert.rejects(run('exportPack',{refs:[{asset_id:expression.asset_id,revision_id:expression.revision_id}],path}),/EXPORT_EXISTS/);
  assert.deepEqual(await readFile(path),bytes);
  assert.ok(await run('importPack',{path}));
  const entry = await client.getEntry(expression.asset_id);
  await run('archive',{assetId:expression.asset_id,version:entry.version,archived:true});
  assert.ok(!(await app.browse({query:fields.name,page:0})).items.length);
});

test('共享服务本身拒绝无回合 AI 工具，桥接只给模型纯文字结果；建议不能改版权', async t => {
  const {app,client,context}=await setup(t);
  const binding=await client.bind(context);
  await assert.rejects(client.search(binding,'加油'), /TURN_REQUIRED/);
  await assert.rejects(client.emit(binding,'not-a-token'), /TURN_REQUIRED/);
  await client.unbind(binding);
  const run=(command:string,args:unknown,ctx=context)=>executeBridge(app,client,{command,context:ctx,args}) as Promise<any>;
  const turn={...context,turnId:'actual-turn',turnOrdinal:1};
  const found=await run('search',{query:'加油'},turn);
  const emitted=await run('emit',{token:found.candidates[0].selection_token},turn);
  assert.match(emitted.marker,/^\[\[amoji:/);
  assert.doesNotMatch(JSON.stringify(emitted),/visual|base64|sha256|image\//);
  const ask=await run('suggestionRequest',{intent:'感谢搭档耐心解释'});
  assert.equal(ask.maxTokens,1200); assert.equal(ask.timeoutMs,45000);
  assert.deepEqual(JSON.parse(ask.prompt),{intent:'感谢搭档耐心解释'});
  await assert.rejects(run('parseSuggestion',{text:JSON.stringify({name:'谢谢',semantics:{locale:'zh-CN',meaning:'感谢搭档',fallback:'谢谢'},tags:['感谢'],rights:{license:'伪造授权'}})}),/SUGGESTION_OUTPUT_INVALID/);
  const fields=await run('parseSuggestion',{text:JSON.stringify({name:'谢谢',semantics:{locale:'zh-CN',meaning:'感谢搭档',fallback:'谢谢'},tags:['感谢']})});
  assert.equal(fields.name,'谢谢'); assert.ok(!('rights' in fields));
});
