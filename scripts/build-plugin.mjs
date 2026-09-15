import { cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { configurePlugin } from './configure-plugin.mjs';
import { copyRuntime } from './build-runtime.mjs';
import { DATABASE_VERSION, CREATE_DRAFT_CAPABILITY, API_VERSION } from '../dist/src/shared-contract.js';
const root = resolve(import.meta.dirname, '..');
const source = resolve(root, 'plugins/amoji');
const destination = resolve(process.argv[2] || source);
try {
  await stat(`${destination}/.claude-plugin`);
  throw new Error('Codex 包必须使用独立目录，不能覆盖 Claude 插件产物');
} catch (error) { if (error.code !== 'ENOENT') throw error; }
if (destination !== source) {
  await mkdir(destination, { recursive: true });
  for (const name of ['.codex-plugin', 'skills']) await cp(`${source}/${name}`, `${destination}/${name}`, { recursive: true });
}
await copyRuntime(root, destination);
await configurePlugin(destination);
const metadata = JSON.parse(await readFile(`${root}/package.json`, 'utf8'));
await writeFile(`${destination}/BUILD.json`, JSON.stringify({ version: metadata.version, node: process.version, platform: process.platform, arch: process.arch, entry: 'runtime/src/main.js', serviceEntry: 'runtime/src/service-main.js', clientEntry: 'runtime/src/shared-client.js', serviceApi: API_VERSION, databaseVersion: DATABASE_VERSION, providedManagementCapabilities: [CREATE_DRAFT_CAPABILITY], source: 'Local installation; regenerate with scripts/build-plugin.mjs at the destination on each machine. Keep this installation directory after marketplace installation.' }, null, 2) + '\n');
console.log(`Built local plugin at ${destination}`);
