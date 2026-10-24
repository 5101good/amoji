import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ZipFile } from 'yazl';
import { withValidatedPack } from '../src/packs.js';
import type { Pack } from '../src/protocol/index.js';
import { OFFICIAL, openStore } from './helpers/store-runtime.js';

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const run = promisify(execFile);
async function zip(entries: Array<[string, Buffer]>): Promise<Buffer> {
  const archive = new ZipFile(); const parts: Buffer[] = [];
  const done = (async () => { for await (const part of archive.outputStream) parts.push(Buffer.from(part)); return Buffer.concat(parts); })();
  for (const [name, bytes] of entries) archive.addBuffer(bytes, name, { compress: false });
  archive.end(); return done;
}
/** The official Pixel Pal pack, unpacked so tests can rebuild valid and invalid variants. */
async function pixelPal() {
  const bytes = await readFile(new URL('pixel-pal.amoji', OFFICIAL));
  const { manifest, blobs } = await withValidatedPack(bytes, async pack => {
    const blobs = new Map<string, Buffer>();
    for (const e of pack.manifest.expressions) for (const blob of [e.visual.primary, e.visual.poster]) if (blob) blobs.set(blob.sha256, await pack.readBlob(blob));
    return { manifest: pack.manifest, blobs };
  });
  const encode = (value: unknown = manifest, extra: Array<[string, Buffer]> = [], omit?: string) =>
    zip([['manifest.json', Buffer.from(JSON.stringify(value))], ...[...blobs].filter(([sha]) => sha !== omit).map(([sha, b]) => [`blobs/${sha}`, b] as [string, Buffer]), ...extra]);
  return { bytes, manifest, blobs, encode };
}
const fresh = (m: Pack): Pack => ({ ...structuredClone(m), pack_id: randomUUID(), release_id: randomUUID(), expressions: m.expressions.map(e => ({ ...structuredClone(e), asset_id: randomUUID(), revision_id: randomUUID() })) });

test('an official pack imports idempotently and exports to the same deterministic bytes', async () => {
  const { store, close } = await openStore([]);
  try {
    const f = await pixelPal();
    const first = await store.importPack(f.bytes);
    assert.deepEqual([first.added, first.existing, first.effects], [4, 0, 0]);
    const again = await store.importPack(f.bytes);
    assert.deepEqual([again.added, again.existing], [0, 4], 'a second import adds nothing');
    assert.equal(store.listEntries().filter(e => e.pack_id === f.manifest.pack_id).length, 4);
    assert.equal(digest(await store.exportRelease(f.manifest.release_id)), digest(f.bytes), 'export reproduces the archive byte for byte');
  } finally { await close(); }
});

test('pack exports are byte-identical across process time zones', async () => {
  const script = `
    import { readFile } from 'node:fs/promises';
    import { createHash } from 'node:crypto';
    import { exportManifest, withValidatedPack } from ${JSON.stringify(new URL('../src/packs.ts', import.meta.url).href)};
    const bytes = await readFile(new URL(${JSON.stringify(new URL('pixel-pal.amoji', OFFICIAL).href)}));
    const exported = await withValidatedPack(bytes, pack => exportManifest(pack.manifest, pack.readBlob));
    process.stdout.write(createHash('sha256').update(exported).digest('hex'));
  `;
  const zones = ['UTC', 'Asia/Shanghai', 'America/Los_Angeles', 'Asia/Kathmandu'];
  const hashes = await Promise.all(zones.map(async TZ => {
    const { stdout } = await run(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', script], {
      cwd: new URL('..', import.meta.url), env: { ...process.env, TZ },
    });
    return stdout;
  }));
  for (const [index, hash] of hashes.entries()) assert.equal(hash, hashes[0], `archive bytes differ in ${zones[index]}`);
});

test('invalid packs are rejected whole and leave nothing behind', async () => {
  const { store, close } = await openStore([]);
  try {
    const f = await pixelPal();
    const otherSha = [...f.blobs.keys()][0]!;
    const cases: Array<[string, () => Promise<Buffer>, RegExp]> = [
      ['registry-only field on an expression', () => f.encode({ ...fresh(f.manifest), expressions: fresh(f.manifest).expressions.map((e, i) => i ? e : { ...e, expects: 'confirm' }) }), /只能由码位注册表定义/],
      ['unknown act', () => { const m = fresh(f.manifest); m.expressions[0]!.realizes = 'core:approve'; return f.encode(m); }, /码位不在注册表/],
      ['a pack locale missing from an expression', () => { const m = fresh(f.manifest); delete (m.expressions[0]!.semantics as Record<string, unknown>).en; return f.encode(m); }, /缺少语言 en/],
      ['a translation without provenance', () => { const m = fresh(f.manifest); delete m.expressions[0]!.semantics.en!.translation; return f.encode(m); }, /translation/],
      ['a binding to an expression outside the pack', () => { const effect_id = randomUUID(); return f.encode({ ...fresh(f.manifest), effects: [{ effect_id, effect_revision_id: randomUUID(), kind: 'template', template: 'completion-self-check@1', config: { evidence: 'required', unknowns: 'explicit' }, title: { 'zh-CN': '自检', en: 'Self-check' }, summary: { 'zh-CN': '自检', en: 'Self-check' } }], bindings: [{ target: { asset_id: randomUUID(), revision_id: randomUUID() }, effects: [effect_id] }] }); }, /绑定的表情不在本包内/],
      ['a missing blob', () => f.encode(fresh(f.manifest), [], otherSha), /./],
      ['an unreferenced blob', () => f.encode(fresh(f.manifest), [[`blobs/${'0'.repeat(64)}`, Buffer.from('x')]]), /./],
      ['a path outside blobs/', () => f.encode(fresh(f.manifest), [['notes/readme.txt', Buffer.from('x')]]), /./],
      ['a blob whose bytes do not match its digest', async () => zip([['manifest.json', Buffer.from(JSON.stringify(fresh(f.manifest)))], ...[...f.blobs].map(([sha, b], i) => [`blobs/${sha}`, i ? b : Buffer.concat([b, Buffer.from([0])])] as [string, Buffer])]), /./],
    ];
    for (const [name, build, message] of cases) {
      await assert.rejects(store.importPack(await build()), (error: Error) => message.test(error.message), name);
    }
    assert.equal(store.listPacks().length, 0);
    assert.equal(store.listEntries().length, 0);
  } finally { await close(); }
});

test('a revision cannot change under the same identity, and the conflicting pack is rolled back', async () => {
  const { store, close } = await openStore([]);
  try {
    const f = await pixelPal();
    await store.importPack(f.bytes);
    const changed = structuredClone(f.manifest);
    changed.release_id = randomUUID(); changed.version = 2;
    changed.expressions[1]!.semantics['zh-CN']!.meaning = '同一身份下的不同含义';
    await assert.rejects(store.importPack(await f.encode(changed)), /REVISION_CONFLICT|不能改变/);
    assert.equal(store.listPacks().length, 1);
    assert.equal(store.resolve(f.manifest.expressions[1]!).semantics['zh-CN']!.meaning, f.manifest.expressions[1]!.semantics['zh-CN']!.meaning);
  } finally { await close(); }
});

test('exports compose exact revisions across packs and can drop effects', async () => {
  const { store, close } = await openStore();
  try {
    const classic = store.listPacks().find(p => p.name.en === 'Classic')!;
    assert.ok(classic.effects?.length, 'the built-in Classic pack carries optional effects');
    const plain = await store.exportRelease(classic.release_id, true);
    await withValidatedPack(plain, async pack => {
      assert.equal(pack.manifest.effects, undefined);
      assert.equal(pack.manifest.bindings, undefined);
      assert.notEqual(pack.manifest.pack_id, classic.pack_id, 'a reduced export is a new pack, not the same release');
      assert.deepEqual(pack.manifest.expressions, classic.expressions);
    });
    const office = store.listPacks().find(p => p.name.en === 'Office')!;
    const refs = [classic.expressions[0]!, office.expressions[1]!].map(e => ({ asset_id: e.asset_id, revision_id: e.revision_id }));
    const mixed = await store.exportPack(refs, '我的组合', 'en');
    await withValidatedPack(mixed, async pack => {
      assert.deepEqual(pack.manifest.locales, ['en', 'zh-CN'], 'the preferred shared language comes first');
      assert.equal(pack.manifest.original_locale, 'en');
      assert.deepEqual(pack.manifest.expressions.map(e => e.revision_id), refs.map(r => r.revision_id));
    });
    const other = await openStore([]);
    try {
      const imported = await other.store.importPack(mixed);
      assert.equal(imported.added, 2);
      assert.deepEqual(other.store.resolve(refs[0]!), classic.expressions[0]);
    } finally { await other.close(); }
  } finally { await close(); }
});
