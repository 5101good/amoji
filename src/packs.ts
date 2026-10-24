import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Transform, type Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import yauzl from 'yauzl';
import { ZipFile } from 'yazl';
import { validatePack, PROTOCOL, type BlobRef, type Expression, type Pack, type Rights } from './protocol/index.js';
import { MEDIA_LIMITS, MARKET_MEDIA_LIMITS, validateExpressionMedia } from './media.js';
import { fail, ServiceError } from './shared-contract.js';

export const PACK_LIMITS = Object.freeze({ expressions: 200, entries: 1000, expanded: 250 * 1024 * 1024, manifest: 2 * 1024 * 1024, archive: 260 * 1024 * 1024 });
/** Market uploads use the RFC budgets: 10 MiB archive, 64 MiB expanded. */
export const MARKET_PACK_LIMITS = Object.freeze({ ...PACK_LIMITS, archive: 10 * 1024 * 1024, expanded: 64 * 1024 * 1024, manifest: 512 * 1024, entries: 512 });
export interface ImportResult { pack_id: string; release_id: string; added: number; existing: number; effects: number }
export type PackInput = Uint8Array | AsyncIterable<Uint8Array>;
export interface ValidatedPack { manifest: Pack; readBlob(blob: BlobRef): Promise<Buffer> }
// yazl encodes DOS calendar fields in local time. Omit the UTC extra field
// below so this fixed wall-clock date produces the same bytes in every zone.
const ZIP_TIME = new Date(2026, 0, 1);
function limit(condition: boolean, message: string): void { if (condition) fail('PACK_LIMIT_EXCEEDED', message); }

export { validatePack as validatePackManifest };

// The pinned yauzl 3.4 API provides async iteration; DefinitelyTyped still describes 2.x.
type IteratedZip = yauzl.ZipFile & { eachEntry(): AsyncIterable<yauzl.Entry>; openReadStreamPromise(entry: yauzl.Entry): Promise<Readable>; readLocalFileHeaderPromise(entry: yauzl.Entry): Promise<{ fileName: Buffer; generalPurposeBitFlag: number; compressionMethod: number }> };
async function openZip(path: string): Promise<IteratedZip> {
  return new Promise((resolve, reject) => yauzl.open(path, { lazyEntries: true, autoClose: true, strictFileNames: true, validateEntrySizes: true }, (error, zip) => error ? reject(error) : resolve(zip as IteratedZip)));
}

/** Bounded staging and real streaming accounting; no archive pathname is ever extracted. */
export async function withValidatedPack<T>(input: PackInput, consume: (pack: ValidatedPack) => Promise<T>, profile: 'local' | 'market' = 'local'): Promise<T> {
  const limits = profile === 'market' ? MARKET_PACK_LIMITS : PACK_LIMITS;
  const mediaLimits = profile === 'market' ? MARKET_MEDIA_LIMITS : MEDIA_LIMITS;
  const directory = await mkdtemp(join(tmpdir(), 'amoji-pack-'));
  let zip: IteratedZip | undefined;
  try {
    const archive = join(directory, 'input'); let received = 0;
    const source = input instanceof Uint8Array ? [input] : input;
    await pipeline(source, new Transform({ transform(chunk: Buffer, _, done) {
      received += chunk.length;
      if (received > limits.archive) done(new ServiceError('PACK_LIMIT_EXCEEDED', `压缩包超过 ${limits.archive / 1024 / 1024} MiB`));
      else done(null, chunk);
    } }), createWriteStream(archive, { flags: 'wx', mode: 0o600 }));
    zip = await openZip(archive);
    limit(zip.entryCount > limits.entries, `ZIP 条目超过 ${limits.entries}`);
    const paths = new Map<string, string>(); let expanded = 0; let count = 0;
    for await (const entry of zip.eachEntry()) {
      limit(++count > limits.entries, `ZIP 条目超过 ${limits.entries}`);
      const name = entry.fileName;
      if (!/^(manifest\.json|blobs\/(?:[0-9a-f]{64})?)$/.test(name) || paths.has(name)) fail('PACK_PATH_INVALID', '只接受唯一 manifest.json 和 blobs/<sha256> 文件');
      const local = await zip.readLocalFileHeaderPromise(entry);
      if (!local.fileName.equals(Buffer.from(name, 'ascii')) || local.generalPurposeBitFlag !== entry.generalPurposeBitFlag || local.compressionMethod !== entry.compressionMethod) fail('PACK_PATH_INVALID', 'ZIP 本地头与中央目录不一致');
      const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
      const directoryEntry = name === 'blobs/';
      if ((mode !== 0 && mode !== (directoryEntry ? 0x4000 : 0x8000)) || (!directoryEntry && (entry.externalFileAttributes & 0x10) !== 0) || entry.isEncrypted()) fail('PACK_PATH_INVALID', '不接受链接、非允许目录、特殊文件或加密条目');
      const maximum = directoryEntry ? 0 : name === 'manifest.json' ? limits.manifest : mediaLimits.bytes;
      limit(entry.uncompressedSize > maximum || expanded + entry.uncompressedSize > limits.expanded, '清单、素材或展开大小超限');
      const path = join(directory, `entry-${count}`); paths.set(name, path);
      let size = 0; let crc = 0;
      const stream = await zip.openReadStreamPromise(entry);
      await pipeline(stream, new Transform({ transform(chunk: Buffer, _, done) {
        size += chunk.length; expanded += chunk.length;
        if (size > maximum || expanded > limits.expanded) return done(new ServiceError('PACK_LIMIT_EXCEEDED', '实际展开字节超过预算'));
        crc = crc32(chunk, crc); done(null, chunk);
      } }), createWriteStream(path, { flags: 'wx', mode: 0o600 }));
      if (size !== entry.uncompressedSize || crc !== entry.crc32) fail('PACK_INTEGRITY_FAILED', 'ZIP 长度或 CRC-32 不匹配');
    }
    const manifestPath = paths.get('manifest.json'); if (!manifestPath) fail('PACK_REFERENCE_INVALID', '缺少 manifest.json');
    let value: unknown;
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readFile(manifestPath))); }
    catch { fail('INVALID_SCHEMA', '清单不是有效 UTF-8 JSON'); }
    if (value && typeof value === 'object' && (value as { amoji?: unknown }).amoji !== PROTOCOL) fail('UNSUPPORTED_SCHEMA', `只支持 Amoji ${PROTOCOL} 包`);
    const manifest = validatePack(value);
    const referenced = new Set(['manifest.json', ...(paths.has('blobs/') ? ['blobs/'] : [])]);
    const readBlob = async (blob: BlobRef): Promise<Buffer> => {
      const name = `blobs/${blob.sha256}`; referenced.add(name);
      const path = paths.get(name); if (!path) fail('BLOB_MISSING', '包缺少引用素材');
      return readFile(path);
    };
    for (const e of manifest.expressions) await validateExpressionMedia(e, readBlob, mediaLimits);
    if (referenced.size !== paths.size) fail('PACK_REFERENCE_INVALID', '包含未引用文件');
    return await consume({ manifest, readBlob });
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    return fail('PACK_INVALID', error instanceof Error ? error.message : '无法读取完整包');
  } finally { zip?.close(); await rm(directory, { recursive: true, force: true }); }
}

/** Finish a private temporary ZIP before exposing bytes. Entry order and timestamps are deterministic. */
export async function exportManifest(value: Pack, readBlob: (blob: BlobRef) => Promise<Buffer>): Promise<Buffer> {
  const manifest = validatePack(value);
  const raw = Buffer.from(JSON.stringify(manifest)); limit(raw.length > PACK_LIMITS.manifest, '清单超过 2 MiB');
  const directory = await mkdtemp(join(tmpdir(), 'amoji-export-'));
  try {
    const blobs = new Map<string, string>(); let expanded = raw.length;
    for (const e of manifest.expressions) await validateExpressionMedia(e, async blob => {
      const bytes = await readBlob(blob);
      if (!blobs.has(blob.sha256)) {
        expanded += bytes.length; limit(expanded > PACK_LIMITS.expanded, '导出展开大小超过 250 MiB');
        const path = join(directory, blob.sha256);
        await writeFile(path, bytes, { flag: 'wx', mode: 0o600 }); blobs.set(blob.sha256, path);
      }
      return bytes;
    });
    const zip = new ZipFile(); const path = join(directory, 'complete.amoji');
    const done = pipeline(zip.outputStream, createWriteStream(path, { flags: 'wx', mode: 0o600 }));
    zip.on('error', error => (zip.outputStream as Readable).destroy(error));
    const options = { mtime: ZIP_TIME, forceDosTimestamp: true, mode: 0o100644 };
    zip.addBuffer(raw, 'manifest.json', options);
    for (const digest of [...blobs.keys()].sort()) zip.addFile(blobs.get(digest)!, `blobs/${digest}`, options);
    zip.end(); await done;
    limit((await stat(path)).size > PACK_LIMITS.archive, '压缩包超过 260 MiB');
    return await readFile(path);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

/** Languages every selected expression covers completely, original first. */
export function sharedLocales(expressions: Expression[], preferred?: string): { original: string; locales: string[] } {
  const common = Object.keys(expressions[0]?.semantics ?? {}).filter(locale => expressions.every(e => locale in e.semantics && locale in e.name));
  if (!common.length) fail('PACK_LOCALE_MISMATCH', '所选表情没有共同的完整语言，无法组成一个包');
  const original = preferred && common.includes(preferred) ? preferred : common.includes(expressions[0]!.original_locale) ? expressions[0]!.original_locale : common[0]!;
  return { original, locales: [original, ...common.filter(locale => locale !== original)] };
}

/** A new personal pack from exact library revisions. Each asset may appear once. */
export function composePack(expressions: Expression[], options: { name: string; description?: string; locale?: string; rights?: Rights; pack_id?: string; version?: number }): Pack {
  if (!expressions.length || expressions.length > PACK_LIMITS.expressions) fail('INVALID_ARGUMENT', '导出需要 1–200 个确定版本');
  if (new Set(expressions.map(e => e.asset_id)).size !== expressions.length) fail('PACK_REFERENCE_INVALID', '同一表情在一个包中只能选择一个版本');
  const { original, locales } = sharedLocales(expressions, options.locale);
  const text = (value: string) => Object.fromEntries(locales.map(locale => [locale, value]));
  return validatePack({
    kind: 'amoji.pack', amoji: PROTOCOL, pack_id: options.pack_id ?? randomUUID(), release_id: randomUUID(), version: options.version ?? 1,
    original_locale: original, locales, name: text(options.name), description: text(options.description ?? options.name),
    expressions, rights: options.rights ?? { license: '仅供个人使用 / Personal use only' },
  });
}

export async function exportPack(expressions: Expression[], name: string, readBlob: (blob: BlobRef) => Promise<Buffer>, locale?: string): Promise<Buffer> {
  return exportManifest(composePack(expressions, { name, locale }), readBlob);
}
