// Repackage the complete Classic/Office collections and original imagegen art.
// No model calls. Pass a private source directory only when preparing new art.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { ZipFile } from 'yazl';
import sharp from 'sharp';
import { withValidatedPack, validatePackManifest } from '../dist/src/packs.js';

const root = resolve(import.meta.dirname, '../assets/official-packs');
const sourceRoot = process.argv[2] && resolve(process.argv[2]);
const definitions = JSON.parse(await readFile(`${root}/definitions.json`, 'utf8'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const uuid = value => {
  const b = createHash('sha256').update(value).digest().subarray(0, 16);
  b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
  const h = b.toString('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
};
const rights = { license: 'CC0-1.0', creator: 'Amoji', source: 'https://github.com/5101good/amoji/tree/main/assets/official-packs' };
const catalog = [], provenance = sourceRoot ? [] : JSON.parse(await readFile(`${root}/provenance.json`, 'utf8')).entries;
const output = new Map();
const actionSources = await Promise.all(['make-it-clear', 'work-well-together'].map(async slug => JSON.parse(await readFile(resolve(root, `../scenario-packs/${slug}.manifest.json`), 'utf8'))));

async function archive(manifest, blobs) {
  validatePackManifest(manifest);
  const zip = new ZipFile(), chunks = [];
  const done = new Promise((res, rej) => {
    zip.outputStream.on('data', b => chunks.push(b)).on('end', () => res(Buffer.concat(chunks))).on('error', rej);
    zip.on('error', rej);
  });
  const options = { mtime: new Date(definitions.created_at), mode: 0o100644 };
  zip.addBuffer(Buffer.from(JSON.stringify(manifest)), 'manifest.json', options);
  for (const [hash, bytes] of [...blobs].sort(([a], [b]) => a.localeCompare(b))) zip.addBuffer(bytes, `blobs/${hash}`, options);
  zip.end();
  const bytes = await done;
  await withValidatedPack(bytes, async () => {}, 'market');
  return bytes;
}

await withValidatedPack(await readFile(resolve(root, '../base-library/base.amoji')), async base => {
  for (const definition of definitions.packs) {
    const blobs = new Map();
    let expressions, actions = [], bindings = [];
    if (definition.appearance) {
      expressions = base.manifest.expressions.filter(e => e.tags?.includes(`amoji:appearance:${definition.appearance}`));
      if (expressions.length !== 24) throw Error(`Incomplete built-in collection: ${definition.slug}`);
      for (const e of expressions) for (const media of [e.visual.primary, e.visual.poster].filter(Boolean)) blobs.set(media.sha256, await base.readBlob(media));
      actions = actionSources.flatMap(p => p.actions);
      const ids = new Set(expressions.map(e => e.asset_id));
      bindings = actionSources.flatMap(p => p.bindings.filter(b => ids.has(b.expression.asset_id)));
    } else {
      expressions = [];
      for (const e of definition.expressions) {
        const path = `images/${definition.slug}/${e.slug}.webp`;
        let bytes;
        if (sourceRoot) {
          const original = await readFile(`${sourceRoot}/${definition.slug}/${e.slug}.png`);
          const meta = await sharp(original).metadata(), stats = await sharp(original).stats();
          if (!meta.hasAlpha || stats.channels[3]?.min !== 0 || stats.channels[3]?.max !== 255) throw Error(`Expected transparent art: ${path}`);
          // Encoding/display-budget normalization only. Keep composition and alpha.
          bytes = await sharp(original).resize(512, 512, { fit: 'contain', background: '#00000000', ...(definition.style === 'pixel' ? {kernel: 'nearest'} : {}) }).webp({ quality: 94, alphaQuality: 100 }).toBuffer();
          output.set(path, bytes);
          provenance.push({ pack: definition.slug, expression: e.slug, generator: 'Codex built-in imagegen', source_sha256: digest(original), file: path, prompt_source: 'generation.json', processing: '512px WebP encoding with alpha preserved; no compositional or semantic edits.' });
        }
        bytes ??= await readFile(`${root}/${path}`);
        const hash = digest(bytes);
        const meta = await sharp(bytes).metadata();
        blobs.set(hash, bytes);
        const expression = {
          kind: 'amoji.expression', schema_version: '0.1',
          asset_id: uuid(`amoji-originals:${definition.slug}:${e.slug}`),
          created_at: definitions.created_at, name: e.name,
          semantics: { locale: 'zh-CN', meaning: e.meaning, tone: e.tone, fallback: `[${e.name}]`, use_when: e.use_when, avoid_when: e.avoid_when },
          tags: [`协作:${definition.scenario[0]}`, `画风:${definition.style}`, `角色:${definition.slug}`, e.name, ...definition.scenario],
          visual: { primary: { sha256: hash, mime: 'image/webp', bytes: bytes.length, width: meta.width, height: meta.height }, animated: false },
          rights,
        };
        expression.revision_id = uuid(JSON.stringify(expression));
        expressions.push(expression);
      }
    }
    const manifest = {
      kind: 'amoji.pack', schema_version: '0.2', pack_id: uuid(`amoji-official-pack:${definition.slug}`),
      release_id: '', version: definition.version ?? 1, name: definition.name, created_at: definitions.created_at,
      description: definition.description, scenario: definition.scenario, styles: [definition.appearance ?? definition.style],
      expressions, defaults: expressions.map(({asset_id, revision_id}) => ({asset_id, revision_id})), actions, bindings, rights,
    };
    manifest.release_id = uuid(JSON.stringify(manifest));
    const previous = await readFile(`${root}/${definition.slug}.manifest.json`, 'utf8').then(JSON.parse).catch(e => { if (e.code !== 'ENOENT') throw e; });
    if (previous && previous.release_id !== manifest.release_id && previous.version >= manifest.version) throw Error(`Bump ${definition.slug} version before changing an immutable release`);
    const bytes = await archive(manifest, blobs);
    output.set(`${definition.slug}.amoji`, bytes);
    output.set(`${definition.slug}.manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
    catalog.push({ slug: definition.slug, name: definition.name, pack_id: manifest.pack_id, release_id: manifest.release_id, expressions: expressions.length, archive_sha256: digest(bytes), bytes: bytes.length });
    console.log(`${definition.slug}: ${expressions.length} expressions, ${bytes.length} bytes`);
  }
});
output.set('LICENSE', await readFile(resolve(root, '../base-library/LICENSE')));
output.set('catalog.json', JSON.stringify({ packs: catalog }, null, 2) + '\n');
if (sourceRoot) output.set('provenance.json', JSON.stringify({ license: rights.license, created_at: definitions.created_at, entries: provenance }, null, 2) + '\n');
// Do not modify any existing product files until all seven archives pass.
for (const [path, bytes] of output) {
  await mkdir(dirname(`${root}/${path}`), {recursive: true});
  await writeFile(`${root}/${path}`, bytes);
}
