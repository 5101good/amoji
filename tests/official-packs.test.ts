import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { withValidatedPack } from '../src/packs.js';
import { actAllows, findAct, type Pack } from '../src/protocol/index.js';
import { OFFICIAL, openStore } from './helpers/store-runtime.js';

const slugs = ['classic', 'office', 'slow-cat', 'good-dog', 'pixel-pal', 'orbit-jelly', 'paper-goose'];
const read = (name: string) => readFile(new URL(name, OFFICIAL));

test('the official catalog matches its archives, and every pack is a complete bilingual 0.1 pack', async () => {
  const catalog = JSON.parse((await read('catalog.json')).toString());
  assert.deepEqual(catalog.packs.map((p: { slug: string }) => p.slug), slugs);
  const assets = new Set<string>(), visuals = new Set<string>();
  for (const [index, entry] of catalog.packs.entries()) {
    const bytes = await read(`${entry.slug}.amoji`);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.archive_sha256, entry.slug);
    assert.equal(bytes.length, entry.bytes);
    await withValidatedPack(bytes, async pack => {
      const m = pack.manifest;
      assert.deepEqual(m, JSON.parse((await read(`${entry.slug}.manifest.json`)).toString()), 'the published manifest is the archive manifest');
      assert.deepEqual([m.pack_id, m.release_id, m.version], [entry.pack_id, entry.release_id, entry.version]);
      assert.deepEqual(m.name, entry.name);
      assert.deepEqual([m.original_locale, m.locales], ['zh-CN', ['zh-CN', 'en']]);
      assert.deepEqual([m.rights.license, m.rights.creator], ['CC0-1.0', 'Amoji contributors']);
      assert.equal(m.expressions.length, index < 2 ? 24 : 4);
      assert.equal(m.effects?.length ?? 0, entry.effects);
      for (const e of m.expressions) {
        assert.ok(!assets.has(e.asset_id), 'no expression appears in two official packs');
        assets.add(e.asset_id); visuals.add(e.visual.primary.sha256);
        const act = findAct(e.realizes);
        assert.ok(act && act.status !== 'deprecated', `${entry.slug}: ${e.realizes}`);
        for (const direction of e.directions ?? []) assert.ok(actAllows(e.realizes, direction));
        assert.ok(e.semantics['zh-CN']!.use_when?.length && e.semantics['zh-CN']!.avoid_when?.length);
        assert.deepEqual(e.semantics.en!.translation?.from, 'zh-CN', 'English is a declared translation of the Chinese original');
        if (index >= 2) {
          const media = await pack.readBlob(e.visual.primary);
          const meta = await sharp(media).metadata(), stats = await sharp(media).stats();
          assert.deepEqual([meta.width, meta.height, meta.hasAlpha], [512, 512, true]);
          assert.equal(stats.channels[3]?.min, 0, 'character art has a transparent background');
        }
      }
    }, 'market');
  }
  assert.equal(assets.size, 68); assert.equal(visuals.size, 68);
});

test('Classic and Office realize the same acts, and their optional effects bind inside each pack', async () => {
  const packs: Pack[] = [];
  for (const slug of ['classic', 'office']) await withValidatedPack(await read(`${slug}.amoji`), async p => { packs.push(p.manifest); });
  const [classic, office] = packs as [Pack, Pack];
  const acts = (p: Pack) => p.expressions.map(e => e.realizes).sort();
  assert.deepEqual(acts(classic), acts(office), 'two appearances of one vocabulary');
  for (const pack of packs) {
    const effects = new Set(pack.effects!.map(e => e.effect_id));
    for (const binding of pack.bindings ?? []) for (const id of binding.effects) assert.ok(effects.has(id));
  }
});

test('all official packs import into a real library, export unchanged and stay discoverable', async () => {
  const { store, close } = await openStore([]);
  try {
    for (const slug of slugs) {
      const bytes = await read(`${slug}.amoji`);
      const result = await store.importPack(bytes);
      const manifest = store.getPack(result.release_id);
      assert.equal(createHash('sha256').update(await store.exportRelease(manifest.release_id)).digest('hex'), createHash('sha256').update(bytes).digest('hex'));
      for (const e of manifest.expressions) {
        assert.deepEqual(store.resolve(e), e);
        assert.ok(store.list().some(item => item.asset_id === e.asset_id));
      }
    }
    assert.equal(store.rules({ host: 'dsh', hostInstanceId: 'p', sessionId: 's' }).rules.length, 0, 'installing never enables an effect');
  } finally { await close(); }
});

test('every official image has traceable generation prompts and source digests', async () => {
  for (const [provenanceFile, generationFile, count] of [['provenance.json', 'generation.json', 20], ['provenance.classic-office.json', 'generation.classic-office.json', 48]] as const) {
    const provenance = JSON.parse((await read(provenanceFile)).toString());
    const generation = JSON.parse((await read(generationFile)).toString());
    assert.equal(provenance.license, 'CC0-1.0');
    assert.equal(provenance.entries.length, count, provenanceFile);
    assert.ok(Array.isArray(generation.prompts) && generation.prompts.length > 0, generationFile);
  }
  const characters = JSON.parse((await read('provenance.json')).toString());
  const prompts = JSON.parse((await read('generation.json')).toString()).prompts;
  for (const entry of characters.entries) {
    assert.match(entry.source_sha256, /^[a-f0-9]{64}$/);
    assert.ok(prompts.some((p: { pack: string; expression: string; prompt: string }) => p.pack === entry.pack && p.expression === entry.expression && p.prompt.length > 100));
    await read(entry.file);
  }
});
