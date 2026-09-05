import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, cp, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessageJournal } from '../src/message-journal.js';
import { SampleCatalog } from '../src/sample-catalog.js';
import { SampleRuntime } from '../src/sample-runtime.js';
import { openPrototypeState } from '../src/prototype-state.js';
import { readFile } from 'node:fs/promises';
import { PanelServer } from '../src/panel-server.js';

test('插件重启后恢复人类与 AI 消息的固定视觉快照，并保持会话隔离', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'amoji-history-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const catalog = await SampleCatalog.load(new URL('../assets/samples/', import.meta.url));
  const context = { host: 'codex' as const, sessionId: 'a', turnId: '1' };
  const file = join(directory, 'messages.sqlite');
  const firstJournal = new MessageJournal(file);
  const first = new SampleRuntime(catalog, Date.now, firstJournal);
  const human = first.receive(context, catalog.all()[0]!, 'click-1');
  const ai = first.emit(context, first.search(context, '加油').candidates[0]!.selection_token);
  firstJournal.close();
  const journal = new MessageJournal(file);
  t.after(() => journal.close());
  const restored = new SampleRuntime(catalog, Date.now, journal);
  assert.deepEqual(restored.messages(context), [human, ai]);
  assert.equal(restored.messages({ ...context, sessionId: 'b' }).length, 0);
  const ref = restored.messages(context)[0]!.revision;
  assert.equal(ref.visual.primary.sha256, human.revision.visual.primary.sha256);
  assert.equal(restored.receive(context, ref, 'click-1').message_id, human.message_id);
});

test('历史视觉读取稳定数据目录，不再依赖插件缓存路径', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'amoji-state-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { runtime, journal } = await openPrototypeState(new URL('../assets/samples/', import.meta.url), directory);
  t.after(() => journal.close());
  const expression = runtime.catalog.all()[0]!;
  const context = { host: 'codex' as const, sessionId: 'history', turnId: '1' };
  runtime.receive(context, expression, 'click');
  assert.ok(runtime.catalog.root.pathname.startsWith(directory));
  const bytes = await readFile(new URL(`blobs/${expression.visual.primary.sha256}`, runtime.catalog.root));
  assert.equal(bytes.length, expression.visual.primary.bytes);
});

test('同会话的两个活跃进程能读到新消息，并正确保存展示回执', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'amoji-history-readers-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const catalog = await SampleCatalog.load(new URL('../assets/samples/', import.meta.url));
  const firstJournal = new MessageJournal(join(directory, 'messages.sqlite'));
  const secondJournal = new MessageJournal(join(directory, 'messages.sqlite'));
  t.after(() => { firstJournal.close(); secondJournal.close(); });
  const first = new SampleRuntime(catalog, Date.now, firstJournal);
  const second = new SampleRuntime(catalog, Date.now, secondJournal);
  const context = { host: 'codex' as const, sessionId: 'same-thread', turnId: '1' };
  assert.deepEqual(second.messages(context), []);
  const message = first.receive(context, catalog.all()[0]!, 'click');
  assert.deepEqual(second.messages(context), [message]);
  second.acknowledge(context, message.message_id, 'rendered');
  assert.equal(first.messages(context)[0]!.presentation, 'rendered');
});

test('升级样本不能复用既有版本 ID 来改变历史语义，即使旧样本已退出清单', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'amoji-revision-conflict-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = new URL('../assets/samples/', import.meta.url);
  const data = join(directory, 'data');
  const first = await openPrototypeState(source, data);
  first.journal.close();
  const alternative = join(directory, 'source');
  await cp(source, alternative, { recursive: true });
  const manifest = JSON.parse(await readFile(join(alternative, 'manifest.json'), 'utf8'));
  const removed = manifest.expressions.shift();
  await writeFile(join(alternative, 'manifest.json'), JSON.stringify(manifest));
  const second = await openPrototypeState(pathToFileURL(`${alternative}/`), data);
  second.journal.close();
  removed.semantics.meaning = '更改旧版本的语义';
  manifest.expressions.push(removed);
  await writeFile(join(alternative, 'manifest.json'), JSON.stringify(manifest));
  await assert.rejects(async () => {
    const conflicting = await openPrototypeState(pathToFileURL(`${alternative}/`), data);
    conflicting.journal.close();
  }, /REVISION_CONFLICT/);
});

test('面板重启后仍提供退出当前清单的历史动图、封面和固定定义', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'amoji-panel-history-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const data = join(directory, 'data');
  const original = new URL('../assets/samples/', import.meta.url);
  const first = await openPrototypeState(original, data);
  const context = { host: 'codex' as const, sessionId: 'old-history', turnId: '1' };
  const animation = first.runtime.catalog.all().find(expression => expression.visual.animated)!;
  const message = first.runtime.receive(context, animation, 'human-click');
  const firstPanel = await PanelServer.start(first.runtime, async () => {});
  const oldCapability = new URL(firstPanel.url(context)).hash.slice(1);
  await firstPanel.close();
  first.journal.close();
  const changed = join(directory, 'updated-source');
  await cp(original, changed, { recursive: true });
  const manifest = JSON.parse(await readFile(join(changed, 'manifest.json'), 'utf8'));
  manifest.expressions = manifest.expressions.filter((expression: { revision_id: string }) => expression.revision_id !== animation.revision_id);
  await writeFile(join(changed, 'manifest.json'), JSON.stringify(manifest));
  const restored = await openPrototypeState(pathToFileURL(`${changed}/`), data);
  const panel = await PanelServer.start(restored.runtime, async () => {});
  t.after(async () => { await panel.close(); restored.journal.close(); });
  const url = new URL(panel.url(context));
  const headers = { Authorization: `Bearer ${url.hash.slice(1)}` };
  assert.equal((await fetch(`${url.origin}/api/state`, { headers: { Authorization: `Bearer ${oldCapability}` } })).status, 401);
  const state = await (await fetch(`${url.origin}/api/state`, { headers })).json();
  assert.deepEqual(state.messages, [message]);
  assert.ok(!state.expressions.some((expression: { revision_id: string }) => expression.revision_id === animation.revision_id));
  for (const blob of [animation.visual.primary, animation.visual.poster!]) {
    const response = await fetch(`${url.origin}/blobs/${blob.sha256}`, { headers });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), blob.mime);
    assert.equal((await response.arrayBuffer()).byteLength, blob.bytes);
  }
});
