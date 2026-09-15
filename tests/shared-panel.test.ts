import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { SharedClient, stopSharedService } from '../src/shared-client.js';
import { ConnectedRuntime } from '../src/adapter-runtime.js';
import { PanelServer } from '../src/panel-server.js';

test('适配器连接关闭会收口自己的待选请求，另一连接的面板仍可点选并保存固定消息', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'amoji-shared-pick-'));
  const a = await SharedClient.connect({ directory });
  const b = await SharedClient.connect({ directory });
  const opened: string[] = [];
  const panelA = await PanelServer.start(new ConnectedRuntime(a), async () => {});
  const panelB = await PanelServer.start(new ConnectedRuntime(b), async url => { opened.push(url); });
  t.after(async () => {
    await Promise.all([panelA.close(), panelB.close()]);
    await Promise.all([a.close(), b.close()]);
    await stopSharedService(directory, b.identity.serviceId);
    await rm(directory, { recursive: true, force: true });
  });
  const context = { host: 'codex' as const, sessionId: 'a', turnId: '1' };
  const pendingA = panelA.pick(context, new AbortController().signal).catch(error => error as Error);
  const pendingB = panelB.pick({ ...context, sessionId: 'b' }, new AbortController().signal);
  await a.close();
  const outcome = await Promise.race([pendingA, new Promise(resolve => setTimeout(() => resolve('timeout'), 1000))]);
  assert.ok(outcome instanceof Error, '关闭客户端后不应让自己的 pick 继续等待到五分钟超时');
  const url = new URL(opened[0]!);
  const headers = { Authorization: `Bearer ${url.hash.slice(1)}`, 'Content-Type': 'application/json' };
  const state = await (await fetch(`${url.origin}/api/state`, { headers })).json();
  const revision = state.expressions.find((e: any) => e.visual.animated);
  const response = await fetch(`${url.origin}/api/select`, { method: 'POST', headers, body: JSON.stringify({ pick_id: state.pending_pick, asset_id: revision.asset_id, revision_id: revision.revision_id }) });
  assert.equal(response.status, 200);
  const message = await pendingB;
  assert.equal((await response.json()).message_id, message.message_id);
  assert.equal(message.revision.revision_id, revision.revision_id);
  const binding = await b.bind({ ...context, sessionId: 'b' });
  assert.deepEqual(await b.history(binding), [message]);
});

test('共享服务收到终止信号时关闭活跃连接与待选，释放进程锁供下一实例恢复', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'amoji-service-stop-'));
  const client = await SharedClient.connect({ directory });
  const panel = await PanelServer.start(new ConnectedRuntime(client), async () => {});
  t.after(async () => { await panel.close(); await client.close(); await rm(directory, { recursive: true, force: true }); });
  const pending = panel.pick({ host: 'codex', sessionId: 'stopping', turnId: '1' }, new AbortController().signal).catch(error => error as Error);
  process.kill(client.identity.pid, 'SIGTERM');
  assert.ok(await pending instanceof Error);
  let exited = false;
  for (let i = 0; i < 50; i++) {
    try { process.kill(client.identity.pid, 0); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') { exited = true; break; } throw error; }
    await delay(20);
  }
  assert.ok(exited, '服务停止后不能由重新设置的空闲定时器继续占用进程');
});
