import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SharedClient, stopSharedService } from '../src/shared-client.js';
import { expressionProjection } from '../src/projection.js';
import type { DraftFields } from '../src/drafts.js';
import { fields } from './helpers/fixtures.js';

async function sandbox(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'amoji-drafts-'));
  const clients: SharedClient[] = [];
  const connect = async () => { const client = await SharedClient.connect({ directory }); clients.push(client); return client; };
  const restart = async () => { const last = clients.at(-1)!; for (const c of clients.splice(0)) await c.close(); await stopSharedService(directory, last.identity.serviceId); return connect(); };
  t.after(async () => { for (const c of clients) await c.close(); if (clients.length) await stopSharedService(directory, clients.at(-1)!.identity.serviceId); await rm(directory, { recursive: true, force: true }); });
  return { connect, restart };
}
async function upload(client: SharedClient, animated = false): Promise<string> {
  const expression = (await client.list()).find(e => e.visual.animated === animated)!;
  return (await readFile(await client.blobPath(expression.visual.primary.sha256))).toString('base64');
}

test('a draft is private until confirmed; confirmation is idempotent across restarts and hosts', async t => {
  const { connect, restart } = await sandbox(t);
  let client = await connect();
  const before = (await client.list()).length;
  const original = await client.createDraft('zh-CN');
  assert.equal('asset_id' in original, false);
  const saved = await client.saveDraft(original.draft_id, original.version, fields, await upload(client));
  const binding = await client.bind({ host: 'codex', sessionId: 'creation', turnId: '1' });
  assert.equal((await client.search(binding, '稳稳前进')).candidates.some(c => c.name === '今天稳稳前进'), false, 'drafts are not searchable');
  await assert.rejects(client.receive(binding, { ref: { asset_id: saved.draft_id, revision_id: saved.draft_id } }, 'draft-send'), /REVISION_NOT_FOUND|SELECTION_UNAVAILABLE/);
  client = await restart();
  assert.deepEqual(await client.getDraft(saved.draft_id), saved, 'drafts persist');
  const preview = await client.previewDraft(saved.draft_id, saved.version);
  assert.deepEqual(preview.fields, fields);
  const [expression, duplicate] = await Promise.all([client.confirmDraft(saved.draft_id, saved.version), client.confirmDraft(saved.draft_id, saved.version)]);
  assert.deepEqual(duplicate, expression);
  assert.deepEqual([expression.realizes, expression.name, expression.semantics], [fields.realizes, fields.name, fields.semantics]);
  assert.equal((await client.list()).length, before + 1);
  await assert.rejects(client.saveDraft(saved.draft_id, saved.version, { ...fields, intensity: 3 }), /DRAFT_CONFIRMED/);
  for (const [host, locale, meaning] of [['codex', 'zh-CN', '认可你持续稳步前进'], ['claude-code', 'en', 'I see you moving forward steadily'], ['dsh', 'en-GB', 'I see you moving forward steadily']] as const) {
    const bound = await client.bind({ host, sessionId: `same-library-${host}`, turnId: '1' });
    const choice = (await client.search(bound, 'steady 稳稳', 5, locale)).candidates.find(c => c.revision_id === expression.revision_id)!;
    assert.ok(choice, `${host} finds the new expression in any of its languages`);
    const sent = await client.express(bound, { selection_token: choice.selection_token });
    assert.equal(sent.status, 'sent');
    const projection = expressionProjection(sent.status === 'sent' ? sent.message.revision! : expression, locale);
    assert.equal(projection.meaning, meaning);
    assert.equal(JSON.stringify(projection).includes(expression.visual.primary.sha256), false, 'models never see media digests');
  }
  client = await restart();
  assert.deepEqual(await client.confirmDraft(saved.draft_id, saved.version), expression);
});

test('drafts keep incomplete input but preview applies every protocol rule', async t => {
  const { connect } = await sandbox(t);
  const client = await connect();
  const before = (await client.list()).length;
  const draft = await client.createDraft();
  const blank = await client.saveDraft(draft.draft_id, draft.version, { ...fields, name: { ...fields.name, 'zh-CN': '  ' } }, await upload(client));
  await assert.rejects(client.previewDraft(blank.draft_id, blank.version), /INVALID_SCHEMA/);
  assert.equal((await client.getDraft(blank.draft_id)).fields.name['zh-CN'], '  ', 'incomplete input is kept');
  for (const extra of [{ origin: 'local' }, { created_at: '2026-02-30T00:00:00Z' }, { expects: 'confirm' }, { kind: 'amoji.expression' }]) {
    await assert.rejects(client.saveDraft(blank.draft_id, blank.version, { ...fields, ...extra } as DraftFields), /INVALID_ARGUMENT/, JSON.stringify(extra));
  }
  const invalid: Array<[string, DraftFields, RegExp]> = [
    ['an unknown act', { ...fields, realizes: 'core:approve' }, /码位不在注册表/],
    ['a direction the act does not allow', { ...fields, realizes: 'core:ready', directions: ['h2a'] }, /方向/],
    ['a translation without provenance', { ...fields, semantics: { ...fields.semantics, en: { meaning: 'x', fallback: 'x' } } }, /translation/],
    ['a name over 40 code points', { ...fields, name: { ...fields.name, 'zh-CN': '😀'.repeat(41) } }, /INVALID_SCHEMA/],
  ];
  let version = blank.version;
  for (const [name, value, message] of invalid) {
    const saved = await client.saveDraft(blank.draft_id, version, value);
    version = saved.version;
    await assert.rejects(client.previewDraft(blank.draft_id, version), message, name);
  }
  const unicode = await client.saveDraft(blank.draft_id, version, { ...fields, name: { ...fields.name, 'zh-CN': '😀'.repeat(40) } });
  await client.previewDraft(unicode.draft_id, unicode.version);
  const changed = await client.saveDraft(unicode.draft_id, unicode.version, fields);
  await assert.rejects(client.confirmDraft(changed.draft_id, unicode.version), /DRAFT_CONFLICT/, 'confirmation is bound to the previewed version');
  assert.equal((await client.list()).length, before);
});

test('an animated upload gets an independent static poster; bad media never replaces the draft', async t => {
  const { connect } = await sandbox(t);
  const client = await connect();
  const draft = await client.createDraft();
  const saved = await client.saveDraft(draft.draft_id, draft.version, fields, await upload(client, true));
  const preview = await client.previewDraft(saved.draft_id, saved.version);
  assert.equal(preview.visual!.animated, true);
  assert.ok(preview.visual!.poster && preview.visual!.poster.sha256 !== preview.visual!.primary.sha256);
  await assert.rejects(client.saveDraft(saved.draft_id, saved.version, { ...fields, intensity: 1 }, Buffer.from('<svg/>').toString('base64')), /MEDIA_UNSUPPORTED/);
  assert.deepEqual(await client.getDraft(saved.draft_id), saved);
  const expression = await client.confirmDraft(saved.draft_id, saved.version);
  assert.deepEqual(expression.visual, { ...preview.visual, text_locale: null });
  assert.ok((await readFile(await client.blobPath(expression.visual.poster!.sha256))).length > 0);
});
