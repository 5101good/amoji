import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelProjection } from '../src/projection.js';
import example from '../docs/specs/examples/expression.example.json' with { type: 'json' };

test('模型获得完整固定语义和精确版本，不获得图片或本地路径', () => {
  const text = modelProjection(example);
  const value = JSON.parse(text);
  assert.deepEqual(value.semantics, example.semantics);
  assert.equal(value.asset_id, example.asset_id);
  assert.equal(value.revision_id, example.revision_id);
  assert.deepEqual(Object.keys(value).sort(), ['asset_id', 'name', 'revision_id', 'semantics']);
  assert.ok(!text.includes(example.visual.primary.sha256));
});
