import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { API_VERSION, DATABASE_VERSION, CREATE_DRAFT_CAPABILITY } from '../src/shared-contract.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function createFromPanel(panel: URL, draft: { draft_id: string; version: number }, sample: any) {
  const headers = { Authorization: `Bearer ${panel.hash.slice(1)}`, 'Content-Type': 'application/json' };
  const bytes = Buffer.from(await (await fetch(`${panel.origin}/blobs/${sample.visual.primary.sha256}`, { headers })).arrayBuffer());
  const post = async (operation: string, body: unknown) => {
    const response = await fetch(`${panel.origin}/api/draft/${operation}`, { method: 'POST', headers, body: JSON.stringify(body) });
    const value = await response.json(); assert.equal(response.status, 200, JSON.stringify(value)); return value;
  };
  const saved = await post('save', { draft_id: draft.draft_id, version: draft.version, fields: { name: '由面板创建', semantics: { locale: 'zh-CN', meaning: '表达新创作的喜悦', fallback: '创作喜悦' }, rights: { license: '仅供个人使用' } }, upload: bytes.toString('base64') });
  await post('preview', { draft_id: saved.draft_id, version: saved.version });
  return post('confirm', { draft_id: saved.draft_id, version: saved.version });
}

test('Codex 构建器拒绝覆盖 Claude 产物且保留配置、Hook 和 Skill', async t => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'amoji-host-guard-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const destination = join(directory, 'claude-plugin');
  const root = fileURLToPath(new URL('../', import.meta.url));
  const run = promisify(execFile);
  await run('npm', ['run', 'build'], { cwd: root });
  await run(process.execPath, [join(root, 'scripts/build-claude-plugin.mjs'), destination], { cwd: directory });
  const protectedPaths = ['.mcp.json', '.claude-plugin/plugin.json', 'hooks/hooks.json', 'skills/amoji/SKILL.md', 'BUILD.json'];
  const original = await Promise.all(protectedPaths.map(path => readFile(join(destination, path), 'utf8')));
  const entries = (await readdir(destination, { recursive: true })).sort();
  await assert.rejects(run(process.execPath, [join(root, 'scripts/build-plugin.mjs'), destination], { cwd: directory }), /不能覆盖 Claude 插件产物/);
  assert.deepEqual(await Promise.all(protectedPaths.map(path => readFile(join(destination, path), 'utf8'))), original);
  assert.deepEqual((await readdir(destination, { recursive: true })).sort(), entries, '拒绝发生在复制或创建任何文件之前');
});

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
  const buildInfo = JSON.parse(await readFile(join(destination, 'BUILD.json'), 'utf8'));
  assert.equal(buildInfo.serviceApi, API_VERSION); assert.equal(buildInfo.databaseVersion, DATABASE_VERSION);
  assert.ok(buildInfo.providedManagementCapabilities.includes(CREATE_DRAFT_CAPABILITY));
  assert.equal(state.creation_available, true);
  const draft = await (await fetch(`${panel.origin}/api/draft/create`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}' })).json();
  assert.match(draft.draft_id, /^draft_/);
  const created = await createFromPanel(panel, draft, state.expressions[0]);
  const nextMeta = { 'x-codex-turn-metadata': { thread_id: 'artifact', turn_id: '2' } };
  const createdSearch = await client.callTool({ name: 'amoji_search', arguments: { query: created.name }, _meta: nextMeta });
  assert.equal(createdSearch.isError, undefined);
  const createdChoice = JSON.parse((createdSearch.content as any)[0].text).candidates[0];
  assert.equal(createdChoice.revision_id, created.revision_id);
  const createdEmit = await client.callTool({ name: 'amoji_emit', arguments: { selection_token: createdChoice.selection_token }, _meta: nextMeta });
  assert.equal(createdEmit.isError, undefined);
  assert.deepEqual((createdEmit.content as any[]).map(item => item.type), ['text']);
  const createdMessage = JSON.parse((createdEmit.content as any)[0].text);
  assert.equal(createdMessage.expression.revision_id, created.revision_id);
  assert.ok(createdMessage.display_markdown);
  assert.deepEqual(Object.keys(createdMessage.expression).sort(), ['asset_id', 'name', 'revision_id', 'semantics']);


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

test('Claude 独立产物从空 cwd 执行实际 Hook 和 MCP，且不覆盖 Codex 配置', async t => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'amoji-claude-artifact-')));
  const destination = join(directory, 'Claude plugin with spaces');
  const codex = join(directory, 'codex'); const data = join(directory, 'data');
  const root = fileURLToPath(new URL('../', import.meta.url)); const run = promisify(execFile);
  const client = new Client({ name: 'claude-artifact-test', version: '1' }); let connected = false;
  t.after(async () => {
    if (connected) await client.close();
    try {
      const descriptor = JSON.parse(await readFile(join(data, 'service.json'), 'utf8'));
      const api = await import(pathToFileURL(join(destination, 'runtime/src/shared-client.js')).href);
      await api.stopSharedService(data, descriptor.serviceId);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    finally { await rm(directory, { recursive: true, force: true }); }
  });
  await run('npm', ['run', 'build'], { cwd: root });
  await run(process.execPath, ['scripts/build-plugin.mjs', codex], { cwd: root });
  const originalCodex = await readFile(join(codex, '.mcp.json'), 'utf8');
  // Script entry must be absolute when starting outside the worktree.
  const built = await run(process.execPath, [join(root, 'scripts/build-claude-plugin.mjs'), destination], { cwd: directory }).then(() => true, () => false);
  assert.ok(built, '独立 Claude 插件构建入口必须可执行');
  assert.equal(await readFile(join(codex, '.mcp.json'), 'utf8'), originalCodex);
  const manifest = JSON.parse(await readFile(join(destination, '.claude-plugin/plugin.json'), 'utf8'));
  assert.equal(manifest.name, 'amoji');
  const config = JSON.parse(await readFile(join(destination, '.mcp.json'), 'utf8')).mcpServers.amoji;
  assert.ok(config.args.every((arg: string) => arg.includes('${CLAUDE_PLUGIN_ROOT}')));
  const info = JSON.parse(await readFile(join(destination, 'BUILD.json'), 'utf8'));
  assert.ok(info.requiredCapabilities.includes('claude-hook-tickets-v1'));
  for (const entry of await readdir(join(destination, 'runtime/node_modules'), { recursive: true, withFileTypes: true })) {
    if (entry.isSymbolicLink()) assert.ok((await realpath(join(entry.parentPath, entry.name))).startsWith(`${destination}/`));
  }
  const hooks = JSON.parse(await readFile(join(destination, 'hooks/hooks.json'), 'utf8')).hooks.PreToolUse;
  const input = { hook_event_name: 'PreToolUse', session_id: 'artifact', prompt_id: '550e8400-e29b-41d4-a716-446655440000', tool_use_id: 'toolu_artifact', tool_name: 'mcp__plugin_amoji_amoji__amoji_search', tool_input: { query: '加油' } };
  const selected = hooks.find((group: any) => new RegExp(group.matcher).test(input.tool_name));
  assert.ok(selected); assert.equal(new RegExp(selected.matcher).test('mcp__plugin_other_amoji__amoji_search'), false);
  const bin = join(directory, 'bin'); await mkdir(bin);
  for (const name of ['open', 'xdg-open']) await writeFile(join(bin, name), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const env = { PATH: `${bin}:${process.env.PATH ?? ''}`, AMOJI_DATA_DIR: data, CLAUDE_PLUGIN_ROOT: destination };
  const invokeHook = (input: unknown) => new Promise<string>((resolve, reject) => {
    const child = execFile('/bin/sh', ['-c', selected.hooks[0].command], { cwd: directory, env }, (err, stdout) => err ? reject(err) : resolve(stdout));
    child.stdin!.end(JSON.stringify(input));
  });
  const hookOutput = await invokeHook(input);
  const updated = JSON.parse(hookOutput).hookSpecificOutput;
  assert.equal(updated.permissionDecision, undefined);
  await client.connect(new StdioClientTransport({ command: config.command, args: config.args.map((arg: string) => arg.replaceAll('${CLAUDE_PLUGIN_ROOT}', destination)), cwd: directory, env, stderr: 'pipe' }));
  connected = true;
  const search = await client.callTool({ name: 'amoji_search', arguments: updated.updatedInput });
  assert.equal(search.isError, undefined, JSON.stringify(search));
  assert.deepEqual((search.content as any[]).map(c => c.type), ['text']);
  assert.equal(JSON.parse((search.content as any[])[0].text).candidates[0].name, '一步一步来');
  const candidate = JSON.parse((search.content as any[])[0].text).candidates[0];
  const emitArgs = JSON.parse(await invokeHook({ ...input, tool_use_id: 'toolu_artifact_emit', tool_name: 'mcp__plugin_amoji_amoji__amoji_emit', tool_input: { selection_token: candidate.selection_token } })).hookSpecificOutput.updatedInput;
  const sent = await client.callTool({ name: 'amoji_emit', arguments: emitArgs });
  assert.equal(sent.isError, undefined, JSON.stringify(sent));
  assert.deepEqual((sent.content as any[]).map(c => c.type), ['text']);
  const message = JSON.parse((sent.content as any[])[0].text);
  const panel = new URL(message.panel_url);
  assert.match(await (await fetch(panel.origin)).text(), /表情选择器/);
  const headers = { Authorization: `Bearer ${panel.hash.slice(1)}` };
  const state = await (await fetch(`${panel.origin}/api/state`, { headers })).json();
  const buildInfo = JSON.parse(await readFile(join(destination, 'BUILD.json'), 'utf8'));
  assert.equal(buildInfo.serviceApi, API_VERSION); assert.equal(buildInfo.databaseVersion, DATABASE_VERSION);
  assert.ok(buildInfo.providedManagementCapabilities.includes(CREATE_DRAFT_CAPABILITY));
  assert.equal(state.creation_available, true);
  const draft = await (await fetch(`${panel.origin}/api/draft/create`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}' })).json();
  assert.match(draft.draft_id, /^draft_/);
  const created = await createFromPanel(panel, draft, state.expressions[0]);
  const nextInput = { ...input, prompt_id: '550e8400-e29b-41d4-a716-446655440001' };
  const createArgs = JSON.parse(await invokeHook({ ...nextInput, tool_use_id: 'toolu_created_search', tool_input: { query: created.name } })).hookSpecificOutput.updatedInput;
  const createdSearch = await client.callTool({ name: 'amoji_search', arguments: createArgs });
  assert.equal(createdSearch.isError, undefined);
  const createdChoice = JSON.parse((createdSearch.content as any)[0].text).candidates[0];
  assert.equal(createdChoice.revision_id, created.revision_id);
  const createdArgs = JSON.parse(await invokeHook({ ...nextInput, tool_use_id: 'toolu_created_emit', tool_name: 'mcp__plugin_amoji_amoji__amoji_emit', tool_input: { selection_token: createdChoice.selection_token } })).hookSpecificOutput.updatedInput;
  const createdEmit = await client.callTool({ name: 'amoji_emit', arguments: createdArgs });
  assert.equal(createdEmit.isError, undefined);
  assert.deepEqual((createdEmit.content as any[]).map(item => item.type), ['text']);
  assert.equal(JSON.parse((createdEmit.content as any)[0].text).expression.revision_id, created.revision_id);


  assert.equal(state.host, 'claude-code'); assert.equal(state.messages[0].message_id, message.message_id);
  for (const blob of [state.messages[0].revision.visual.primary, state.messages[0].revision.visual.poster]) {
    const response = await fetch(`${panel.origin}/blobs/${blob.sha256}`, { headers });
    assert.equal(response.status, 200); assert.equal((await response.arrayBuffer()).byteLength, blob.bytes);
  }
  assert.equal(JSON.parse(await readFile(join(data, 'service.json'), 'utf8')).dataRoot, data);
});
