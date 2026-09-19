import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { startSharedService } from '../src/shared-service.js';
import { SharedClient } from '../src/shared-client.js';
import { LibraryStore } from '../src/library-store.js';

const fields = { name: '慢媒体恢复', semantics: { locale: 'zh-CN', meaning: '耐心等待', fallback: '等待' }, rights: { license: '个人使用' } };
test('真实公共媒体请求超过旧5秒仍返回确定结果，save重试保留CAS且确认幂等', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'amoji-slow-create-'));
  const service = await startSharedService(directory, new URL('../assets/samples/', import.meta.url));
  const client = await SharedClient.connect({ directory });
  const original = { saveDraft: LibraryStore.prototype.saveDraft, previewDraft: LibraryStore.prototype.previewDraft, confirmDraft: LibraryStore.prototype.confirmDraft };
  t.after(async () => { Object.assign(LibraryStore.prototype, original); await client.close(); await service.close(); await rm(directory, { recursive: true, force: true }); });
  const sample = (await client.list()).find(e => e.visual.animated)!;
  const upload = (await readFile(await client.blobPath(sample.visual.primary.sha256))).toString('base64');
  const initial = await client.createDraft();
  // Keep the real writer/decoder/HTTP boundary; delay only returning each result.
  LibraryStore.prototype.saveDraft = async function (...args) { const value = await original.saveDraft.apply(this, args); await delay(5200); return value; };
  const saved = await client.saveDraft(initial.draft_id, initial.version, fields, upload);
  assert.deepEqual(saved, await client.getDraft(initial.draft_id));
  LibraryStore.prototype.saveDraft = original.saveDraft;
  assert.deepEqual(await client.saveDraft(initial.draft_id, initial.version, fields, upload), saved);
  await assert.rejects(client.saveDraft(initial.draft_id, initial.version, { ...fields, name: '另一个写入' }, upload), /DRAFT_CONFLICT/);
  LibraryStore.prototype.previewDraft = async function (...args) { const value = await original.previewDraft.apply(this, args); await delay(5200); return value; };
  assert.deepEqual(await client.previewDraft(saved.draft_id, saved.version), saved);
  LibraryStore.prototype.previewDraft = original.previewDraft;
  LibraryStore.prototype.confirmDraft = async function (...args) { const value = await original.confirmDraft.apply(this, args); await delay(5200); return value; };
  const confirmed = await client.confirmDraft(saved.draft_id, saved.version);
  LibraryStore.prototype.confirmDraft = original.confirmDraft;
  assert.deepEqual(await client.confirmDraft(saved.draft_id, saved.version), confirmed);
  assert.equal((await client.list()).length, 4);
});

test('已提交保存或确认的响应丢失时报告待核对，同一公共请求重试不重复写入且跨重启保留', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'amoji-recover-create-'));
  let service = await startSharedService(directory, new URL('../assets/samples/', import.meta.url));
  let client = await SharedClient.connect({ directory });
  const nativeFetch = globalThis.fetch;
  t.after(async () => { globalThis.fetch = nativeFetch; await client.close(); await service.close(); await rm(directory, { recursive: true, force: true }); });
  const sample = (await client.list())[0]!;
  const upload = (await readFile(await client.blobPath(sample.visual.primary.sha256))).toString('base64');
  const initial = await client.createDraft();
  let lost = 'saveDraft';
  globalThis.fetch = async (input, options) => {
    const response = await nativeFetch(input, options);
    if (options?.body && JSON.parse(String(options.body)).method === lost) { lost = ''; await response.arrayBuffer(); throw new TypeError('模拟已提交后连接中断'); }
    return response;
  };
  await assert.rejects(client.saveDraft(initial.draft_id, initial.version, fields, upload), /DRAFT_OUTCOME_UNKNOWN/);
  assert.equal(client.signal.aborted, true); await client.reconnect();
  const afterSave = await client.getDraft(initial.draft_id);
  assert.equal(afterSave.version, initial.version + 1);
  await client.close(); await service.close();
  service = await startSharedService(directory, new URL('../assets/samples/', import.meta.url)); client = await SharedClient.connect({ directory });
  assert.deepEqual(await client.saveDraft(initial.draft_id, initial.version, fields, upload), afterSave);
  lost = 'previewDraft';
  await assert.rejects(client.previewDraft(afterSave.draft_id, afterSave.version), /DRAFT_PREVIEW_UNAVAILABLE/);
  assert.equal(client.signal.aborted, true); await client.reconnect();
  assert.deepEqual(await client.getDraft(afterSave.draft_id), afterSave);
  const other = await client.saveDraft(afterSave.draft_id, afterSave.version, { ...fields, name: '另一窗口的新版本' });
  await assert.rejects(client.saveDraft(initial.draft_id, initial.version, fields, upload), /DRAFT_CONFLICT/);
  assert.deepEqual(await client.getDraft(other.draft_id), other);
  lost = 'confirmDraft';
  await assert.rejects(client.confirmDraft(other.draft_id, other.version), /DRAFT_OUTCOME_UNKNOWN/);
  assert.equal(client.signal.aborted, true); await client.reconnect();
  const confirmed = await client.confirmDraft(other.draft_id, other.version);
  assert.deepEqual((await client.list()).find(e => e.asset_id === confirmed.asset_id), confirmed);
  assert.equal((await client.list()).length, 4);
});
