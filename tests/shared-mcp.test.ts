import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('两个真实 MCP 适配进程复用选择凭据与消息服务，面板回执同 ID 且一端退出不影响另一端', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'amoji-shared-mcp-'));
  const clients: Client[] = [];
  t.after(async () => {
    await Promise.all(clients.map(client => client.close()));
    try {
      const descriptor = JSON.parse(await readFile(join(directory, 'service.json'), 'utf8'));
      const module = '../src/shared-client.js';
      await (await import(module)).stopSharedService(directory, descriptor.serviceId);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    finally { await rm(directory, { recursive: true, force: true }); }
  });
  const connect = async () => {
    const client = new Client({ name: 'mcp-shared-test', version: '1' }); clients.push(client);
    await client.connect(new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'src/main.ts'], cwd: fileURLToPath(new URL('../', import.meta.url)), env: { ...process.env as Record<string, string>, AMOJI_DATA_DIR: directory, AMOJI_SAMPLE_ROOT: fileURLToPath(new URL('../assets/samples/', import.meta.url)) }, stderr: 'pipe' }));
    return client;
  };
  const a = await connect();
  const b = await connect();
  const meta = (session: string, turn = '1') => ({ 'x-codex-turn-metadata': { thread_id: session, turn_id: turn } });
  const invoke = async (client: Client, name: string, args: Record<string, unknown>, session = 'shared') => {
    const result = await client.callTool({ name, arguments: args, _meta: meta(session) });
    assert.equal(result.isError, undefined, JSON.stringify(result.content));
    assert.deepEqual((result.content as Array<{ type: string }>).map(c => c.type), ['text']);
    return JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
  };
  const choice = (await invoke(a, 'amoji_search', { query: '加油' })).candidates[0];
  const sent = await invoke(b, 'amoji_emit', { selection_token: choice.selection_token });
  assert.deepEqual(Object.keys(sent.expression).sort(), ['asset_id', 'name', 'revision_id', 'semantics']);
  const panel = new URL(sent.panel_url);
  const headers = { Authorization: `Bearer ${panel.hash.slice(1)}`, 'Content-Type': 'application/json' };
  const state = await (await fetch(`${panel.origin}/api/state`, { headers })).json();
  assert.equal(state.messages[0].message_id, sent.message_id);
  assert.equal(state.messages[0].revision.visual.animated, true);
  assert.equal((await fetch(`${panel.origin}/api/ack`, { method: 'POST', headers, body: JSON.stringify({ message_id: sent.message_id, presentation: 'rendered' }) })).status, 200);
  const refreshed = await (await fetch(`${panel.origin}/api/state`, { headers })).json();
  assert.equal(refreshed.messages[0].presentation, 'rendered');
  assert.equal(refreshed.messages[0].delivery, 'pending');
  assert.equal((await invoke(a, 'amoji_emit', { selection_token: choice.selection_token })).message_id, sent.message_id);
  await a.close();
  const second = (await invoke(b, 'amoji_search', { query: '庆祝' }, 'another')).candidates[0];
  const other = await invoke(b, 'amoji_emit', { selection_token: second.selection_token }, 'another');
  assert.notEqual(other.message_id, sent.message_id);
  const url = new URL(other.panel_url);
  const otherHeaders = { Authorization: `Bearer ${url.hash.slice(1)}`, 'Content-Type': 'application/json' };
  assert.equal((await fetch(`${url.origin}/api/ack`, { method: 'POST', headers: otherHeaders, body: JSON.stringify({ message_id: sent.message_id, presentation: 'rendered' }) })).status, 404);
  assert.equal((await (await fetch(`${url.origin}/api/state`, { headers: otherHeaders })).json()).messages.length, 1);
});
