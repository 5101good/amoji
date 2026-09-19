import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SharedClient, stopSharedService } from '../src/shared-client.js';
import { modelProjection } from '../src/projection.js';

const fields = { name: '今天稳稳前进', semantics: { locale: 'zh-CN', meaning: '认可你持续稳步前进', fallback: '稳稳前进', tone: '温柔', use_when: ['鼓励持续努力'], avoid_when: ['需要紧急行动'] }, rights: { license: '仅供个人使用' } };
async function sandbox(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'amoji-create-'));
  const clients: SharedClient[] = [];
  const connect = async () => { const client = await SharedClient.connect({ directory }); clients.push(client); return client; };
  t.after(async () => { for (const client of clients) await client.close(); await stopSharedService(directory, clients.at(-1)!.identity.serviceId); await rm(directory, { recursive: true, force: true }); });
  return { directory, connect };
}
async function upload(client: SharedClient, animated = false) {
  const expression = (await client.list()).find(e => e.visual.animated === animated)!;
  return (await readFile(await client.blobPath(expression.visual.primary.sha256))).toString('base64');
}

test('公共草稿在确认前不可检索发送，重启和跨宿主确认重试只生成一个固定版本', async t => {
  const { directory, connect } = await sandbox(t);
  let client = await connect();
  assert.equal(typeof client.createDraft, 'function', '公共客户端必须提供独立持久草稿接口');
  const original = await client.createDraft();
  assert.equal('asset_id' in original, false);
  const saved = await client.saveDraft(original.draft_id, original.version, fields, await upload(client));
  const binding = await client.bind({ host: 'codex', sessionId: 'creation', turnId: '1' });
  assert.deepEqual((await client.search(binding, fields.name)).candidates, []);
  await assert.rejects(client.receive(binding, { asset_id: saved.draft_id, revision_id: saved.draft_id }, 'draft-send'), /REVISION_NOT_FOUND/);
  assert.equal((await client.list()).length, 24);
  const old = (await client.list())[0]!;
  const oldMessage = await client.receive(binding, { asset_id: old.asset_id, revision_id: old.revision_id }, 'old-message');
  await client.close();
  await stopSharedService(directory, client.identity.serviceId);
  client = await connect();
  assert.deepEqual(await client.getDraft(saved.draft_id), saved);
  const preview = await client.previewDraft(saved.draft_id, saved.version);
  assert.deepEqual(preview.fields, fields);
  assert.equal('asset_id' in preview, false);
  const [expression, duplicate] = await Promise.all([client.confirmDraft(saved.draft_id, saved.version), client.confirmDraft(saved.draft_id, saved.version)]);
  assert.deepEqual(duplicate, expression);
  assert.match(expression.asset_id, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.equal(expression.name, fields.name);
  assert.equal((await client.list()).length, 25);
  await assert.rejects(client.saveDraft(saved.draft_id, saved.version, { ...fields, name: '更改已确认' }), /DRAFT_CONFIRMED/);
  for (const host of ['codex', 'claude-code', 'dsh'] as const) {
    const adapter = await connect();
    const bound = await adapter.bind({ host, sessionId: `same-library-${host}`, turnId: '1' });
    const choice = (await adapter.search(bound, fields.name)).candidates[0]!;
    assert.equal(choice.revision_id, expression.revision_id);
    const message = await adapter.emit(bound, choice.selection_token);
    assert.deepEqual(message.revision, expression);
    const projection = JSON.stringify(modelProjection(message.revision));
    assert.ok(projection.includes(fields.semantics.meaning));
    assert.equal(projection.includes(expression.visual.primary.sha256), false);
    await adapter.close();
  }
  const restoredBinding = await client.bind({ host: 'codex', sessionId: 'creation', turnId: '1' });
  assert.deepEqual(await client.history(restoredBinding), [oldMessage]);
  await client.close();
  await stopSharedService(directory, client.identity.serviceId);
  client = await connect();
  assert.deepEqual(await client.confirmDraft(saved.draft_id, saved.version), expression);
  assert.deepEqual(await client.resolve({ asset_id: expression.asset_id, revision_id: expression.revision_id }), expression);
});

test('草稿保留未完成字段，严格拒绝伪造归属、未知字段和无效语义；确认绑定预览版本', async t => {
  const { connect } = await sandbox(t);
  const client = await connect();
  const original = await client.createDraft();
  const saved = await client.saveDraft(original.draft_id, 1, { ...fields, name: '  ' }, await upload(client));
  await assert.rejects(client.previewDraft(saved.draft_id, saved.version), /INVALID_SCHEMA/);
  assert.equal((await client.getDraft(saved.draft_id)).fields.name, '  ');
  for (const extra of [{ origin: 'local' }, { created_at: '2026-02-30T00:00:00Z' }, { schema_version: '0.2' }]) {
    await assert.rejects(client.saveDraft(saved.draft_id, saved.version, { ...fields, ...extra }), /INVALID_ARGUMENT/);
  }
  const unicode = await client.saveDraft(saved.draft_id, saved.version, { ...fields, name: '😀'.repeat(48) });
  await client.previewDraft(unicode.draft_id, unicode.version);
  const changed = await client.saveDraft(unicode.draft_id, unicode.version, { ...fields, name: '😀'.repeat(49) });
  await assert.rejects(client.confirmDraft(changed.draft_id, unicode.version), /DRAFT_CONFLICT/);
  await assert.rejects(client.confirmDraft(changed.draft_id, changed.version), /INVALID_SCHEMA/);
  await assert.rejects(client.saveDraft(changed.draft_id, changed.version, { ...fields, semantics: { ...fields.semantics, override: '伪造' } } as any), /INVALID_ARGUMENT/);
  const budget = await client.saveDraft(changed.draft_id, changed.version, { ...fields, semantics: { ...fields.semantics, meaning: '\u0000'.repeat(239) + '😀', tone: '😀'.repeat(80), fallback: '😀'.repeat(80), use_when: Array.from({ length: 4 }, (_, i) => '😀'.repeat(63) + String(i)), avoid_when: Array.from({ length: 4 }, (_, i) => '😀'.repeat(63) + String(i)) } });
  await assert.rejects(client.previewDraft(budget.draft_id, budget.version), /SEMANTICS_BUDGET_EXCEEDED/);
  assert.equal((await client.list()).length, 24);
});

test('动图上传自动生成合法静态封面；坏素材不会覆盖原草稿或产生半可用表情', async t => {
  const { connect } = await sandbox(t);
  const client = await connect();
  const original = await client.createDraft();
  const saved = await client.saveDraft(original.draft_id, 1, fields, await upload(client, true));
  const preview = await client.previewDraft(saved.draft_id, saved.version);
  assert.equal(preview.visual!.animated, true);
  assert.ok(preview.visual!.poster);
  assert.notEqual(preview.visual!.poster!.sha256, preview.visual!.primary.sha256);
  await assert.rejects(client.saveDraft(saved.draft_id, saved.version, { ...fields, name: '不得覆盖' }, Buffer.from('<svg/>').toString('base64')), /MEDIA_UNSUPPORTED/);
  assert.deepEqual(await client.getDraft(saved.draft_id), saved);
  const expression = await client.confirmDraft(saved.draft_id, saved.version);
  assert.deepEqual(expression.visual, preview.visual);
  assert.ok((await readFile(await client.blobPath(expression.visual.poster!.sha256))).length > 0);
});

test('确认验证器拒绝无效日历日期、空白、未知字段和越界语义而保留合法Unicode', async t => {
  const { connect } = await sandbox(t);
  const client = await connect();
  const { validateExpressionDefinition } = await import('../src/drafts.js');
  const sample = (await client.list())[0]!;
  assert.doesNotThrow(() => validateExpressionDefinition({ ...sample, name: '😀'.repeat(48) }));
  for (const change of [
    { created_at: '2026-02-30T00:00:00Z' }, { created_at: '2026-01-01T00:00:00+08:00' },
    { name: '😀'.repeat(49) }, { name: '\t \n' }, { extra: 'unknown' },
    { semantics: { ...sample.semantics, tone: 'a'.repeat(81) } },
    { semantics: { ...sample.semantics, meaning: '😀'.repeat(241) } },
    { semantics: { ...sample.semantics, fallback: 'a'.repeat(81) } },
    { semantics: { ...sample.semantics, use_when: ['a'.repeat(65)] } },
    { semantics: { ...sample.semantics, avoid_when: ['a', 'b', 'c', 'd', 'e'] } },
    { rights: { license: ' ' } }, { tags: ['😀'.repeat(25)] },
  ]) assert.throws(() => validateExpressionDefinition({ ...sample, ...change } as any), /INVALID_SCHEMA/);
  assert.throws(() => validateExpressionDefinition({ ...sample, schema_version: '0.2' } as any), /UNSUPPORTED_SCHEMA/);
});

test('API2数据库1升级保留既有用户版本、消息与素材；新创建归属仅由服务写入', async t => {
  const { directory, connect } = await sandbox(t);
  let client = await connect();
  const sample = (await client.list())[0]!;
  const context = { host: 'codex' as const, sessionId: 'migration-user', turnId: '1' };
  const before = await client.receive(await client.bind(context), { asset_id: sample.asset_id, revision_id: sample.revision_id }, 'old-request');
  await client.close(); await stopSharedService(directory, client.identity.serviceId);
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(join(directory, 'library.sqlite'));
  const existing = { ...sample, asset_id: '80000000-0000-4000-8000-000000000007', revision_id: '81000000-0000-4000-8000-000000000007', name: '既有用户资产' };
  db.prepare('INSERT INTO revisions VALUES (?,?,?)').run(existing.asset_id, existing.revision_id, JSON.stringify(existing));
  db.prepare('INSERT INTO library_entries VALUES (?,?)').run(existing.asset_id, existing.revision_id);
  db.exec('DROP TABLE drafts; DROP TABLE expression_origins; PRAGMA user_version=1;'); db.close();
  client = await connect();
  assert.equal(client.identity.apiVersion, 2); assert.equal(client.identity.databaseVersion, 4);
  assert.ok(client.identity.capabilities?.includes('create-drafts-v1'));
  assert.deepEqual(await client.resolve({ asset_id: existing.asset_id, revision_id: existing.revision_id }), existing);
  const bound = await client.bind(context);
  assert.deepEqual(await client.history(bound), [before]);
  assert.equal((await client.receive(bound, { asset_id: sample.asset_id, revision_id: sample.revision_id }, 'old-request')).message_id, before.message_id);
  const draft = await client.createDraft();
  const saved = await client.saveDraft(draft.draft_id, draft.version, { ...fields, rights: { ...fields.rights, creator: '说明不授予归属权限' } }, await upload(client));
  const expression = await client.confirmDraft(saved.draft_id, saved.version);
  const audit = new DatabaseSync(join(directory, 'library.sqlite'), { readOnly: true });
  assert.equal(audit.prepare('SELECT origin FROM expression_origins WHERE asset_id=?').get(expression.asset_id)!.origin, 'local'); audit.close();
  assert.equal('origin' in expression, false);
});
