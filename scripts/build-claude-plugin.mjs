import { cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { copyRuntime } from './build-runtime.mjs';
import { DATABASE_VERSION, CREATE_DRAFT_CAPABILITY, API_VERSION, CLAUDE_TICKET_CAPABILITY } from '../dist/src/shared-contract.js';

const root = resolve(import.meta.dirname, '..');
const source = resolve(root, 'plugins/amoji-claude');
const destination = resolve(process.argv[2] || source);
try {
  await stat(`${destination}/.codex-plugin`);
  throw new Error('Claude 包必须使用独立目录，不能覆盖 Codex 插件产物');
} catch (error) { if (error.code !== 'ENOENT') throw error; }
if (destination !== source) {
  await mkdir(destination, { recursive: true });
  for (const name of ['.claude-plugin', '.mcp.json', 'hooks', 'skills', 'README.md']) await cp(`${source}/${name}`, `${destination}/${name}`, { recursive: true });
}
await copyRuntime(root, destination);
const metadata = JSON.parse(await readFile(`${root}/package.json`, 'utf8'));
await writeFile(`${destination}/BUILD.json`, JSON.stringify({
  version: metadata.version, node: process.version, platform: process.platform, arch: process.arch,
  entry: 'runtime/src/claude-main.js', hookEntry: 'runtime/src/claude-hook.js', serviceEntry: 'runtime/src/service-main.js', clientEntry: 'runtime/src/shared-client.js',
  serviceApi: API_VERSION, databaseVersion: DATABASE_VERSION, providedManagementCapabilities: [CREATE_DRAFT_CAPABILITY], requiredCapabilities: [CLAUDE_TICKET_CAPABILITY], minimumClaudeCode: '2.1.196',
  source: 'Ordinary Claude Code plugin with bundled platform-specific runtime dependencies. Paths resolve from CLAUDE_PLUGIN_ROOT; rebuild on each target platform.',
}, null, 2) + '\n');
console.log(`Built Claude Code plugin at ${destination}`);
