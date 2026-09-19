import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
const root = resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);
const manifest = JSON.parse(await readFile(new URL('./baseline.json', import.meta.url), 'utf8'));
const source = resolve(root, '.cache/dsh-source');
await mkdir(source, { recursive: true });
for (const name of manifest.packages) {
  const pkg = require(`${name}/package.json`);
  if (pkg.version !== manifest.version) throw new Error(`Wrong dsh contract ${name}: ${pkg.version}`);
}
await writeFile(resolve(source, 'tools.mjs'), `export { defineTool } from '@deepseek-ai/dsh-tools';\n`);
await writeFile(resolve(source, 'slots.mjs'), `import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Context } from '@deepseek-ai/cordis';
const require = createRequire(import.meta.url); let renderer;
new Function('window', readFileSync(require.resolve('@deepseek-ai/dsh-client-ui-renderer/client'), 'utf8'))({__ModuleLoader__: {load(value) { renderer = value.factory(require); }}});
export class SlotCore extends renderer.SlotRegistry { constructor() { super(new Context()); } }
`);
await build({ entryPoints: [resolve(root, 'adapters/dsh/index.mjs')], bundle: true, format: 'esm', platform: 'node', packages: 'external', outfile: resolve(source, 'host-entry.mjs'), plugins: [{ name: 'preserve-core-runtime', setup(b) { b.onResolve({ filter: /^\.\/runtime\// }, args => ({ path: resolve(root, 'adapters/dsh', args.path), external: true })); } }] });
await writeFile(resolve(source, 'VERIFIED.json'), JSON.stringify(manifest, null, 2));
console.log(`Verified real npm dsh ${manifest.version} packages; using published defineTool and SlotCore`);
