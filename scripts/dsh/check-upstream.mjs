// Run in the disposable CI checkout. Exercise the SDK actually shipped by each channel.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const channel = process.argv[2];
assert.ok(['latest', 'desktop-nightly'].includes(channel));
const npm = (...args) => execFileSync('npm', args, { stdio: 'inherit' });
const url = channel === 'latest'
  ? 'https://registry.npmjs.org/@deepseek-ai%2fdsh/latest'
  : 'https://download.deepseek.com/dsh-desk/feeds/mac-arm64/nightly-mac.yml';
const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
assert.ok(response.ok, `Fetching ${channel} returned ${response.status}`);
const version = channel === 'latest' ? (await response.json()).version : /^version:\s*([\w.-]+)\s*$/m.exec(await response.text())?.[1];
assert.match(version ?? '', /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/);
console.log(`Testing DSH ${channel} at ${version}`);

const read = path => JSON.parse(readFileSync(path, 'utf8'));
const write = (path, data) => writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
const pkg = read('package.json');
if (pkg.devDependencies['@deepseek-ai/dsh-tools'] === version) {
  npm('ci', '--registry=https://registry.npmjs.org');
} else {
  for (const name of Object.keys(pkg.devDependencies)) {
    if (name.startsWith('@deepseek-ai/dsh-')) pkg.devDependencies[name] = version;
  }
  const lock = read('package-lock.json');
  for (const name of Object.keys(lock.packages)) {
    if (name.includes('node_modules/@deepseek-ai/')) delete lock.packages[name];
  }
  write('package.json', pkg);
  write('package-lock.json', lock);
  npm('install', '--no-audit', '--registry=https://registry.npmjs.org');
}
npm('run', 'test:dsh');
const peers = read('adapters/dsh/package.json').peerDependencies;
for (const [name, range] of Object.entries(peers)) {
  if (name.startsWith('@deepseek-ai/dsh-')) assert.ok(range.split(' || ').includes(version), `Update the published peer contract for ${name} to include ${version}`);
}
