import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capabilityCard, humanExpressionText, messageProjection } from '../src/projection.js';
import { amojiTools, runModelTool, EXPRESS_DESCRIPTION } from '../src/model-tools.js';
import { DEFAULT_PREFERENCES } from '../src/library-management.js';
import { argumentsDigest } from '../src/claude-context.js';
import { openStore, storeRuntime } from './helpers/store-runtime.js';

const context = { host: 'claude-code' as const, hostInstanceId: 'test', sessionId: 's', turnId: 't1' };

test('the capability card is static, bounded and lists only AI-sendable acts', () => {
  for (const locale of ['zh-CN', 'en']) {
    const card = capabilityCard({ locale, preferences: DEFAULT_PREFERENCES, modes: ['turn', 'backchannel', 'interrupt'], features: ['anchor', 'note', 'options'] });
    assert.ok(Buffer.byteLength(card) <= 3 * 1024, `${locale} card is ${Buffer.byteLength(card)} bytes`);
    assert.ok(card.includes('core:decide') && !card.includes('core:stop '), 'reduce acts are human-only');
    assert.equal(card, capabilityCard({ locale, preferences: DEFAULT_PREFERENCES, modes: ['turn', 'backchannel', 'interrupt'], features: ['anchor', 'note', 'options'] }));
  }
  assert.ok(EXPRESS_DESCRIPTION.includes('core:ack') && !EXPRESS_DESCRIPTION.includes('core:not-what-i-meant'));
  assert.deepEqual(amojiTools.map(t => t.name), ['amoji_express', 'amoji_search', 'amoji_resolve']);
});

test('tools express by act, project text only and surface rejection codes', async () => {
  const { store, directory, close } = await openStore();
  try {
    const runtime = storeRuntime(store, directory);
    const sent = await runModelTool(runtime, context, 'amoji_express', { act: 'core:uncertain', rationale: '只看到一处日志' }, 'en');
    assert.equal(sent.result.status, 'sent');
    assert.equal(sent.result.gloss, 'Not sure yet');
    assert.ok(!JSON.stringify(sent.result).includes(sent.message!.revision!.visual.primary.sha256), 'no glyph hash or path reaches the model');
    const limited = await runModelTool(runtime, context, 'amoji_express', { act: 'core:ack' });
    assert.deepEqual([limited.result.status, limited.result.reason], ['rejected', 'rate_limited']);
    const resolved = await runModelTool(runtime, context, 'amoji_resolve', { message_id: sent.message!.message_id }, 'zh-CN');
    assert.equal(resolved.result.rationale, '只看到一处日志');
    const searched = await runModelTool(runtime, context, 'amoji_search', { query: '庆祝' });
    assert.ok((searched.result.candidates as unknown[]).length > 0);
  } finally { await close(); }
});

test('human expressions reach the model as one sentence with data-only material', async () => {
  const { store, close } = await openStore();
  try {
    const message = store.receive(context, { act: 'core:not-what-i-meant', note: '我说的是服务端分页', anchor: { message_id: 'm1', exact: '在前端分页' }, mode: 'backchannel', sent_during: 't1' }, 'r1');
    const projection = messageProjection(message, 'zh-CN');
    assert.deepEqual([projection.expects, projection.note, projection.state], ['correct', '我说的是服务端分页', 'queued']);
    assert.deepEqual(projection.anchor, { exact: '在前端分页', degraded: false });
    assert.ok(humanExpressionText(message).startsWith('这是用户的表达，效力等同于用户的一句话'));
    store.retract(context, message.message_id);
    assert.equal(messageProjection(store.history(context)[0]!).state, 'retracted');
  } finally { await close(); }
});

test('Claude argument digests ignore key order at every depth', () => {
  assert.equal(argumentsDigest({ act: 'core:decide', options: [{ id: 'a', label: 'A' }] }), argumentsDigest({ options: [{ label: 'A', id: 'a' }], act: 'core:decide' }));
  assert.notEqual(argumentsDigest({ replies: ['core:ack', 'core:clarify'] }), argumentsDigest({ replies: ['core:clarify', 'core:ack'] }));
});
