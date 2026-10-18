import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { withValidatedPack, type ScenarioPack } from '../src/packs.js';
import { LibraryStore } from '../src/library-store.js';

const root = new URL('../assets/official-packs/', import.meta.url);
const slugs = ['classic', 'office', 'slow-cat', 'good-dog', 'pixel-pal', 'orbit-jelly', 'paper-goose'];
test('官方目录按两套完整画风与五套原创角色组织，下载摘要与实际包一致', async () => {
  const catalog = JSON.parse(await readFile(new URL('catalog.json', root), 'utf8'));
  assert.deepEqual(catalog.packs.map((p: any) => p.slug), slugs);
  const uniqueExpressions = new Set<string>(), uniqueVisuals = new Set<string>();
  for (const [index, entry] of catalog.packs.entries()) {
    const bytes = await readFile(new URL(`${entry.slug}.amoji`, root));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.archive_sha256);
    assert.equal(bytes.length, entry.bytes);
    await withValidatedPack(bytes, async pack => {
      const manifest = pack.manifest as ScenarioPack;
      assert.deepEqual(manifest, JSON.parse(await readFile(new URL(`${entry.slug}.manifest.json`, root), 'utf8')));
      assert.equal(manifest.pack_id, entry.pack_id); assert.equal(manifest.release_id, entry.release_id);
      assert.equal(manifest.rights.license, 'CC0-1.0'); assert.equal(manifest.rights.creator, 'Amoji');
      assert.equal(manifest.expressions.length, index < 2 ? 24 : 4);
      assert.equal(manifest.styles?.length, 1, '每个官方包有自己统一的画风');
      assert.match(manifest.name, / \/ /); assert.match(manifest.description!, / \/ /);
      for (const e of manifest.expressions) {
        assert.ok(!uniqueExpressions.has(e.asset_id), '不同包不重复收录同一个表情版本');
        uniqueExpressions.add(e.asset_id);
        uniqueVisuals.add(e.visual.primary.sha256);
        assert.ok(e.semantics.meaning && e.semantics.use_when?.length && e.semantics.avoid_when?.length);
        if (index >= 2) {
          const media = await pack.readBlob(e.visual.primary);
          const meta = await sharp(media).metadata(), stats = await sharp(media).stats();
          assert.equal(meta.hasAlpha, true); assert.equal(stats.channels[3]?.min, 0);
          assert.equal(meta.width, 512); assert.equal(meta.height, 512);
        }
      }
    }, 'market');
  }
  assert.equal(uniqueExpressions.size, 68); assert.equal(uniqueVisuals.size, 68);
});

test('经典和办公保留全部已确认语义、图片、身份、动画与原有可选提示', async () => {
  const base = JSON.parse(await readFile(new URL('../assets/base-library/manifest.json', import.meta.url), 'utf8'));
  const legacy = await Promise.all(['make-it-clear', 'work-well-together'].map(async s => JSON.parse(await readFile(new URL(`../assets/scenario-packs/${s}.manifest.json`, import.meta.url), 'utf8'))));
  for (const appearance of ['classic', 'office']) {
    await withValidatedPack(await readFile(new URL(`${appearance}.amoji`, root)), async p => {
      const m = p.manifest as ScenarioPack;
      assert.deepEqual(m.expressions, base.expressions.filter((e: any) => e.tags.includes(`amoji:appearance:${appearance}`)));
      assert.deepEqual(m.actions, legacy.flatMap(p => p.actions));
      const ids = new Set(m.expressions.map(e => e.asset_id));
      assert.deepEqual(m.bindings, legacy.flatMap(p => p.bindings.filter((b: any) => ids.has(b.expression.asset_id))));
    });
  }
});

test('七个官方包经真实库导入与导出，新增表情可发现且动作保持未启用', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'amoji-official-'));
  const store = await LibraryStore.open(directory, new URL('../assets/base-library/base.amoji', import.meta.url));
  t.after(async () => { store.close(); await rm(directory, {recursive: true, force: true}); });
  for (const slug of slugs) {
    const bytes = await readFile(new URL(`${slug}.amoji`, root));
    const result = await store.importPack(bytes);
    assert.ok(result.actions?.every(a => a.enabled === false));
    await withValidatedPack(bytes, async p => {
      const manifest = p.manifest as ScenarioPack;
      await withValidatedPack(await store.exportScenarioPack(manifest.release_id), async exported => assert.deepEqual(exported.manifest, manifest));
      for (const e of manifest.expressions) assert.deepEqual(store.resolve(e), e);
      if (!['classic', 'office'].includes(slug)) for (const e of manifest.expressions) assert.ok(store.list().some(item => item.asset_id === e.asset_id), '新风格不会被经典/办公偏好隐藏');
    });
  }
});

test('原创素材都有可追溯的生成提示和来源摘要', async () => {
  const provenance = JSON.parse(await readFile(new URL('provenance.json', root), 'utf8'));
  const generation = JSON.parse(await readFile(new URL('generation.json', root), 'utf8'));
  assert.equal(provenance.entries.length, 20); assert.equal(generation.prompts.length, 20);
  for (const entry of provenance.entries) {
    assert.match(entry.source_sha256, /^[a-f0-9]{64}$/);
    assert.ok(generation.prompts.some((p: any) => p.pack === entry.pack && p.expression === entry.expression && p.prompt.length > 100));
    await readFile(new URL(entry.file, root));
  }
});
