// Assemble the two imagegen frames without drawing or synthesizing replacement artwork.
import sharp from 'sharp';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../assets/samples');
await mkdir(`${root}/blobs`, { recursive: true });
async function blob(bytes) {
  const meta = await sharp(bytes, { animated: true }).metadata();
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  await writeFile(`${root}/blobs/${sha256}`, bytes);
  return { sha256, mime: `image/${meta.format}`, bytes: bytes.length, width: meta.width, height: meta.pageHeight ?? meta.height };
}
const visuals = [];
for (const name of ['celebrate', 'wry']) {
  visuals.push({ primary: await blob(await readFile(`${root}/source/${name}.png`)), animated: false });
}
const sprite = await readFile(`${root}/source/encourage-frames.png`);
const { width, height } = await sharp(sprite).metadata();
if (!width || !height || width % 2 !== 0) throw new Error('Expected equal-width imagegen frame sheet');
const frames = await Promise.all([0, 1].map(index => sharp(sprite).extract({ left: index * width / 2, top: 0, width: width / 2, height }).png().toBuffer()));
const animation = await sharp(frames, { join: { animated: true } }).webp({ lossless: true, loop: 0, delay: [500, 500] }).toBuffer();
await writeFile(`${root}/encourage.webp`, animation);
await writeFile(`${root}/encourage-poster.png`, frames[0]);
visuals.push({ primary: await blob(animation), animated: true, duration_ms: 1000, poster: await blob(frames[0]) });
const definitions = [
  { name: '一起庆祝', meaning: '为刚完成的进展真诚高兴并庆祝。', fallback: '[一起庆祝]', tone: '开心、真诚', use_when: ['完成阶段目标或分享好消息时'], avoid_when: ['对方正在表达痛苦时'], tags: ['庆祝', '高兴', '完成'] },
  { name: '挠头苦笑', meaning: '面对自己无伤大雅的小失误，带着善意自嘲和无奈。', fallback: '[挠头苦笑]', tone: '温和、自嘲', use_when: ['承认自己的小失误时'], avoid_when: ['讽刺他人', '对方正在认真表达痛苦时'], tags: ['自嘲', '无奈', '失误'] },
  { name: '一步一步来', meaning: '支持你的努力，我们一步一步来。', fallback: '[给你加油]', tone: '温暖、坚定', use_when: ['对方需要支持和鼓励时'], avoid_when: ['用表情代替具体帮助或必要解释'], tags: ['鼓励', '支持', '加油'] },
];
const expressions = definitions.map(({ name, tags, ...semantics }, i) => ({
  kind: 'amoji.expression', schema_version: '0.1',
  asset_id: `10000000-0000-4000-8000-00000000000${i + 1}`,
  revision_id: `30000000-0000-4000-8000-00000000000${i + 1}`,
  name, created_at: '2026-09-05T00:00:00Z', semantics: { locale: 'zh-CN', ...semantics }, tags, visual: visuals[i],
  rights: { license: 'Amoji development fixture; distribution license pending', creator: 'Amoji / Codex imagegen', source: '生成提示见 assets/samples/generation.json' },
}));
const manifest = { kind: 'amoji.pack', schema_version: '0.1', pack_id: '40000000-0000-4000-8000-000000000001', name: 'Amoji 三样本接入验证', created_at: '2026-09-05T00:00:00Z', expressions, defaults: expressions.map(({ asset_id, revision_id }) => ({ asset_id, revision_id })) };
await writeFile(`${root}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
console.log('Prepared three fixed revisions, including a 1-second two-frame WebP and PNG poster.');
