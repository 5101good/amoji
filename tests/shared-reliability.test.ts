import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { startSharedService } from '../src/shared-service.js';
import { SharedClient } from '../src/shared-client.js';
import { ConnectedRuntime } from '../src/adapter-runtime.js';

const seed = new URL('../assets/samples/', import.meta.url);
test('真实 connect 流在空闲时持续发送有界心跳，关闭一个租约不影响另一个客户端', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'amoji-heartbeat-'));
  const service = await startSharedService(directory, seed, 60000, 20);
  const abort = new AbortController(); let client: SharedClient | undefined;
  t.after(async () => { abort.abort(); await client?.close(); await service.close(); await rm(directory, { recursive: true, force: true }); });
  const d = JSON.parse(await readFile(join(directory, 'service.json'), 'utf8'));
  const response = await fetch(`${d.origin}/connect`, { headers: { Authorization: `Bearer ${d.secret}`, 'x-amoji-service': d.serviceId }, signal: abort.signal });
  const reader = response.body!.getReader();
  const first = new TextDecoder().decode((await reader.read()).value); assert.match(first, /connectionId/);
  client = await SharedClient.connect({ directory });
  for (let i = 0; i < 3; i++) {
    const frame = await Promise.race([reader.read(), delay(250).then(() => ({ timeout: true }))]);
    assert.ok(!('timeout' in frame), '空闲超过传输预算仍必须有保活数据');
    assert.match(new TextDecoder().decode(frame.value), /heartbeat/);
  }
  abort.abort();
  assert.equal((await client.list()).length, 3);
});

test('真实服务断线后显式重连保留原会话请求和已消费选择，旧绑定不迁移', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'amoji-reconnect-'));
  let service = await startSharedService(directory, seed); const client = await SharedClient.connect({ directory });
  t.after(async () => { await client.close(); await service.close(); await rm(directory, { recursive: true, force: true }); });
  const runtime = new ConnectedRuntime(client); const context = { host: 'dsh' as const, hostInstanceId: 'one', sessionId: 'a', turnId: '1' };
  const e = (await client.list())[0]!; const ref = { asset_id: e.asset_id, revision_id: e.revision_id }; const original = await runtime.receive(context, ref, 'original');
  const token = (await runtime.search(context, '加油')).candidates[0]!.selection_token;
  const emitted = await runtime.emit(context, token); const binding = await client.bind(context); const oldSignal = client.signal;
  await service.close();
  for (let i = 0; i < 30 && !oldSignal.aborted; i++) await delay(10);
  assert.equal(oldSignal.aborted, true);
  await assert.rejects(client.list(), /CONNECTION_CLOSED/);
  service = await startSharedService(directory, seed);
  await Promise.all([client.reconnect(), client.reconnect()]);
  assert.equal(runtime.connectionSignal.aborted, false);
  await assert.rejects(client.history(binding), /BINDING_UNAVAILABLE/);
  assert.equal((await runtime.receive(context, ref, 'original')).message_id, original.message_id);
  assert.equal((await runtime.emit(context, token)).message_id, emitted.message_id);
  assert.deepEqual(await runtime.messages({ ...context, sessionId: 'b' }), []);
  assert.equal((await runtime.messages(context)).length, 2);
});

test('RPC 响应丢失保留未知结果并终止失效连接，显式重连核对原请求不重复', async t => {
 const directory=await mkdtemp(join(tmpdir(),'amoji-lost-response-'));const service=await startSharedService(directory,seed);const client=await SharedClient.connect({directory});
 const originalFetch=globalThis.fetch;t.after(async()=>{globalThis.fetch=originalFetch;await client.close();await service.close();await rm(directory,{recursive:true,force:true});});
 const runtime=new ConnectedRuntime(client);const context={host:'dsh' as const,sessionId:'a'};const e=(await client.list())[0]!;const ref={asset_id:e.asset_id,revision_id:e.revision_id};
 globalThis.fetch=async(input,init)=>{const response=await originalFetch(input,init);if(String(input).endsWith('/rpc')&&JSON.parse(String(init?.body)).method==='receive'){await response.text();throw new TypeError('socket reset after commit');}return response;};
 await assert.rejects(runtime.receive(context,ref,'original'), /结果尚待核对/);assert.equal(client.signal.aborted,true);
 globalThis.fetch=originalFetch;await client.reconnect();const row=await runtime.receive(context,ref,'original');assert.equal((await runtime.messages(context)).length,1);assert.equal((await runtime.messages(context))[0]!.message_id,row.message_id);
});

test('旧 RPC 迟到失败只取消旧lease，显式恢复后的租约继续服务', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'amoji-lease-generation-'));
  const service = await startSharedService(directory, seed); const client = await SharedClient.connect({ directory });
  const originalFetch = globalThis.fetch; let release!: () => void; let entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }); const ready = new Promise<void>(resolve => { entered = resolve; });
  t.after(async () => { release(); globalThis.fetch = originalFetch; await client.close(); await service.close(); await rm(directory, { recursive: true, force: true }); });
  let failure = 0;
  globalThis.fetch = async (input, options) => {
    const response = await originalFetch(input, options);
    if (String(input).endsWith('/rpc') && JSON.parse(String(options?.body)).method === 'list' && failure < 2) {
      const index = failure++; await response.arrayBuffer();
      if (index === 0) { entered(); await gate; }
      throw new TypeError(`old RPC ${index} lost response`);
    }
    return response;
  };
  const oldSignal = client.signal; const late = assert.rejects(client.list(), /SERVICE_OUTCOME_UNKNOWN/); await ready;
  await assert.rejects(client.list(), /SERVICE_OUTCOME_UNKNOWN/); assert.equal(oldSignal.aborted, true);
  await client.reconnect(); const recoveredSignal = client.signal;
  assert.notEqual(recoveredSignal, oldSignal); assert.equal((await client.list()).length, 3);
  release(); await late;
  assert.equal(recoveredSignal.aborted, false, '旧请求异常不得中止新租约');
  assert.equal(client.signal, recoveredSignal); assert.equal((await client.list()).length, 3);
});
