import { readFile, mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { ZipFile } from 'yazl';
import { withValidatedPack } from '../dist/src/packs.js';

// Content steward build: existing selected imagegen output only; never calls a model.
const root = resolve(import.meta.dirname, '..');
const input = resolve(process.argv[2] ?? `${root}/.local/base-library-authoring`);
const destination = `${root}/assets/base-library`;
const authoring = JSON.parse(await readFile(`${input}/authoring.json`, 'utf8'));
const inventory = JSON.parse(await readFile(`${input}/inventory.json`, 'utf8'));
const generation = JSON.parse(await readFile(`${input}/generation.json`, 'utf8'));
const legacy = JSON.parse(await readFile(`${input}/legacy-generation.json`, 'utf8'));
const uuid = text => { const b = createHash('sha256').update(text).digest().subarray(0, 16); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128; const h = b.toString('hex'); return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`; };
const blobs = new Map(); const provenance = [];
const expressions = [];
for (const draft of authoring.entries) {
  const item = inventory.entries.find(e => e.slug === draft.slug);
  if (!item) throw new Error(`缺少已验证素材 ${draft.slug}`);
  const primary = { sha256: item.sha256, mime: `image/${item.format}`, bytes: item.bytes, width: item.width, height: item.height };
  const visual = { primary, animated: item.frames > 1 };
  blobs.set(primary.sha256, await readFile(`${input}/${item.source}`));
  if (item.poster) {
    visual.duration_ms = item.duration_ms;
    visual.poster = { sha256: item.poster.sha256, mime: 'image/png', bytes: item.poster.bytes, width: item.width, height: item.height };
    blobs.set(item.poster.sha256, await readFile(`${input}/${item.poster.source}`));
  }
  const expression = { kind: 'amoji.expression', schema_version: '0.1', asset_id: uuid(`amoji-base-v1:${draft.slug}`), created_at: '2026-09-19T00:00:00Z', name: draft.name, semantics: draft.semantics, tags: draft.tags, visual, rights: { license: 'CC0-1.0', creator: 'Amoji contributors', source: 'AI-generated with Codex imagegen; assets/base-library/provenance.json' } };
  expression.revision_id = uuid(JSON.stringify(expression)); expressions.push(expression);
  provenance.push({ slug: draft.slug, group: draft.group, asset_id: expression.asset_id, revision_id: expression.revision_id, source: `base.amoji!/blobs/${primary.sha256}`, ...(visual.poster ? { poster: `base.amoji!/blobs/${visual.poster.sha256}` } : {}), generator: 'Codex built-in imagegen', prompts: generation.filter(g => g.slug === draft.slug).map(({ prompt, status, reason }) => ({ prompt, status, ...(reason ? { reason } : {}) })), legacy_prompt: legacy.prompts.find(([slug]) => slug === draft.slug)?.[1] ?? null, animation: visual.animated ? 'Existing two-frame animated WebP packaged from the generated sprite; no regenerated frames.' : null });
}
const manifest = { kind: 'amoji.pack', schema_version: '0.1', pack_id: uuid('amoji-base-v1:24'), name: 'Amoji 基础表情库', created_at: '2026-09-19T00:00:00Z', expressions, defaults: expressions.map(({ asset_id, revision_id }) => ({ asset_id, revision_id })) };
await mkdir(destination, { recursive: true });
const temporary = `${destination}/base.amoji.tmp`;
try {
  const zip = new ZipFile(); const done = pipeline(zip.outputStream, createWriteStream(temporary, { mode: 0o600 }));
  zip.on('error', error => zip.outputStream.destroy(error));
  zip.addBuffer(Buffer.from(JSON.stringify(manifest)), 'manifest.json', { mtime: new Date(manifest.created_at) });
  for (const [digest, bytes] of blobs) zip.addBuffer(bytes, `blobs/${digest}`, { mtime: new Date(manifest.created_at) });
  zip.end(); await done;
  await withValidatedPack(createReadStream(temporary), async ({ manifest }) => { if (manifest.expressions.length !== 24) throw new Error('基础包数量应为24'); });
  await rename(temporary, `${destination}/base.amoji`);
  await writeFile(`${destination}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
  await writeFile(`${destination}/provenance.json`, JSON.stringify({ license: 'CC0-1.0', scope: 'Only the project base-library assets and definitions. Private or imported user content is excluded.', generator: 'Codex built-in imagegen', reference: 'Project-generated celebrate character, recorded under legacy_prompt; no external IM sticker or real-person reference recorded.', authoring_dates: ['2026-09-05', '2026-09-16'], assembled_at: manifest.created_at, entries: provenance }, null, 2) + '\n');
  console.log(JSON.stringify({ expressions: expressions.length, blobs: blobs.size, archive: 'assets/base-library/base.amoji', validated: true }));
} finally { await rm(temporary, { force: true }); }
