import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withValidatedPack, type ScenarioPack } from '../src/packs.js';
import { LibraryStore } from '../src/library-store.js';

const root = new URL('../assets/scenario-packs/', import.meta.url);
const cases = [
  ['make-it-clear', '把话说明白 / Make it clear', ['没看懂', '说具体些', '举个例子', '需要你确认']],
  ['work-well-together', '一起把事做好 / Work well together', ['卡在哪里', '正在核对', '我来处理']],
  ['collaborate-comfortably', '轻松一点合作 / Collaborate comfortably', ['辛苦了', '不客气', '暂时没把握']],
] as const;
for (const [slug, name, names] of cases) test(`正式场景包 ${slug}：许可、双画风、固定语义与双格式公开往返`, async t => {
  const source = JSON.parse(await readFile(new URL('../assets/base-library/manifest.json', import.meta.url), 'utf8'));
  const dir = await mkdtemp(join(tmpdir(), 'amoji-seed-'));
  const store = await LibraryStore.open(dir, new URL('../assets/base-library/base.amoji', import.meta.url));
  t.after(async () => { store.close(); await rm(dir, { recursive: true, force: true }); });
  const bytes = await readFile(new URL(`${slug}.amoji`, root));
  const pack = await withValidatedPack(bytes, async p => structuredClone(p.manifest), 'market') as ScenarioPack;
  assert.equal(pack.name, name); assert.equal(pack.schema_version, '0.2');
  assert.equal(pack.rights.license, 'CC0-1.0'); assert.equal(pack.expressions.length, names.length * 2);
  assert.match(pack.description!, /提示.*不保证.*guidance/i);
  assert.ok(pack.examples!.every(e => e.startsWith('示例 / Example:')));
  assert.ok(pack.examples!.some(e => e.includes('人→AI / Human→AI')));
  assert.ok(pack.examples!.some(e => e.includes('AI→人 / AI→Human')));
  for (const style of ['classic', 'office']) {
    const expressions = pack.expressions.filter(e => e.tags?.includes(`amoji:appearance:${style}`));
    assert.deepEqual(expressions.map(e => e.name), names);
    for (const e of expressions) {
      assert.deepEqual(e, source.expressions.find((v: any) => v.asset_id === e.asset_id), '不得改写已确认语义、身份或素材');
      const sibling = pack.expressions.find(v => v.name === e.name && v.asset_id !== e.asset_id)!;
      assert.deepEqual(e.semantics, sibling.semantics);
      const actionIds = (ref: string) => pack.bindings.find(b => b.expression.asset_id === ref)?.actions ?? [];
      assert.deepEqual(actionIds(e.asset_id), actionIds(sibling.asset_id), '画风不改变动作');
    }
  }
  const imported = await store.importPack(bytes);
  assert.ok(imported.actions?.every(a => a.enabled === false));
  await withValidatedPack(await store.exportScenarioPack(pack.release_id), async p => assert.deepEqual(p.manifest, pack));
  for (const legacy of [await store.exportScenarioPack(pack.release_id, true), await readFile(new URL(`${slug}.expressions.amoji`, root))]) {
    await withValidatedPack(legacy, async p => {
      assert.equal(p.manifest.schema_version, '0.1'); assert.equal('actions' in p.manifest, false);
      assert.deepEqual(p.manifest.expressions, pack.expressions);
    }, 'market');
  }
  if (slug === 'collaborate-comfortably') { assert.deepEqual(pack.actions, []); assert.deepEqual(pack.bindings, []); }
});
