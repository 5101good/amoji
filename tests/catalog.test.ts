import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SampleCatalog } from '../src/sample-catalog.js';

test('候选包含完整语义，精确解析拒绝错配版本，修改返回值不改写样本', async () => {
  const catalog = await SampleCatalog.load(new URL('../assets/samples/', import.meta.url));
  const found = catalog.search('加油');
  assert.equal(found.length, 1);
  const item = found[0]!;
  assert.deepEqual(item.semantics.avoid_when, ['用表情代替具体帮助或必要解释']);
  const ref = { asset_id: item.asset_id, revision_id: item.revision_id };
  item.semantics.meaning = '不能改写';
  assert.equal(catalog.resolve(ref).semantics.meaning, '支持你的努力，我们一步一步来。');
  assert.throws(() => catalog.resolve({ ...ref, revision_id: 'latest' }), /版本不存在/);
  assert.deepEqual(catalog.search('完全不存在的语境'), []);
  assert.throws(() => catalog.search('加油', 6), /1–5/);
});
