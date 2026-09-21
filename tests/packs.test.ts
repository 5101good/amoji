import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ZipFile } from 'yazl';
import { SharedClient } from '../src/shared-client.js';
import { startSharedService } from '../src/shared-service.js';
import { ConnectedRuntime } from '../src/adapter-runtime.js';
import type { Expression } from '../src/sample-catalog.js';
const samples = new URL('../assets/samples/', import.meta.url);
const ref = (e: {asset_id: string; revision_id: string}) => ({ asset_id: e.asset_id, revision_id: e.revision_id });
async function sandbox(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'amoji-packs-'));
  const service = await startSharedService(directory, samples);
  const client = await SharedClient.connect({ directory });
  t.after(async () => { await client.close(); await service.close(); await rm(directory, { recursive: true, force: true }); });
  return { directory, client };
}
async function zip(entries: Array<[string, Buffer]>) {
  const zip = new ZipFile(); const parts: Buffer[] = [];
  const done = (async () => { for await (const part of zip.outputStream) parts.push(Buffer.from(part)); return Buffer.concat(parts); })();
  for (const [name, bytes] of entries) zip.addBuffer(bytes, name, { compress: false });
  zip.end(); return done;
}
async function fixture() {
  const manifest = JSON.parse(await readFile(new URL('manifest.json', samples), 'utf8'));
  const expressions: Expression[] = manifest.expressions.map((e: Expression) => ({ ...e, asset_id: randomUUID(), revision_id: randomUUID(), rights: { ...e.rights, creator: 'local' } }));
  const pack = { ...manifest, pack_id: randomUUID(), expressions, defaults: expressions.map(ref) };
  const blobs = new Map<string, Buffer>();
  for (const e of expressions) for (const blob of [e.visual.primary, e.visual.poster]) if (blob) blobs.set(`blobs/${blob.sha256}`, await readFile(new URL(`blobs/${blob.sha256}`, samples)));
  const encode = (manifest: unknown = pack, extra: Array<[string, Buffer]> = []) => zip([['manifest.json', Buffer.from(JSON.stringify(manifest))], ...blobs, ...extra]);
  return { pack, expressions, blobs, encode };
}

test('完整包公共导入无需草稿、幂等、静动图可发送及导出到新环境保持精确版本', async t => {
  const a = await sandbox(t); const b = await sandbox(t); const f = await fixture();
  assert.ok(a.client.identity.capabilities?.includes('packs-v1'));
  assert.ok(new ConnectedRuntime(a.client).packs);
  const first = await a.client.importPack(await f.encode());
  assert.equal(first.added, 3);
  assert.equal((await a.client.importPack(await f.encode())).added, 0);
  for (const e of f.expressions) { assert.deepEqual(await a.client.resolve(ref(e)), e); assert.equal((await a.client.getEntry(e.asset_id)).origin, 'imported'); }
  const binding = await a.client.bind({ host: 'dsh', sessionId: 'private-session', turnId: 'one' });
  for (const e of f.expressions) assert.deepEqual((await a.client.receive(binding, ref(e), randomUUID())).revision, e);
  const exported = await a.client.exportPack(f.expressions.map(ref), '我的包');
  assert.equal(exported.includes(Buffer.from('private-session')), false);
  await b.client.importPack(exported);
  for (const e of f.expressions) {
    assert.deepEqual(await b.client.resolve(ref(e)), e);
    assert.deepEqual(await readFile(await b.client.blobPath(e.visual.primary.sha256)), f.blobs.get(`blobs/${e.visual.primary.sha256}`));
  }
});

test('不可变冲突整包回滚；新revision不切默认；显式CAS保归档及个人副本', async t => {
  const { client } = await sandbox(t); const f = await fixture(); await client.importPack(await f.encode());
  const original = f.expressions[0]!; const before = await client.listEntries();
  const binding = await client.bind({ host: 'dsh', sessionId: 'old-version-history', turnId: 'one' });
  const historical = await client.receive(binding, ref(original), 'before-import');
  const bad = structuredClone(f.pack); bad.expressions[1]!.name = '覆写既有'; bad.expressions[0]!.asset_id = randomUUID(); bad.defaults = bad.expressions.map(ref);
  await assert.rejects(client.importPack(await f.encode(bad)), /REVISION_CONFLICT/); assert.deepEqual(await client.listEntries(), before);
  const draft = await client.startRevisionDraft(ref(original), 1); const copy = await client.confirmDraft(draft.draft_id, draft.version);
  const updated = { ...original, revision_id: randomUUID(), name: '上游新版' };
  await client.setArchived(original.asset_id, 1, true);
  await client.importPack(await f.encode({ ...f.pack, expressions: [updated, ...f.expressions.slice(1)], defaults: [updated, ...f.expressions.slice(1)].map(ref) }));
  assert.deepEqual((await client.getEntry(original.asset_id)).expression, original);
  await assert.rejects(client.selectRevision(ref(updated), 1), /ENTRY_CONFLICT/);
  const selected = await client.selectRevision(ref(updated), 2); assert.equal(selected.archived, true); assert.equal(selected.version, 3);
  assert.deepEqual(await client.history(binding), [historical]);
  assert.deepEqual((await client.getEntry(copy.asset_id)).expression, copy); assert.deepEqual(await client.resolve(ref(original)), original);
  await assert.rejects(client.selectRevision(ref(copy), 1), /LOCAL_REVISION_PROTECTED/);
});

test('非法ZIP、协议、路径、闭包、CRC及媒体失败不留下可用记录', async t => {
  const { client } = await sandbox(t); const before = await client.listEntries(); const f = await fixture();
  const valid = await f.encode();
  const cases: Array<[string, Buffer, RegExp]> = [
    ['truncated', valid.subarray(0, -12), /PACK_INVALID/],
    ['schema', await f.encode({ ...f.pack, schema_version: '2.0' }), /UNSUPPORTED_SCHEMA/],
    ['unknown', await f.encode({ ...f.pack, settings: {} }), /INVALID_SCHEMA/],
    ['defaults', await f.encode({ ...f.pack, defaults: [] }), /INVALID_SCHEMA|PACK_REFERENCE_INVALID/],
    ['duplicate revision', await f.encode({ ...f.pack, expressions: [...f.expressions, f.expressions[0]] }), /PACK_REFERENCE_INVALID/],
    ['extra', await f.encode(f.pack, [['extra.txt', Buffer.from('bad')]]), /PACK_PATH_INVALID/],
    ['duplicate', await f.encode(f.pack, [['manifest.json', Buffer.from('{}')]]), /PACK_PATH_INVALID/],
    ['unreferenced', await f.encode(f.pack, [[`blobs/${'0'.repeat(64)}`, Buffer.from('bad')]]), /PACK_REFERENCE_INVALID/],
    ['missing', await zip([['manifest.json', Buffer.from(JSON.stringify(f.pack))]]), /BLOB_MISSING/],
    ['hash', await zip([['manifest.json', Buffer.from(JSON.stringify(f.pack))], ...[...f.blobs].map(([name, data], i): [string, Buffer] => [name, i === 0 ? Buffer.from('wrong') : data])]), /BLOB_INTEGRITY_FAILED/],
    ['manifest-limit', await zip([['manifest.json', Buffer.alloc(2 * 1024 * 1024 + 1)]]), /PACK_LIMIT_EXCEEDED/],
    ['count-limit', await f.encode({ ...f.pack, expressions: Array.from({ length: 201 }, () => f.expressions[0]) }), /INVALID_SCHEMA/],
  ];
  const crc = Buffer.from(valid); crc[30 + 'manifest.json'.length] = crc[30 + 'manifest.json'.length]! ^ 1; cases.push(['CRC', crc, /PACK_INTEGRITY_FAILED/]);
  const path = Buffer.from(valid); let at = 0;
  while ((at = path.indexOf(Buffer.from('manifest.json'), at)) !== -1) { path.write('../escape.txt', at); at += 13; }
  cases.push(['path escape', path, /PACK_INVALID|PACK_PATH_INVALID/]);
  const link = Buffer.from(valid); const central = link.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); link.writeUInt32LE((0xa1ff * 65536) >>> 0, central + 38); cases.push(['symlink', link, /PACK_PATH_INVALID/]);
  const declared = structuredClone(f.pack); declared.expressions[0]!.visual.primary.width = 1; cases.push(['media dimensions', await f.encode(declared), /MEDIA_UNSUPPORTED/]);
  for (const [name, data, error] of cases) await t.test(name, async () => { await assert.rejects(client.importPack(data), error); assert.deepEqual(await client.listEntries(), before); });
  const nested = structuredClone(f.pack); nested.expressions[0]!.schema_version = '9.0' as '0.1';
  await assert.rejects(client.importPack(await f.encode(nested)), /UNSUPPORTED_SCHEMA/);
});

test('正式基础包通过公共校验，空环境48个画风版本且默认24项，外部导入不能声称builtin', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'amoji-builtin-'));
  const service = await startSharedService(directory, new URL('../assets/base-library/base.amoji', import.meta.url));
  const client = await SharedClient.connect({ directory });
  t.after(async () => { await client.close(); await service.close(); await rm(directory, { recursive: true, force: true }); });
  const entries = await client.listEntries(); assert.equal(entries.length, 48); assert.ok(entries.every(e => e.origin === 'builtin'));
  assert.equal(entries.filter(e => e.expression.visual.animated).length, 1);
  assert.equal((await client.list()).length, 24);
  assert.ok(entries.every(e => e.expression.rights.license === 'CC0-1.0'));
  const external = await sandbox(t); await external.client.importPack(await readFile(new URL('../assets/base-library/base.amoji', import.meta.url)));
  for (const e of entries) { assert.deepEqual(await external.client.resolve(ref(e.expression)), e.expression); assert.equal((await external.client.getEntry(e.expression.asset_id)).origin, 'imported'); }
});

test('ZIP条目、实际解压流与实际输入流均有固定上限并清理隔离临时文件', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'amoji-own-pack-tmp-')); const original = process.env.TMPDIR;
  process.env.TMPDIR = directory;
  t.after(async () => { if (original === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = original; await rm(directory, {recursive:true,force:true}); });
  const { withValidatedPack } = await import('../src/packs.js');
  const before = (await readdir(tmpdir())).filter(n => n.startsWith('amoji-pack-')).sort();
  await assert.rejects(withValidatedPack(await zip(Array.from({ length: 1001 }, (_, i) => [`blobs/${i.toString(16).padStart(64, '0')}`, Buffer.from('x')])), async () => {}), /PACK_LIMIT_EXCEEDED/);
  const bomb = new ZipFile(); const chunks: Buffer[] = [];
  const done = (async () => { for await (const chunk of bomb.outputStream) chunks.push(Buffer.from(chunk)); return Buffer.concat(chunks); })();
  bomb.addBuffer(Buffer.alloc(11 * 1024 * 1024), `blobs/${'0'.repeat(64)}`, { compress: true }); bomb.end();
  const bytes = await done; const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); bytes.writeUInt32LE(1, central + 24);
  await assert.rejects(withValidatedPack(bytes, async () => {}), /PACK_INVALID|PACK_LIMIT_EXCEEDED/);
  const expanded = new ZipFile(); const expandedChunks: Buffer[] = [];
  const expandedDone = (async () => { for await (const chunk of expanded.outputStream) expandedChunks.push(Buffer.from(chunk)); return Buffer.concat(expandedChunks); })();
  const tenMiB = Buffer.alloc(10 * 1024 * 1024);
  for (let i = 0; i < 26; i++) expanded.addBuffer(tenMiB, `blobs/${i.toString(16).padStart(64, '0')}`, { compress: true });
  expanded.end();
  await assert.rejects(withValidatedPack(await expandedDone, async () => {}), /PACK_LIMIT_EXCEEDED/);
  let consumed = 0;
  async function* oversized() { const chunk = Buffer.alloc(1024 * 1024); for (let i = 0; i < 300; i++) { consumed++; yield chunk; } }
  await assert.rejects(withValidatedPack(oversized(), async () => {}), /PACK_LIMIT_EXCEEDED/); assert.ok(consumed <= 262);
  assert.deepEqual((await readdir(tmpdir())).filter(n => n.startsWith('amoji-pack-')).sort(), before);
});

test('提交包记录失败回滚所有revision与默认；并发冲突再次检查且只保留一组内容', async t => {
  const { directory, client } = await sandbox(t); const f = await fixture(); const before = await client.listEntries();
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(join(directory, 'library.sqlite'));
  try {
    db.exec("CREATE TRIGGER reject_pack BEFORE INSERT ON imported_packs BEGIN SELECT RAISE(ABORT, 'test commit failure'); END;");
    await assert.rejects(client.importPack(await f.encode()), /PACK_INVALID/);
    assert.deepEqual(await client.listEntries(), before);
    for (const e of f.expressions) await assert.rejects(client.resolve(ref(e)), /REVISION_NOT_FOUND/);
    db.exec('DROP TRIGGER reject_pack');
  } finally { db.close(); }
  const conflict = structuredClone(f.pack); conflict.expressions[0]!.name = '另一个不可变定义';
  const results = await Promise.allSettled([client.importPack(await f.encode()), client.importPack(await f.encode(conflict))]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(results.filter(r => r.status === 'rejected').length, 1);
  const actual = await client.resolve(ref(f.expressions[0]!)); assert.ok([f.expressions[0]!.name, conflict.expressions[0]!.name].includes(actual.name));
});

test('导出显式旧版本与当前版本去重素材、默认指向所选当前版本且不清理历史', async t => {
  const a = await sandbox(t); const b = await sandbox(t); const f = await fixture(); await a.client.importPack(await f.encode());
  const old = f.expressions[0]!; const newer = { ...old, revision_id: randomUUID(), name: '新版' };
  await a.client.importPack(await f.encode({ ...f.pack, expressions: [...f.expressions, newer], defaults: [newer, ...f.expressions.slice(1)].map(ref) }));
  await a.client.selectRevision(ref(newer), 1);
  const data = await a.client.exportPack([ref(old), ref(newer)], '版本迁移');
  const { withValidatedPack } = await import('../src/packs.js');
  await withValidatedPack(data, async ({ manifest }) => {
    assert.deepEqual(manifest.expressions, [old, newer]); assert.deepEqual(manifest.defaults, [ref(newer)]);
    assert.deepEqual(Object.keys(manifest).sort(), ['created_at', 'defaults', 'expressions', 'kind', 'name', 'pack_id', 'schema_version']);
  });
  const yauzl = (await import('yauzl')).default;
  const count = await new Promise<number>((resolve, reject) => yauzl.fromBuffer(data, { lazyEntries: true }, (e, zip) => e ? reject(e) : resolve(zip.entryCount)));
  assert.equal(count, 2, '一个manifest与一份相同摘要的素材');
  await b.client.importPack(data); assert.deepEqual((await b.client.getEntry(old.asset_id)).expression, newer);
  assert.deepEqual(await a.client.resolve(ref(old)), old); assert.ok(await readFile(await a.client.blobPath(old.visual.primary.sha256)));
  await rm(await a.client.blobPath(old.visual.primary.sha256));
  await assert.rejects(a.client.exportPack([ref(newer)], '坏包'), /BLOB_MISSING/);
});

test('普通ZIP可包含唯一空blobs目录，目录不算未引用素材', async t => {
  const { client } = await sandbox(t); const f = await fixture();
  const archive = new ZipFile(); const chunks: Buffer[] = [];
  const done = (async () => { for await (const chunk of archive.outputStream) chunks.push(Buffer.from(chunk)); return Buffer.concat(chunks); })();
  archive.addEmptyDirectory('blobs/');
  archive.addBuffer(Buffer.from(JSON.stringify(f.pack)), 'manifest.json');
  for (const [name, bytes] of f.blobs) archive.addBuffer(bytes, name);
  archive.end(); assert.equal((await client.importPack(await done)).added, 3);
});

test('导入已提交但响应正文损坏时明确待核对，重试原包幂等', async t => {
  const { client } = await sandbox(t); const f = await fixture(); const data = await f.encode();
  const nativeFetch = globalThis.fetch; let lost = true;
  globalThis.fetch = async (input, options) => {
    const response = await nativeFetch(input, options);
    if (lost && String(input).endsWith('/packs/import')) { lost = false; await response.arrayBuffer(); return new Response('{truncated', { status: 200 }); }
    return response;
  };
  t.after(() => { globalThis.fetch = nativeFetch; });
  await assert.rejects(client.importPack(data), /PACK_OUTCOME_UNKNOWN/);
  assert.equal((await client.importPack(data)).added, 0);
  assert.deepEqual(await client.resolve(ref(f.expressions[0]!)), f.expressions[0]);
});


test('拒绝中央目录与本地头路径不一致，不让本地头藏路径越界', async t => {
  const { client } = await sandbox(t); const f = await fixture(); const data = await f.encode();
  data.write('../escape.txt', 30);
  await assert.rejects(client.importPack(data), /PACK_PATH_INVALID/);
});
