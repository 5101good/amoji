// Package the official Amoji 0.1 packs from assets/official-packs/sources/*.json.
// No model calls and no image re-encoding: art in images/ is already normalized.
// Run: npx tsx scripts/build-official-packs.mjs
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { exportManifest, withValidatedPack } from '../src/packs.ts';

const root = resolve(import.meta.dirname, '../assets/official-packs');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
/** Deterministic UUIDv4-shaped id; matches the Amoji Studio skill's derivation. */
const derived = (...parts) => {
  const b = createHash('sha256').update(parts.join('\x1f')).digest().subarray(0, 16);
  b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`
  : JSON.stringify(value);
const mimeOf = format => ({ png: 'image/png', webp: 'image/webp', jpeg: 'image/jpeg', gif: 'image/gif' })[format];

async function blobOf(path, blobs) {
  const bytes = await readFile(resolve(root, path));
  const meta = await sharp(bytes, { animated: true }).metadata();
  const blob = { sha256: digest(bytes), mime: mimeOf(meta.format), bytes: bytes.length, width: meta.width, height: meta.pageHeight ?? meta.height };
  blobs.set(blob.sha256, bytes);
  return { blob, animated: (meta.pages ?? 1) > 1, durationMs: (meta.delay ?? []).reduce((total, delay) => total + delay, 0) };
}

const output = new Map();
const catalog = [];
for (const file of (await readdir(resolve(root, 'sources'))).filter(name => name.endsWith('.json')).sort()) {
  const source = JSON.parse(await readFile(resolve(root, 'sources', file), 'utf8'));
  const blobs = new Map();
  const expressions = [];
  const refs = new Map();
  for (const item of source.expressions) {
    const primary = await blobOf(item.image, blobs);
    const visual = { primary: primary.blob, animated: primary.animated, text_locale: item.text_locale };
    if (primary.animated) {
      visual.poster = (await blobOf(item.poster, blobs)).blob;
      visual.duration_ms = primary.durationMs;
    }
    const expression = {
      kind: 'amoji.expression', amoji: '0.1',
      asset_id: derived('amoji-asset', source.pack_id, item.slug),
      realizes: item.realizes, intensity: item.intensity, ...(item.directions ? { directions: item.directions } : {}),
      original_locale: source.original_locale, name: item.name, semantics: item.semantics, ...(item.tags ? { tags: item.tags } : {}),
      visual, rights: source.rights, created_at: source.created_at,
    };
    expression.revision_id = derived('amoji-revision', canonical(expression));
    expressions.push(expression);
    refs.set(item.slug, { asset_id: expression.asset_id, revision_id: expression.revision_id });
  }
  const effectIds = new Map((source.effects ?? []).map(e => [e.slug, e.effect_id]));
  const effects = (source.effects ?? []).map(({ slug, ...effect }) => effect);
  const bindings = (source.bindings ?? []).map(b => ({
    target: b.target.expression ? refs.get(b.target.expression) : b.target,
    effects: b.effects.map(slug => effectIds.get(slug)),
  }));
  const manifest = {
    kind: 'amoji.pack', amoji: '0.1', pack_id: source.pack_id, version: source.version,
    original_locale: source.original_locale, locales: source.locales, name: source.name, description: source.description,
    expressions, ...(effects.length ? { effects } : {}), ...(bindings.length ? { bindings } : {}), rights: source.rights,
  };
  manifest.release_id = derived('amoji-release', canonical(manifest));
  const previous = await readFile(resolve(root, `${source.slug}.manifest.json`), 'utf8').then(JSON.parse).catch(e => { if (e.code !== 'ENOENT') throw e; });
  if (previous?.amoji === '0.1' && previous.release_id !== manifest.release_id && previous.version >= manifest.version) throw Error(`Bump ${source.slug} version before changing an immutable release`);
  const bytes = await exportManifest(manifest, async blob => blobs.get(blob.sha256));
  await withValidatedPack(bytes, async () => {}, 'market');
  output.set(`${source.slug}.amoji`, bytes);
  output.set(`${source.slug}.manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
  catalog.push({ slug: source.slug, name: source.name, pack_id: manifest.pack_id, release_id: manifest.release_id, version: manifest.version, expressions: expressions.length, effects: effects.length, archive_sha256: digest(bytes), bytes: bytes.length });
  console.log(`${source.slug}: ${expressions.length} expressions, ${effects.length} effects, ${bytes.length} bytes`);
}
const order = ['classic', 'office', 'slow-cat', 'good-dog', 'pixel-pal', 'orbit-jelly', 'paper-goose'];
catalog.sort((a, b) => order.indexOf(a.slug) - order.indexOf(b.slug));
output.set('catalog.json', JSON.stringify({ amoji: '0.1', packs: catalog }, null, 2) + '\n');
// Do not modify any product file until every archive passed both validation profiles.
for (const [path, bytes] of output) await writeFile(resolve(root, path), bytes);
