import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openPrototypeState } from '../src/prototype-state.js';
import { SharedClient, stopSharedService } from '../src/shared-client.js';

test('旧样本库只读复制到共享服务，原数据库、清单与旧图片路径不变且历史精确恢复', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'amoji-legacy-'));
  let client: SharedClient | undefined;
  t.after(async () => {
    if (client) { await client.close(); await stopSharedService(directory, client.identity.serviceId); }
    await rm(directory, { recursive: true, force: true });
  });
  const prototype = await openPrototypeState(new URL('../assets/samples/', import.meta.url), directory);
  const context = { host: 'codex' as const, sessionId: 'legacy-thread', turnId: '1' };
  const revision = prototype.runtime.catalog.all().find(e => e.visual.animated)!;
  const old = prototype.runtime.receive(context, revision, 'legacy-click');
  prototype.runtime.acknowledge(context, old.message_id, 'rendered');
  prototype.journal.close();
  const legacyFiles = ['messages.sqlite', 'samples/manifest.json', `samples/blobs/${revision.visual.primary.sha256}`];
  const before = await Promise.all(legacyFiles.map(path => readFile(join(directory, path))));
  client = await SharedClient.connect({ directory });
  const binding = await client.bind(context);
  assert.deepEqual(await client.history(binding), [{ ...old, presentation: 'rendered' }]);
  assert.equal((await client.receive(binding, { asset_id: revision.asset_id, revision_id: revision.revision_id }, 'legacy-click')).message_id, old.message_id);
  assert.deepEqual(await client.resolve({ asset_id: revision.asset_id, revision_id: revision.revision_id }), revision);
  assert.deepEqual(await Promise.all(legacyFiles.map(path => readFile(join(directory, path)))), before);
  assert.deepEqual(await readFile(await client.blobPath(revision.visual.primary.sha256)), before[2]);
  await client.close(); await stopSharedService(directory, client.identity.serviceId); client = undefined;
  // A later legacy-writer change must not overwrite the already imported shared history.
  await writeFile(join(directory, 'samples/manifest.json'), '{invalid legacy manifest');
  client = await SharedClient.connect({ directory });
  assert.deepEqual(await client.history(await client.bind(context)), [{ ...old, presentation: 'rendered' }]);
});

test('更高数据库版本拒绝启动且原文件不被降级或重建', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'amoji-future-db-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'library.sqlite');
  const future = new DatabaseSync(path); future.exec('PRAGMA user_version=99; CREATE TABLE future_data(value TEXT); INSERT INTO future_data VALUES (\'keep\')'); future.close();
  const original = await readFile(path);
  await assert.rejects(SharedClient.connect({ directory }), /DATABASE_INCOMPATIBLE/);
  assert.deepEqual(await readFile(path), original);
});
