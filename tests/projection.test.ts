import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { expressionProjection, humanExpressionText, messageProjection } from '../src/projection.js';
import type { Pack } from '../src/protocol/index.js';
import { OFFICIAL } from './helpers/store-runtime.js';

const classic: Pack = JSON.parse(await readFile(new URL('classic.manifest.json', OFFICIAL), 'utf8'));

test('模型获得完整固定语义和精确版本，不获得图片或本地路径', () => {
  const e = classic.expressions.find(x => x.visual.animated)!;
  const value = expressionProjection(e, 'zh-CN');
  assert.deepEqual(Object.keys(value).sort(), ['act', 'asset_id', 'avoid_when', 'fallback', 'intensity', 'meaning', 'name', 'revision_id', 'use_when']);
  assert.deepEqual([value.asset_id, value.revision_id, value.act], [e.asset_id, e.revision_id, e.realizes]);
  assert.equal(value.meaning, e.semantics['zh-CN']!.meaning);
  const text = JSON.stringify(value);
  for (const blob of [e.visual.primary, e.visual.poster!]) assert.ok(!text.includes(blob.sha256), 'no media digest reaches the model');
  assert.ok(!/blobs|\.amoji|file:/.test(text));
});

test('projections follow the locale chain and say when they fall back', () => {
  const e = classic.expressions[0]!;
  assert.equal(expressionProjection(e, 'en-GB').meaning, e.semantics.en!.meaning, 'en-GB truncates to en');
  const fallback = expressionProjection(e, 'ja');
  assert.equal(fallback.meaning, e.semantics['zh-CN']!.meaning, 'an unavailable language falls back to the original');
  assert.equal(fallback.meaning_locale, 'zh-CN');
  assert.equal(expressionProjection(e, 'zh-Hant').meaning_locale, 'zh-CN', 'no cross-script fallback is presented as Traditional Chinese');
});

test('human messages read as one sentence of the user; retracted messages carry no meaning', () => {
  const e = classic.expressions.find(x => x.realizes === 'core:example')!;
  const message = { message_id: 'm1', direction: 'human_to_ai' as const, act: e.realizes, intensity: e.intensity, from: { role: 'human' as const }, mode: 'turn' as const, revision: e, created_at: '2026-01-01T00:00:00Z', presentation: 'pending' as const, note: '第三步' };
  const projection = messageProjection(message as never, 'en');
  assert.deepEqual([projection.act, projection.expects, projection.note, projection.meaning], ['core:example', 'example', '第三步', e.semantics.en!.meaning]);
  assert.ok(humanExpressionText(message as never, 'en').includes('"act":"core:example"'));
  const retracted = messageProjection({ ...message, retracted_at: '2026-01-01T00:01:00Z' } as never);
  assert.equal(retracted.state, 'retracted');
  assert.equal('meaning' in retracted || 'note' in retracted, false);
});
