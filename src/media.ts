import type { BlobRef, Expression } from './sample-catalog.js';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { fail } from './shared-contract.js';

export const MEDIA_LIMITS = Object.freeze({
  bytes: 10 * 1024 * 1024,
  edge: 2048,
  frames: 200,
  durationMs: 10_000,
  decodedPixels: 100_000_000,
});

export interface DecodedMedia {
  mime: string;
  width: number;
  height: number;
  animated: boolean;
  frames: number;
  durationMs: number;
  decodedPixels: number;
}

export interface ExpressionMedia {
  primary: DecodedMedia;
  poster?: DecodedMedia;
}

const staticMimes = new Set(['image/png', 'image/jpeg', 'image/webp']);
const animatedMimes = new Set(['image/gif', 'image/webp']);

function actualMime(format: string | undefined): string | undefined {
  if (format === 'jpg' || format === 'jpeg') return 'image/jpeg';
  if (format === 'png' || format === 'webp' || format === 'gif') return `image/${format}`;
}

function limit(condition: boolean, message: string): void {
  if (condition) fail('MEDIA_LIMIT_EXCEEDED', message);
}

function hasPngChunk(bytes: Buffer, wanted: string): boolean {
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return false;
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    if (length > bytes.length - offset - 12) return false;
    if (bytes.toString('ascii', offset + 4, offset + 8) === wanted) return true;
    offset += length + 12;
  }
  return false;
}

export async function validateMediaBlob(bytes: Buffer, declared: BlobRef, expected: 'static' | 'animated'): Promise<DecodedMedia> {
  limit(bytes.length > MEDIA_LIMITS.bytes || declared.bytes > MEDIA_LIMITS.bytes, '单个素材大小超限（最大 10 MiB）');
  if (bytes.length !== declared.bytes || createHash('sha256').update(bytes).digest('hex') !== declared.sha256) fail('BLOB_INTEGRITY_FAILED', '素材字节数或 SHA-256 摘要不匹配');
  if (!Number.isSafeInteger(declared.width) || !Number.isSafeInteger(declared.height) || declared.width < 1 || declared.height < 1) fail('MEDIA_UNSUPPORTED', '声明的素材尺寸不合法');
  limit(declared.width > MEDIA_LIMITS.edge || declared.height > MEDIA_LIMITS.edge, '素材边长尺寸超限（最大 2048）');
  const supported = expected === 'animated' ? animatedMimes : staticMimes;
  if (!supported.has(declared.mime)) fail('MEDIA_UNSUPPORTED', expected === 'animated' ? '动图只支持 GIF 或 animated WebP' : '静态图只支持 PNG、JPEG 或 WebP');
  if (declared.mime === 'image/png' && hasPngChunk(bytes, 'acTL')) fail('MEDIA_UNSUPPORTED', 'APNG 容器在 v0.1 不支持');

  let meta: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>;
  try {
    meta = await sharp(bytes, { animated: true, failOn: 'warning', limitInputPixels: MEDIA_LIMITS.decodedPixels, limitInputChannels: 4, sequentialRead: true }).metadata();
  } catch (error) {
    if (error instanceof Error && /pixel limit/i.test(error.message)) fail('MEDIA_LIMIT_EXCEEDED', '累计解码像素超过一亿');
    fail('MEDIA_UNSUPPORTED', '素材损坏或无法读取媒体结构');
  }
  const mime = actualMime(meta.format);
  if (!mime || mime !== declared.mime) fail('MEDIA_UNSUPPORTED', `声明与实际格式不匹配（声明 ${declared.mime}，实际 ${mime ?? '不支持'}）`);
  const width = meta.width;
  const height = meta.pageHeight ?? meta.height;
  const frames = meta.pages ?? 1;
  if (!width || !height || width !== declared.width || height !== declared.height) fail('MEDIA_UNSUPPORTED', '声明与实际解码尺寸不匹配');
  limit(width > MEDIA_LIMITS.edge || height > MEDIA_LIMITS.edge, '素材边长尺寸超限（最大 2048）');
  limit(frames > MEDIA_LIMITS.frames, '动图帧数超限（最多 200 帧）');
  const decodedPixels = width * height * frames;
  limit(decodedPixels > MEDIA_LIMITS.decodedPixels, '累计解码像素超过一亿');
  const animated = frames > 1;
  if ((expected === 'animated') !== animated) fail('MEDIA_UNSUPPORTED', expected === 'animated' ? '声明为动图但实际解码不是动画' : '静态素材实际解码为动画');
  const delays = meta.delay ?? [];
  const durationMs = animated ? delays.reduce((total, delay) => total + delay, 0) : 0;
  if (animated && delays.length !== frames) fail('MEDIA_UNSUPPORTED', '动图缺少完整的逐帧时长');
  limit(durationMs > MEDIA_LIMITS.durationMs, '动图时长超限（最长 10 秒）');

  try {
    const decoded = await sharp(bytes, { animated: true, failOn: 'warning', limitInputPixels: MEDIA_LIMITS.decodedPixels, limitInputChannels: 4, sequentialRead: true }).raw().toBuffer({ resolveWithObject: true });
    if (decoded.info.width !== width || decoded.info.height !== height * frames || decoded.data.length === 0) fail('MEDIA_UNSUPPORTED', '素材完整解码结果不一致');
  } catch (error) {
    if (error instanceof Error && /^MEDIA_/.test(error.message)) throw error;
    fail('MEDIA_UNSUPPORTED', '素材损坏，无法完整解码');
  }
  return { mime, width, height, animated, frames, durationMs, decodedPixels };
}

export async function validateExpressionMedia(expression: Expression, read: (blob: BlobRef) => Promise<Buffer>): Promise<ExpressionMedia> {
  const visual = expression.visual;
  if (!visual.animated && visual.duration_ms !== undefined) fail('MEDIA_UNSUPPORTED', '静态素材不得携带动画时长');
  if (!visual.animated && visual.poster !== undefined) fail('MEDIA_UNSUPPORTED', '静态素材不得携带额外封面');
  if (visual.animated && (!Number.isSafeInteger(visual.duration_ms) || !visual.poster)) fail('MEDIA_UNSUPPORTED', '动图必须携带时长和独立静态封面');
  if (visual.animated && visual.poster!.sha256 === visual.primary.sha256) fail('MEDIA_UNSUPPORTED', '动图封面必须是独立静态素材');
  const primary = await validateMediaBlob(await read(visual.primary), visual.primary, visual.animated ? 'animated' : 'static');
  if (!visual.animated) return { primary };
  if (primary.durationMs !== visual.duration_ms) fail('MEDIA_UNSUPPORTED', `声明与实际动图时长不匹配（声明 ${visual.duration_ms} ms，实际 ${primary.durationMs} ms）`);
  const poster = await validateMediaBlob(await read(visual.poster!), visual.poster!, 'static');
  return { primary, poster };
}
