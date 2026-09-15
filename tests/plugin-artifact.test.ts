import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('生成插件从独立目录启动共享服务与面板，素材及运行依赖不回指开发工作树', async t => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'amoji-artifact-')));
  const destination = join(directory, 'plugin');
  const data = join(directory, 'data');
  const root = fileURLToPath(new URL('../', import.meta.url));
  const run = promisify(execFile);
  const client = new Client({ name: 'artifact-test', version: '1' });
  let connected = false;
  t.after(async () => {
    if (connected) {
      await client.close();
      const descriptor = JSON.parse(await readFile(join(data, 'service.json'), 'utf8'));
      const api = await import(pathToFileURL(join(destination, 'runtime/src/shared-client.js')).href);
      await api.stopSharedService(data, descriptor.serviceId);
    }
    await rm(directory, { recursive: true, force: true });
  });
  await run('npm', ['run', 'build'], { cwd: root });
  await run(process.execPath, ['scripts/build-plugin.mjs', destination], { cwd: root });
  const escapes: string[] = [];
  for (const entry of await readdir(join(destination, 'runtime/node_modules'), { recursive: true, withFileTypes: true })) {
    if (entry.isSymbolicLink()) {
      const target = await realpath(join(entry.parentPath, entry.name));
      if (!target.startsWith(`${destination}/`)) escapes.push(target);
    }
  }
  assert.deepEqual(escapes, [], '运行依赖中的链接不能指向构建机器的 node_modules');
  const config = JSON.parse(await readFile(join(destination, '.mcp.json'), 'utf8')).mcpServers.amoji;
  await client.connect(new StdioClientTransport({ command: config.command, args: config.args, cwd: directory, env: { AMOJI_DATA_DIR: data, PATH: process.env.PATH ?? '' }, stderr: 'pipe' }));
  connected = true;
  const _meta = { 'x-codex-turn-metadata': { thread_id: 'artifact', turn_id: '1' } };
  const search = await client.callTool({ name: 'amoji_search', arguments: { query: '加油' }, _meta });
  assert.equal(search.isError, undefined, JSON.stringify(search));
  const choice = JSON.parse((search.content as any)[0].text).candidates[0];
  const sent = await client.callTool({ name: 'amoji_emit', arguments: { selection_token: choice.selection_token }, _meta });
  assert.equal(sent.isError, undefined, JSON.stringify(sent));
  assert.deepEqual((sent.content as any).map((c: any) => c.type), ['text']);
  const message = JSON.parse((sent.content as any)[0].text);
  const panel = new URL(message.panel_url);
  assert.match(await (await fetch(panel.origin)).text(), /表情选择器/);
  const headers = { Authorization: `Bearer ${panel.hash.slice(1)}` };
  const state = await (await fetch(`${panel.origin}/api/state`, { headers })).json();
  const revision = state.messages[0].revision;
  for (const blob of [revision.visual.primary, revision.visual.poster]) {
    const response = await fetch(`${panel.origin}/blobs/${blob.sha256}`, { headers });
    assert.equal(response.status, 200);
    assert.equal((await response.arrayBuffer()).byteLength, blob.bytes);
  }
  const descriptor = JSON.parse(await readFile(join(data, 'service.json'), 'utf8'));
  assert.equal(descriptor.dataRoot, data);
  assert.ok(message.display_markdown.includes(data));
});
