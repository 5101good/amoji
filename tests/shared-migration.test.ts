import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openPrototypeState } from '../src/prototype-state.js';
import { LibraryStore } from '../src/library-store.js';
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

test('首次迁移会完整解码旧版本媒体，截断图片失败时保留旧库且不提交半成品', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'amoji-legacy-truncated-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const prototype = await openPrototypeState(new URL('../assets/samples/', import.meta.url), directory);
  const context = { host: 'codex' as const, sessionId: 'legacy-truncated', turnId: '1' };
  const original = prototype.runtime.catalog.all().find(expression => !expression.visual.animated)!;
  prototype.runtime.receive(context, original, 'legacy-truncated-click');
  prototype.journal.close();

  const source = await readFile(join(directory, 'samples', 'blobs', original.visual.primary.sha256));
  const truncated = source.subarray(0, Math.max(16, Math.floor(source.length / 2)));
  const digest = createHash('sha256').update(truncated).digest('hex');
  const legacy = structuredClone(original);
  legacy.asset_id = '90000000-0000-4000-8000-000000000006';
  legacy.revision_id = '91000000-0000-4000-8000-000000000006';
  legacy.name = '旧库截断媒体';
  legacy.visual.primary = { ...legacy.visual.primary, sha256: digest, bytes: truncated.length };
  await writeFile(join(directory, 'samples', 'blobs', digest), truncated);

  const legacyDatabasePath = join(directory, 'messages.sqlite');
  const legacyDatabase = new DatabaseSync(legacyDatabasePath);
  const definition = legacyDatabase.prepare('SELECT asset_id,revision_id FROM revision_definitions WHERE asset_id=? AND revision_id=?').get(original.asset_id, original.revision_id) as { asset_id: string; revision_id: string };
  legacyDatabase.prepare('DELETE FROM revision_definitions WHERE asset_id=? AND revision_id=?').run(definition.asset_id, definition.revision_id);
  legacyDatabase.prepare('INSERT INTO revision_definitions(asset_id,revision_id,data) VALUES (?,?,?)').run(legacy.asset_id, legacy.revision_id, JSON.stringify(legacy));
  const snapshotRow = legacyDatabase.prepare('SELECT session_key,data FROM session_snapshots WHERE session_key=?').get('codex:legacy-truncated') as { session_key: string; data: string };
  const snapshot = JSON.parse(snapshotRow.data);
  snapshot.messages[0].revision = legacy;
  legacyDatabase.prepare('UPDATE session_snapshots SET data=? WHERE session_key=?').run(JSON.stringify(snapshot), snapshotRow.session_key);
  legacyDatabase.close();

  const oldDatabase = await readFile(legacyDatabasePath);
  const oldBlob = await readFile(join(directory, 'samples', 'blobs', digest));
  await assert.rejects(LibraryStore.open(directory, new URL('../assets/samples/', import.meta.url)), /MEDIA_UNSUPPORTED/);
  assert.deepEqual(await readFile(legacyDatabasePath), oldDatabase);
  assert.deepEqual(await readFile(join(directory, 'samples', 'blobs', digest)), oldBlob);
  const shared = new DatabaseSync(join(directory, 'library.sqlite'), { readOnly: true });
  assert.equal((shared.prepare('SELECT count(*) AS count FROM revisions').get() as { count: number }).count, 0);
  assert.equal(shared.prepare("SELECT value FROM metadata WHERE key='initialized'").get(), undefined);
  shared.close();
});
