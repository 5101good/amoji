import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { validateExpressionMedia, validateMediaBlob } from '../src/media.js';
import { withValidatedPack } from '../src/packs.js';
import type { BlobRef, Expression } from '../src/protocol/index.js';
import { OFFICIAL } from './helpers/store-runtime.js';

const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const declaration = (bytes: Buffer, mime: string, width: number, height: number): BlobRef => ({ sha256: digest(bytes), mime, bytes: bytes.length, width, height });

function gif(width: number, height: number, frames: number, delayCentiseconds: number): Buffer {
  const u16 = (value: number) => Buffer.from([value & 255, value >> 8]);
  const header = Buffer.concat([Buffer.from('GIF89a'), u16(width), u16(height), Buffer.from([0x80, 0, 0, 0, 0, 0, 255, 255, 255])]);
  const frame = Buffer.concat([
    Buffer.from([0x21, 0xf9, 0x04, 0x00]), u16(delayCentiseconds), Buffer.from([0, 0]),
    Buffer.from([0x2c, 0, 0, 0, 0]), u16(1), u16(1), Buffer.from([0, 2, 2, 0x44, 0x01, 0]),
  ]);
  return Buffer.concat([header, ...Array.from({ length: frames }, () => frame), Buffer.from([0x3b])]);
}

const source = () => sharp({ create: { width: 1254, height: 1254, channels: 4, background: '#4080ff' } }).png().toBuffer();
test('公共媒体接缝完整解码真实 PNG 与 animated WebP，并核对固定动画数据', async () => {
  await withValidatedPack(await readFile(new URL('classic.amoji', OFFICIAL)), async pack => {
    for (const expression of pack.manifest.expressions) {
      const result = await validateExpressionMedia(expression, blob => pack.readBlob(blob));
      assert.deepEqual([result.primary.mime, result.primary.width, result.primary.height, result.primary.animated], [expression.visual.primary.mime, expression.visual.primary.width, expression.visual.primary.height, expression.visual.animated]);
      if (expression.visual.animated) {
        assert.ok(result.primary.frames > 1);
        assert.equal(result.primary.durationMs, expression.visual.duration_ms);
        assert.equal(result.poster?.animated, false);
        assert.notEqual(expression.visual.primary.sha256, expression.visual.poster?.sha256);
      }
    }
  });
  const png = await source();
  for (const [mime, bytes] of [
    ['image/jpeg', await sharp(png).jpeg().toBuffer()],
    ['image/webp', await sharp(png).webp().toBuffer()],
  ] as const) {
    const decoded = await validateMediaBlob(bytes, declaration(bytes, mime, 1254, 1254), 'static');
    assert.equal(decoded.mime, mime);
    assert.equal(decoded.animated, false);
  }
  const animatedGif = gif(2, 2, 2, 5);
  const gifResult = await validateMediaBlob(animatedGif, declaration(animatedGif, 'image/gif', 2, 2), 'animated');
  assert.equal(gifResult.frames, 2);
  assert.equal(gifResult.durationMs, 100);
});

test('公共媒体接缝拒绝伪造类型、截断文件、静态附加动画字段与非静态封面', async () => {
  const png = await source();
  const pngRef = declaration(png, 'image/png', 1254, 1254);
  await assert.rejects(validateMediaBlob(png, { ...pngRef, mime: 'image/jpeg' }, 'static'), /声明.*实际格式|格式.*不匹配/);

  const truncated = png.subarray(0, Math.floor(png.length / 2));
  await assert.rejects(validateMediaBlob(truncated, declaration(truncated, 'image/png', 1254, 1254), 'static'), /无法完整解码|素材损坏/);

  const animatedPoster = gif(1, 1, 2, 5);
  const expression = { visual: { primary: pngRef, animated: false, duration_ms: 100, poster: declaration(animatedPoster, 'image/gif', 1, 1), text_locale: null } } as Pick<Expression, 'visual'>;
  await assert.rejects(validateExpressionMedia(expression, blob => blob.sha256 === pngRef.sha256 ? Promise.resolve(png) : Promise.resolve(animatedPoster)), /静态素材.*时长|静态素材.*封面/);
  const extraPoster = { visual: { primary: pngRef, animated: false, poster: declaration(animatedPoster, 'image/gif', 1, 1), text_locale: null } };
  await assert.rejects(validateExpressionMedia(extraPoster, () => Promise.resolve(png)), /静态素材.*封面/);

  const animation = gif(1, 1, 2, 5);
  const animationRef = declaration(animation, 'image/gif', 1, 1);
  const badPosterExpression = { visual: { primary: animationRef, animated: true, duration_ms: 100, poster: animationRef, text_locale: null } };
  await assert.rejects(validateExpressionMedia(badPosterExpression, () => Promise.resolve(animation)), /独立/);
  const frame = (background: string) => sharp({ create: { width: 2, height: 2, channels: 4, background } }).png().toBuffer();
  const otherAnimation = await sharp([await frame('#ff0000'), await frame('#0000ff')], { join: { animated: true } }).webp({ delay: [50, 50] }).toBuffer();
  const animatedPosterExpression = { visual: { primary: animationRef, animated: true, duration_ms: 100, poster: declaration(otherAnimation, 'image/webp', 2, 2), text_locale: null } };
  await assert.rejects(validateExpressionMedia(animatedPosterExpression, blob => Promise.resolve(blob.sha256 === animationRef.sha256 ? animation : otherAnimation)), /静态素材实际解码为动画/);
  const wrongDuration = { visual: { primary: animationRef, animated: true, duration_ms: 101, poster: pngRef, text_locale: null } };
  await assert.rejects(validateExpressionMedia(wrongDuration, blob => Promise.resolve(blob.sha256 === animationRef.sha256 ? animation : png)), /声明与实际动图时长不匹配/);

  const fakeApngChunk = Buffer.concat([Buffer.from([0, 0, 0, 8]), Buffer.from('acTL'), Buffer.alloc(12)]);
  const apng = Buffer.concat([png.subarray(0, 33), fakeApngChunk, png.subarray(33)]);
  await assert.rejects(validateMediaBlob(apng, declaration(apng, 'image/png', 1254, 1254), 'static'), /不支持 APNG/);
  await assert.rejects(validateMediaBlob(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), declaration(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/svg+xml', 1, 1), 'static'), /只支持 PNG、JPEG 或 WebP/);
});

test('公共媒体接缝在解码前及解码过程中限制字节、边长、帧数、时长与累计像素', async () => {
  const oversized = Buffer.alloc(10 * 1024 * 1024 + 1);
  await assert.rejects(validateMediaBlob(oversized, declaration(oversized, 'image/png', 1, 1), 'static'), /10 MiB|大小超限/);

  const wide = await sharp({ create: { width: 2049, height: 1, channels: 4, background: '#000000' } }).png().toBuffer();
  await assert.rejects(validateMediaBlob(wide, declaration(wide, 'image/png', 2049, 1), 'static'), /边长.*2048|尺寸超限/);

  const tooManyFrames = gif(1, 1, 201, 1);
  await assert.rejects(validateMediaBlob(tooManyFrames, declaration(tooManyFrames, 'image/gif', 1, 1), 'animated'), /200.*帧|帧数超限/);

  const tooLong = gif(1, 1, 2, 501);
  await assert.rejects(validateMediaBlob(tooLong, declaration(tooLong, 'image/gif', 1, 1), 'animated'), /10.*秒|时长超限/);

  const tooManyPixels = gif(1024, 1024, 96, 1);
  await assert.rejects(validateMediaBlob(tooManyPixels, declaration(tooManyPixels, 'image/gif', 1024, 1024), 'animated'), /一亿|解码像素/);
});
