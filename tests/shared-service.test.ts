import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { fork, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { SharedClient, stopSharedService } from '../src/shared-client.js';
import { ConnectedRuntime } from '../src/adapter-runtime.js';
import { DatabaseSync } from 'node:sqlite';

const fixture = fileURLToPath(new URL('fixtures/shared-client.mjs', import.meta.url));
const sampleRoot = fileURLToPath(new URL('../assets/samples/', import.meta.url));
const owned = new Map<string, { children: Set<ChildProcess>; services: Set<number> }>();
async function adapter(t: TestContext, directory: string, env: Record<string, string> = {}) {
  const child = fork(fixture, { execArgv: ['--import', 'tsx'], env: { ...process.env, AMOJI_DATA_DIR: directory, AMOJI_SAMPLE_ROOT: sampleRoot, AMOJI_SERVICE_IDLE_MS: '500', ...env }, silent: true });
  owned.get(directory)!.children.add(child);
  const ready = await new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('客户端启动超时')), 10000);
    child.once('message', value => { clearTimeout(timer); resolve(value); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
  });
  assert.ok(ready.ready?.serviceId, `客户端应连接共享服务：${ready.startup_error ?? '未返回服务身份'}`);
  owned.get(directory)!.services.add(ready.ready.pid);
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
  const instances = { children: new Set<ChildProcess>(), services: new Set<number>() };
  owned.set(directory, instances);
  t.after(async () => {
    await Promise.all([...instances.children].map(async child => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      await new Promise<void>(resolve => { child.once('exit', () => resolve()); if (child.connected) child.disconnect(); else child.kill('SIGTERM'); });
    }));
    // Stop only the service identity created under this test's private root.
    try {
      const name = '../src/shared-client.js';
      const { stopSharedService } = await import(name);
      const descriptor = JSON.parse(await readFile(join(directory, 'service.json'), 'utf8'));
      await stopSharedService(directory, descriptor.serviceId);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    for (const pid of instances.services) {
      for (let i = 0; i < 150 && alive(pid); i++) await delay(20);
      assert.equal(alive(pid), false, '测试所属服务必须退出后才能删除数据根');
    }
    await rm(directory, { recursive: true, force: true });
    owned.delete(directory);
  });
  return directory;
}
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; throw error; }
}

test('首次候选真实退出75后重新竞选，临时写入锁释放即可完成冷启动', async t => {
  const directory = await sandbox(t);
  const marker = join(directory, 'candidate-exit.txt');
  const lock = new DatabaseSync(join(directory, 'service-lock.sqlite'));
  lock.exec('BEGIN EXCLUSIVE; CREATE TABLE IF NOT EXISTS owner (id TEXT);');
  const preload = new URL('fixtures/candidate-exit.mjs', import.meta.url).href;
  const connecting = adapter(t, directory, { AMOJI_TEST_ELECTION_FILE: marker, NODE_OPTIONS: [process.env.NODE_OPTIONS, `--import=${preload}`].filter(Boolean).join(' ') });
  try {
    let observed = false;
    for (let i = 0; i < 100; i++) {
      try { observed = (await readFile(marker, 'utf8')) === '75'; if (observed) break; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      await delay(20);
    }
    assert.ok(observed, '必须观察到真实候选因写入锁被占用而退出75');
  } finally { lock.close(); }
  const client = await connecting;
  assert.equal((await client.call('list')).length, 3);
  await client.call('close');
});

test('停止返回前完成真实数据库关闭，立即重连不因旧写入锁而超时', async t => {
  const directory = await sandbox(t);
  const preload = pathToFileURL(fileURLToPath(new URL('fixtures/slow-sqlite-close.mjs', import.meta.url))).href;
  const a = await adapter(t, directory, { NODE_OPTIONS: [process.env.NODE_OPTIONS, `--import=${preload}`].filter(Boolean).join(' ') });
  await a.call('close');
  const name = '../src/shared-client.js';
  const { stopSharedService } = await import(name);
  await stopSharedService(directory, a.identity.serviceId);
  assert.equal(alive(a.identity.pid), false, '发现文件消失不能冒充持有写入锁的服务已退出');
  const b = await adapter(t, directory);
  assert.notEqual(b.identity.serviceId, a.identity.serviceId);
  assert.equal((await b.call('list')).length, 3);
  await b.call('close');
});

test('检索与重启清理过期未消费凭据，已消费凭据仍随消息保留幂等结果', async t => {
  const directory = await sandbox(t);
  const clockFile = join(directory, 'clock.txt');
  await writeFile(clockFile, '0');
  const preload = new URL('fixtures/clock-offset.mjs', import.meta.url).href;
  const env = { AMOJI_TEST_CLOCK_FILE: clockFile, NODE_OPTIONS: [process.env.NODE_OPTIONS, `--import=${preload}`].filter(Boolean).join(' ') };
  const a = await adapter(t, directory, env);
  const context = { host: 'codex', sessionId: 'retention', turnId: '1' };
  const binding = await a.call('bind', context);
  const used = (await a.call('search', binding, '加油')).candidates[0].selection_token;
  const message = await a.call('emit', binding, used);
  const expired = (await a.call('search', binding, '庆祝')).candidates[0].selection_token;
  await writeFile(clockFile, '360000');
  const next = (await a.call('search', binding, '自嘲')).candidates[0].selection_token;
  await assert.rejects(a.call('emit', binding, expired), { code: 'SELECTION_UNAVAILABLE' });
  assert.equal((await a.call('emit', binding, used)).message_id, message.message_id);
  await a.call('close');
  const name = '../src/shared-client.js';
  await (await import(name)).stopSharedService(directory, a.identity.serviceId);
  await writeFile(clockFile, '720000');
  const b = await adapter(t, directory, env);
  const resumed = await b.call('bind', context);
  await assert.rejects(b.call('emit', resumed, next), { code: 'SELECTION_UNAVAILABLE' });
  assert.deepEqual(await b.call('history', resumed), [message]);
  assert.equal((await b.call('emit', resumed, used)).message_id, message.message_id);
  await b.call('close');
});

test('适配器操作结束释放实际绑定，多回合调用不使先前在途绑定失效', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'amoji-binding-lifetime-'));
  const client = await SharedClient.connect({ directory });
  t.after(async () => { await client.close(); await stopSharedService(directory, client.identity.serviceId); await rm(directory, { recursive: true, force: true }); });
  const context = { host: 'codex' as const, sessionId: 'long-lived', turnId: '1' };
  const inFlight = await client.bind(context);
  const choice = (await client.search(inFlight, '一步一步来')).candidates[0]!;
  // Observe public handles without replacing the actual transport or service.
  const issued: string[] = [];
  const bind = client.bind.bind(client);
  client.bind = async value => { const id = await bind(value); issued.push(id); return id; };
  const runtime = new ConnectedRuntime(client);
  for (const turnId of ['2', '3', '2']) {
    assert.deepEqual(await runtime.messages({ ...context, turnId }), []);
    assert.ok(issued.length > 0);
    for (const id of issued) await assert.rejects(client.history(id), { code: 'BINDING_UNAVAILABLE' });
  }
  await assert.rejects(runtime.emit({ ...context, turnId: 'wrong-turn' }, choice.selection_token), /其他回合/);
  for (const id of issued) await assert.rejects(client.history(id), { code: 'BINDING_UNAVAILABLE' });
  const message = await client.emit(inFlight, choice.selection_token);
  assert.equal(message.revision.revision_id, choice.revision_id);
  assert.equal((await client.emit(inFlight, choice.selection_token)).message_id, message.message_id);
  assert.deepEqual(await runtime.messages(context), [message]);
  for (const id of issued) await assert.rejects(client.history(id), { code: 'BINDING_UNAVAILABLE' });
});

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
  await assert.rejects(SharedClient.connect({ directory, apiRange: { min: 3, max: 3 } }), /API_INCOMPATIBLE/);
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
