import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { stopSharedService } from '../src/shared-client.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('宿主关闭 stdin 后适配器与本地面板退出，共享实例可在无连接时安全停止', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'amoji-lifecycle-'));
  t.after(async () => {
    const descriptor = JSON.parse(await readFile(join(directory, 'service.json'), 'utf8'));
    await stopSharedService(directory, descriptor.serviceId);
    await rm(directory, { recursive: true, force: true });
  });
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], { cwd: fileURLToPath(new URL('../', import.meta.url)), env: { ...process.env, AMOJI_DATA_DIR: directory, AMOJI_SAMPLE_ROOT: fileURLToPath(new URL('../assets/samples/', import.meta.url)) }, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  const initialized = new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.stdout.once('data', () => resolve());
    child.once('exit', () => reject(new Error('初始化前退出')));
  });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'lifecycle-test', version: '1' } } }) + '\n');
  await initialized;
  const exited = new Promise<number | null>(resolve => child.once('exit', resolve));
  child.stdin.end();
  const result = await Promise.race([exited, new Promise(resolve => setTimeout(() => resolve('timeout'), 1500))]);
  assert.equal(result, 0);
});
