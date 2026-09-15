import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SampleCatalog } from '../src/sample-catalog.js';
import { SampleRuntime } from '../src/sample-runtime.js';

test('选择凭据绑定会话和回合，发送重试保持同一消息且不声称已显示', async () => {
  const catalog = await SampleCatalog.load(new URL('../assets/samples/', import.meta.url));
  const runtime = new SampleRuntime(catalog);
  const a = { host: 'codex' as const, sessionId: 'a', turnId: '1' };
  const b = { ...a, sessionId: 'b' };
  const choice = runtime.search(a, '庆祝').candidates[0]!;
  assert.throws(() => runtime.emit(b, choice.selection_token), /其他会话/);
  assert.throws(() => runtime.emit({ ...a, turnId: '2' }, choice.selection_token), /其他回合/);
  const first = runtime.emit(a, choice.selection_token);
  assert.equal(runtime.emit(a, choice.selection_token).message_id, first.message_id);
  assert.equal(first.presentation, 'pending');
  const secondChoice = runtime.search(a, '加油').candidates[0]!;
  assert.throws(() => runtime.emit(a, secondChoice.selection_token), /每回合/);
  assert.equal(runtime.messages(b).length, 0);
  assert.equal(runtime.messages(a).length, 1);
});

test('人工选择生成固定快照，重复提交相同请求不重复发送', async () => {
  const catalog = await SampleCatalog.load(new URL('../assets/samples/', import.meta.url));
  const runtime = new SampleRuntime(catalog);
  const context = { host: 'codex' as const, sessionId: 'a', turnId: '1' };
  const expression = catalog.all()[0]!;
  const first = runtime.receive(context, expression, 'click-1');
  assert.equal(first.direction, 'human_to_ai');
  assert.equal(runtime.receive(context, expression, 'click-1').message_id, first.message_id);
  assert.equal(runtime.messages(context).length, 1);
  assert.throws(() => runtime.receive(context, catalog.all()[1]!, 'click-1'), /已用于其他/);
});

test('随机选择凭据精确有效五分钟，已消费重试先返回原消息', async () => {
  let now = 1_000;
  const runtime = new SampleRuntime(await SampleCatalog.load(new URL('../assets/samples/', import.meta.url)), () => now);
  const context = { host: 'codex' as const, sessionId: 'expiry', turnId: '1' };
  const first = runtime.search(context, '庆祝').candidates[0]!;
  const expiring = runtime.search({ ...context, turnId: '2' }, '庆祝').candidates[0]!;
  assert.match(first.selection_token, /^[A-Za-z0-9_-]{32}$/);
  assert.notEqual(first.selection_token, expiring.selection_token);
  const message = runtime.emit(context, first.selection_token);
  now += 300_000;
  assert.throws(() => runtime.emit({ ...context, turnId: '2' }, expiring.selection_token), /过期/);
  assert.equal(runtime.emit(context, first.selection_token).message_id, message.message_id);
});
