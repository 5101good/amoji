import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

// The dsh integration suite requires a freshly built plugin and pinned public
// package contracts; those checks belong exclusively to test:dsh.
const root = resolve(import.meta.dirname, '..');
const files = (await readdir(resolve(root, 'tests'))).filter(name => name.endsWith('.test.ts') && !name.startsWith('dsh-')).sort().map(name => `tests/${name}`);
if (process.argv.includes('--list')) console.log(JSON.stringify(files));
else {
  const child = spawn(process.execPath, ['--import', 'tsx', '--test', ...process.argv.slice(2), ...files], { cwd: root, stdio: 'inherit' });
  child.on('error', error => { console.error(error); process.exitCode = 1; });
  child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
}
