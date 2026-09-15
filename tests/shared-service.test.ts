import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixture = fileURLToPath(new URL('fixtures/shared-client.mjs', import.meta.url));
const sampleRoot = fileURLToPath(new URL('../assets/samples/', import.meta.url));
async function adapter(t: TestContext, directory: string) {
  const child = fork(fixture, { execArgv: ['--import', 'tsx'], env: { ...process.env, AMOJI_DATA_DIR: directory, AMOJI_SAMPLE_ROOT: sampleRoot, AMOJI_SERVICE_IDLE_MS: '500' }, silent: true });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  const ready = await new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('客户端启动超时')), 10000);
    child.once('message', value => { clearTimeout(timer); resolve(value); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
  });
  assert.ok(ready.ready?.serviceId, `客户端应连接共享服务：${ready.startup_error ?? '未返回服务身份'}`);
  let sequence = 0;
  const call = (operation: string, ...args: unknown[]) => new Promise<any>((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { child.off('message', receive); reject(new Error(`调用超时：${operation}`)); }, 10000);
    function receive(value: any) {
      if (value.id !== id) return;
      clearTimeout(timer); child.off('message', receive);
      if (value.error) reject(Object.assign(new Error(value.error), { code: value.code })); else resolve(value.value);
    }
    child.on('message', receive);
    child.send({ id, operation, args });
  });
  return { identity: ready.ready, call, child };
}
async function sandbox(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'amoji-shared-'));
  t.after(async () => {
    // Stop only the service identity created under this test's private root.
    try {
      const name = '../src/shared-client.js';
      const { stopSharedService } = await import(name);
      const descriptor = JSON.parse(await readFile(join(directory, 'service.json'), 'utf8'));
      await stopSharedService(directory, descriptor.serviceId);
    } catch {}
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

test('两个独立客户端并发冷启动只产生一个服务，隔离会话且断开一个后另一个继续收发', async t => {
  const directory = await sandbox(t);
  const [a, b] = await Promise.all([adapter(t, directory), adapter(t, directory)]);
  assert.equal(a.identity.serviceId, b.identity.serviceId);
  assert.equal(a.identity.dataRoot, b.identity.dataRoot);
  assert.notEqual(a.identity.pid, a.child.pid);
  assert.equal((await stat(directory)).mode & 0o777, 0o700);
  assert.equal((await stat(join(directory, 'service.json'))).mode & 0o777, 0o600);
  const contextA = { host: 'codex', hostInstanceId: 'local', sessionId: 'a', turnId: '1' };
  const contextB = { ...contextA, sessionId: 'b' };
  const aa = await a.call('bind', contextA);
  const bb = await b.call('bind', contextB);
  const list = await a.call('list');
  assert.equal(list.length, 3);
  assert.deepEqual(await b.call('list'), list);
  const candidate = (await a.call('search', aa, '加油')).candidates[0];
  await assert.rejects(b.call('emit', bb, candidate.selection_token), /其他会话/);
  const message = await a.call('emit', aa, candidate.selection_token);
  assert.equal(message.delivery, 'pending');
  assert.equal((await a.call('emit', aa, candidate.selection_token)).message_id, message.message_id);
  assert.deepEqual(await b.call('history', bb), []);
  await a.call('close');
  const ref = { asset_id: list[0].asset_id, revision_id: list[0].revision_id };
  const own = await b.call('receive', bb, ref, 'click-1');
  assert.equal((await b.call('receive', bb, ref, 'click-1')).message_id, own.message_id);
  assert.equal((await b.call('history', bb)).length, 1);
  await b.call('close');
});

test('服务重启后保留精确版本、动图素材、消息回执和已消费凭据的去重结果', async t => {
  const directory = await sandbox(t);
  const a = await adapter(t, directory);
  const context = { host: 'codex', hostInstanceId: 'local', sessionId: 'history', turnId: '1' };
  const binding = await a.call('bind', context);
  const candidate = (await a.call('search', binding, '加油')).candidates[0];
  const message = await a.call('emit', binding, candidate.selection_token);
  await a.call('presentation', binding, message.message_id, 'rendered');
  await a.call('close');
  const name = '../src/shared-client.js';
  const { stopSharedService } = await import(name);
  await stopSharedService(directory, a.identity.serviceId);
  const b = await adapter(t, directory);
  assert.notEqual(b.identity.serviceId, a.identity.serviceId);
  const resumed = await b.call('bind', context);
  assert.deepEqual(await b.call('resolve', { asset_id: candidate.asset_id, revision_id: candidate.revision_id }), message.revision);
  const history = await b.call('history', resumed);
  assert.deepEqual(history, [{ ...message, presentation: 'rendered' }]);
  assert.equal((await b.call('emit', resumed, candidate.selection_token)).message_id, message.message_id);
  for (const blob of [message.revision.visual.primary, message.revision.visual.poster]) {
    const path = await b.call('blobPath', blob.sha256);
    assert.ok(path.startsWith(b.identity.dataRoot));
    const bytes = await readFile(path);
    assert.equal(bytes.length, blob.bytes);
  }
  await b.call('close');
});

test('不兼容版本和伪造发现身份明确失败，不会覆盖正在使用的服务', async t => {
  const directory = await sandbox(t);
  const a = await adapter(t, directory);
  const name = '../src/shared-client.js';
  const { SharedClient, stopSharedService } = await import(name);
  await assert.rejects(SharedClient.connect({ directory, apiRange: { min: 2, max: 2 } }), /API_INCOMPATIBLE/);
  await assert.rejects(stopSharedService(directory, 'wrong-identity'), /SERVICE_IDENTITY_MISMATCH/);
  await assert.rejects(stopSharedService(directory, a.identity.serviceId), /SERVICE_BUSY/);
  const path = join(directory, 'service.json');
  const original = await readFile(path, 'utf8');
  await writeFile(path, JSON.stringify({ ...JSON.parse(original), serviceId: 'wrong-identity' }));
  await assert.rejects(SharedClient.connect({ directory }), /SERVICE_IDENTITY_MISMATCH/);
  await writeFile(path, original);
  assert.equal((await a.call('list')).length, 3);
  await a.call('close');
});
