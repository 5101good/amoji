import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { configurePlugin } from './configure-plugin.mjs';
const root = resolve(import.meta.dirname, '..');
const source = resolve(root, 'plugins/amoji');
const destination = resolve(process.argv[2] || source);
if (destination !== source) {
  await mkdir(destination, { recursive: true });
  for (const name of ['.codex-plugin', 'skills']) await cp(`${source}/${name}`, `${destination}/${name}`, { recursive: true });
}
await mkdir(`${destination}/runtime`, { recursive: true });
await cp(`${root}/dist/src`, `${destination}/runtime/src`, { recursive: true });
await cp(`${root}/dist/docs`, `${destination}/runtime/docs`, { recursive: true });
await mkdir(`${destination}/assets/samples`, { recursive: true });
await cp(`${root}/assets/samples/blobs`, `${destination}/assets/samples/blobs`, { recursive: true });
await cp(`${root}/assets/samples/manifest.json`, `${destination}/assets/samples/manifest.json`);
await cp(`${root}/web`, `${destination}/web`, { recursive: true });
await cp(`${root}/package.json`, `${destination}/runtime/package.json`);
await cp(`${root}/package-lock.json`, `${destination}/runtime/package-lock.json`);
// Preserve npm's relative dependency links; fs.cp's default rewrites them to the source tree.
await cp(`${root}/node_modules`, `${destination}/runtime/node_modules`, { recursive: true, verbatimSymlinks: true });
await configurePlugin(destination);
const metadata = JSON.parse(await readFile(`${root}/package.json`, 'utf8'));
await writeFile(`${destination}/BUILD.json`, JSON.stringify({ version: metadata.version, node: process.version, platform: process.platform, arch: process.arch, entry: 'runtime/src/main.js', serviceEntry: 'runtime/src/service-main.js', clientEntry: 'runtime/src/shared-client.js', serviceApi: 1, source: 'Local installation; regenerate with scripts/build-plugin.mjs at the destination on each machine. Keep this installation directory after marketplace installation.' }, null, 2) + '\n');
console.log(`Built local plugin at ${destination}`);
