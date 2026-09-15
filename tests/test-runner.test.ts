import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('默认回归入口无需 curl 或外网，dsh 源码准备仅显式执行', async t => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(packageJson.scripts.pretest, undefined);
  assert.equal(packageJson.scripts.test, 'node scripts/test.mjs');
  assert.match(packageJson.scripts['test:dsh'], /prepare-baseline/);
  const directory = await mkdtemp(join(tmpdir(), 'amoji-offline-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const block = join(directory, 'offline.cjs');
  await writeFile(block, `const fail=()=>{throw new Error('network is disabled for this check')}; globalThis.fetch=fail; require('node:net').Socket.prototype.connect=fail; require('node:tls').connect=fail;`);
  // PATH deliberately contains neither curl nor a shell. The runner uses the
  // current absolute Node executable and local npm dependencies only.
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: directory, NODE_OPTIONS: `--require ${block}` };
  delete env.NODE_TEST_CONTEXT;
  const output = execFileSync(process.execPath, ['--require', block, 'scripts/test.mjs', '--list'], { cwd: new URL('..', import.meta.url), env, encoding: 'utf8' });
  const files = JSON.parse(output) as string[];
  assert.ok(files.includes('tests/projection.test.ts')); assert.ok(files.every(file => !file.startsWith('tests/dsh-')));
  const result = execFileSync(process.execPath, ['--require', block, 'scripts/test.mjs', '--test-name-pattern=^模型获得完整固定语义和精确版本，不获得图片或本地路径$'], { cwd: new URL('..', import.meta.url), env, encoding: 'utf8' });
  assert.match(result, /pass 1/);
});
