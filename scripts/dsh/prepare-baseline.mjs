import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
const root = resolve(import.meta.dirname, '../..');
const manifest = JSON.parse(await readFile(new URL('./baseline.json', import.meta.url), 'utf8'));
const source = resolve(root, '.cache/dsh-source');
const blobHash = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
await Promise.all(Object.entries(manifest.files).map(async ([path, sha]) => {
  const file = resolve(source, path); await mkdir(dirname(file), { recursive: true });
  let bytes; try { bytes = await readFile(file); } catch {}
  if (!bytes || blobHash(bytes) !== sha) { execFileSync('curl', ['--retry', '2', '--max-time', '60', '-fsSL', `https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/${manifest.commit}/${path}`, '-o', file]); bytes = await readFile(file); }
  if (blobHash(bytes) !== sha) throw new Error(`Pinned source mismatch: ${path}`);
}));
const alias = { '@deepseek-ai/dsh-llm': resolve(source, 'packages/llm/llm/src/error.ts'), '@deepseek-ai/dsh-util-values': resolve(source, 'packages/util/values/src/index.ts') };
await build({ entryPoints: [resolve(source, 'packages/core/tools/src/schema.ts')], bundle: true, format: 'esm', platform: 'node', outfile: resolve(source, 'tools.mjs'), alias });
await build({ entryPoints: [resolve(source, 'packages/client/ui-slots/src/index.ts')], bundle: true, format: 'esm', platform: 'node', outfile: resolve(source, 'slots.mjs') });
// The distributable entry resolves the actual baseline tool implementation here only.
await build({ entryPoints: [resolve(root, 'adapters/dsh/index.mjs')], bundle: true, format: 'esm', platform: 'node', packages: 'external', outfile: resolve(source, 'host-entry.mjs'), alias: { '@deepseek-ai/dsh-tools': resolve(source, 'tools.mjs') }, plugins: [{ name: 'preserve-core-runtime', setup(b) { b.onResolve({ filter: /^\.\/runtime\// }, args => ({ path: resolve(root, 'adapters/dsh', args.path), external: true })); } }] });
await writeFile(resolve(source, 'VERIFIED.json'), JSON.stringify({ commit: manifest.commit, verifiedFiles: Object.keys(manifest.files).length }, null, 2));
console.log(`Verified ${Object.keys(manifest.files).length} pinned files; built real defineTool, SlotCore and Host entry`);
