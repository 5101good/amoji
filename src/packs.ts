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
import { Ajv2020 } from 'ajv/dist/2020.js';
import { fullFormats } from 'ajv-formats/dist/formats.js';
import schema from '../docs/specs/amoji-v0.1.schema.json' with { type: 'json' };
import type { Expression, ExpressionRef, BlobRef } from './sample-catalog.js';
import { validateExpressionDefinition } from './drafts.js';
import { MEDIA_LIMITS, validateExpressionMedia } from './media.js';
import { fail, ServiceError } from './shared-contract.js';

export const PACK_LIMITS = Object.freeze({ expressions: 200, entries: 1000, expanded: 250 * 1024 * 1024, manifest: 2 * 1024 * 1024, archive: 260 * 1024 * 1024 });
export interface Pack { kind: 'amoji.pack'; schema_version: '0.1'; pack_id: string; name: string; created_at: string; expressions: Expression[]; defaults: ExpressionRef[] }
export interface ImportResult { pack_id: string; added: number; existing: number; defaults: ExpressionRef[] }
export type PackInput = Uint8Array | AsyncIterable<Uint8Array>;
export interface ValidatedPack { manifest: Pack; readBlob(blob: BlobRef): Promise<Buffer> }
const ajv = new Ajv2020({ strict: false, formats: fullFormats });
const validate = ajv.compile({ $defs: schema.$defs, $ref: '#/$defs/pack' });
const key = (ref: ExpressionRef) => `${ref.asset_id}:${ref.revision_id}`;
function limit(condition: boolean, message: string): void { if (condition) fail('PACK_LIMIT_EXCEEDED', message); }

export function validatePackManifest(value: unknown): Pack {
  if (value && typeof value === 'object' && 'schema_version' in value && value.schema_version !== '0.1') fail('UNSUPPORTED_SCHEMA', '不支持此包协议版本');
  if (value && typeof value === 'object' && 'expressions' in value && Array.isArray(value.expressions)) {
    for (const entry of value.expressions) if (entry && typeof entry === 'object' && 'schema_version' in entry && entry.schema_version !== '0.1') fail('UNSUPPORTED_SCHEMA', '不支持包中资产协议版本');
  }
  if (!validate(value)) fail('INVALID_SCHEMA', ajv.errorsText(validate.errors));
  const pack = value as Pack;
  const refs = new Set<string>(); const assets = new Set<string>(); const defaults = new Set<string>();
  for (const e of pack.expressions) {
    validateExpressionDefinition(e);
    if (refs.has(key(e))) fail('PACK_REFERENCE_INVALID', '包内版本引用重复');
    refs.add(key(e)); assets.add(e.asset_id);
  }
  for (const ref of pack.defaults) {
    if (defaults.has(ref.asset_id) || !refs.has(key(ref))) fail('PACK_REFERENCE_INVALID', '默认引用重复或不在包内');
    defaults.add(ref.asset_id);
  }
  if (defaults.size !== assets.size) fail('PACK_REFERENCE_INVALID', '每个表情必须有且仅有一个默认引用');
  return pack;
}

// The pinned yauzl 3.4 API provides async iteration; DefinitelyTyped still describes 2.x.
type IteratedZip = yauzl.ZipFile & { eachEntry(): AsyncIterable<yauzl.Entry>; openReadStreamPromise(entry: yauzl.Entry): Promise<Readable>; readLocalFileHeaderPromise(entry: yauzl.Entry): Promise<{ fileName: Buffer; generalPurposeBitFlag: number; compressionMethod: number }> };
async function openZip(path: string): Promise<IteratedZip> {
  return new Promise((resolve, reject) => yauzl.open(path, { lazyEntries: true, autoClose: true, strictFileNames: true, validateEntrySizes: true }, (error, zip) => error ? reject(error) : resolve(zip as IteratedZip)));
}
/** Bounded staging and real streaming accounting; no archive pathname is ever extracted. */
export async function withValidatedPack<T>(input: PackInput, consume: (pack: ValidatedPack) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), 'amoji-pack-'));
  let zip: IteratedZip | undefined;
  try {
    const archive = join(directory, 'input'); let received = 0;
    const source = input instanceof Uint8Array ? [input] : input;
    await pipeline(source, new Transform({ transform(chunk: Buffer, _, done) {
      received += chunk.length;
      if (received > PACK_LIMITS.archive) done(new ServiceError('PACK_LIMIT_EXCEEDED', '压缩包最多 260 MiB'));
      else done(null, chunk);
    } }), createWriteStream(archive, { flags: 'wx', mode: 0o600 }));
    zip = await openZip(archive);
    limit(zip.entryCount > PACK_LIMITS.entries, 'ZIP 条目超过 1000');
    const paths = new Map<string, string>(); let expanded = 0; let count = 0;
    for await (const entry of zip.eachEntry()) {
      limit(++count > PACK_LIMITS.entries, 'ZIP 条目超过 1000');
      const name = entry.fileName;
      if (!/^(manifest\.json|blobs\/(?:[0-9a-f]{64})?)$/.test(name) || paths.has(name)) fail('PACK_PATH_INVALID', '只接受唯一 manifest.json 和 blobs/<sha256> 文件');
      const local = await zip.readLocalFileHeaderPromise(entry);
      if (!local.fileName.equals(Buffer.from(name, 'ascii')) || local.generalPurposeBitFlag !== entry.generalPurposeBitFlag || local.compressionMethod !== entry.compressionMethod) fail('PACK_PATH_INVALID', 'ZIP 本地头与中央目录不一致');
      const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
      const directoryEntry = name === 'blobs/';
      if ((mode !== 0 && mode !== (directoryEntry ? 0x4000 : 0x8000)) || (!directoryEntry && (entry.externalFileAttributes & 0x10) !== 0) || entry.isEncrypted()) fail('PACK_PATH_INVALID', '不接受链接、非允许目录、特殊文件或加密条目');
      const maximum = directoryEntry ? 0 : name === 'manifest.json' ? PACK_LIMITS.manifest : MEDIA_LIMITS.bytes;
      limit(entry.uncompressedSize > maximum || expanded + entry.uncompressedSize > PACK_LIMITS.expanded, '清单、素材或展开大小超限');
      const path = join(directory, `entry-${count}`); paths.set(name, path);
      let size = 0; let crc = 0;
      const stream = await zip.openReadStreamPromise(entry);
      await pipeline(stream, new Transform({ transform(chunk: Buffer, _, done) {
        size += chunk.length; expanded += chunk.length;
        if (size > maximum || expanded > PACK_LIMITS.expanded) return done(new ServiceError('PACK_LIMIT_EXCEEDED', '实际展开字节超过预算'));
        crc = crc32(chunk, crc); done(null, chunk);
      } }), createWriteStream(path, { flags: 'wx', mode: 0o600 }));
      if (size !== entry.uncompressedSize || crc !== entry.crc32) fail('PACK_INTEGRITY_FAILED', 'ZIP 长度或 CRC-32 不匹配');
    }
    const manifestPath = paths.get('manifest.json'); if (!manifestPath) fail('PACK_REFERENCE_INVALID', '缺少 manifest.json');
    let value: unknown;
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readFile(manifestPath))); }
    catch { fail('INVALID_SCHEMA', '清单不是有效 UTF-8 JSON'); }
    const manifest = validatePackManifest(value);
    const referenced = new Set(['manifest.json', ...(paths.has('blobs/') ? ['blobs/'] : [])]);
    const readBlob = async (blob: BlobRef): Promise<Buffer> => {
      const name = `blobs/${blob.sha256}`; referenced.add(name);
      const path = paths.get(name); if (!path) fail('BLOB_MISSING', '包缺少引用素材');
      return readFile(path);
    };
    for (const e of manifest.expressions) await validateExpressionMedia(e, readBlob);
    if (referenced.size !== paths.size) fail('PACK_REFERENCE_INVALID', '包含未引用文件');
    return await consume({ manifest, readBlob });
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    return fail('PACK_INVALID', error instanceof Error ? error.message : '无法读取完整包');
  } finally { zip?.close(); await rm(directory, { recursive: true, force: true }); }
}

/** Finish a private temporary ZIP before exposing bytes; validate all selected immutable media. */
export async function exportPack(expressions: Expression[], defaults: ExpressionRef[], name: string, readBlob: (blob: BlobRef) => Promise<Buffer>): Promise<Buffer> {
  const manifest = validatePackManifest({ kind: 'amoji.pack', schema_version: '0.1', pack_id: randomUUID(), name, created_at: new Date().toISOString(), expressions, defaults });
  const raw = Buffer.from(JSON.stringify(manifest)); limit(raw.length > PACK_LIMITS.manifest, '清单超过 2 MiB');
  const directory = await mkdtemp(join(tmpdir(), 'amoji-export-'));
  try {
    const blobs = new Map<string, string>(); let expanded = raw.length;
    for (const e of expressions) await validateExpressionMedia(e, async blob => {
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
    zip.addBuffer(raw, 'manifest.json');
    for (const [digest, path] of blobs) zip.addFile(path, `blobs/${digest}`);
    zip.end(); await done;
    limit((await stat(path)).size > PACK_LIMITS.archive, '压缩包超过 260 MiB');
    return await readFile(path);
  } finally { await rm(directory, { recursive: true, force: true }); }
}
