import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

test('三样本使用真实可解码图像，固定摘要，并有短循环动画与封面', async () => {
  const manifest = JSON.parse(await readFile(new URL('../assets/samples/manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.expressions.length, 3);
  assert.equal(manifest.expressions.filter((e: any) => e.visual.animated).length, 1);
  for (const expression of manifest.expressions) {
    const { primary, poster, animated, duration_ms } = expression.visual;
    for (const blob of [primary, poster].filter(Boolean)) {
      const bytes = await readFile(new URL(`../assets/samples/blobs/${blob.sha256}`, import.meta.url));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), blob.sha256);
      assert.equal(bytes.length, blob.bytes);
      const metadata = await sharp(bytes, { animated: true }).metadata();
      assert.equal(metadata.width, blob.width);
      assert.equal(metadata.pageHeight ?? metadata.height, blob.height);
    }
    if (animated) {
      const bytes = await readFile(new URL(`../assets/samples/blobs/${primary.sha256}`, import.meta.url));
      const meta = await sharp(bytes, { animated: true }).metadata();
      assert.ok((meta.pages ?? 0) > 1);
      assert.equal(meta.loop, 0);
      assert.equal(meta.delay?.reduce((sum, n) => sum + n, 0), duration_ms);
      assert.ok(duration_ms <= 10000);
      assert.ok(poster);
    }
  }
});
