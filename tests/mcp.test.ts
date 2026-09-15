import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAmojiServer } from '../src/mcp-server.js';
import { SampleCatalog } from '../src/sample-catalog.js';
import { SampleRuntime } from '../src/sample-runtime.js';

test('真实 MCP 协议返回纯文本候选；伪造模型参数不能改变会话或语义', async t => {
  const catalog = await SampleCatalog.load(new URL('../assets/samples/', import.meta.url));
  const server = createAmojiServer(new SampleRuntime(catalog));
  const client = new Client({ name: 'amoji-contract-test', version: '1' });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });
  const _meta = { threadId: 'thread-a', 'x-codex-turn-metadata': { thread_id: 'thread-a', turn_id: 'turn-1' } };
  const result = await client.callTool({ name: 'amoji_search', arguments: { query: '加油' }, _meta });
  assert.equal(result.isError, undefined);
  const content = result.content as Array<{ type: string; text: string }>;
  assert.deepEqual(content.map(c => c.type), ['text']);
  const candidate = JSON.parse(content[0]!.text).candidates[0];
  assert.equal(candidate.visual, undefined);
  const bad = await client.callTool({ name: 'amoji_emit', arguments: { selection_token: candidate.selection_token, meaning: '改写', target_session: 'b' }, _meta });
  assert.equal(bad.isError, true);
  const missing = await client.callTool({ name: 'amoji_search', arguments: { query: '加油' } });
  assert.equal(missing.isError, true);
  const sent = await client.callTool({ name: 'amoji_emit', arguments: { selection_token: candidate.selection_token }, _meta });
  assert.equal(sent.isError, undefined);
  assert.deepEqual((sent.content as Array<{type: string}>).map(c => c.type), ['text']);
});

test('真实 MCP 搜索完整大语义时缩减候选，使唯一模型文本块不超过 8 KiB', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'amoji-search-budget-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, 'blobs'));
  const sourceRoot = new URL('../assets/samples/', import.meta.url);
  const source = JSON.parse(await readFile(new URL('manifest.json', sourceRoot), 'utf8'));
  const template = source.expressions[0];
  await copyFile(new URL(`blobs/${template.visual.primary.sha256}`, sourceRoot), join(directory, 'blobs', template.visual.primary.sha256));
  const expressions = Array.from({ length: 5 }, (_, index) => ({
    ...template,
    asset_id: `10000000-0000-4000-8000-0000000001${index.toString().padStart(2, '0')}`,
    revision_id: `30000000-0000-4000-8000-0000000001${index.toString().padStart(2, '0')}`,
    name: `候选${index}${'😀'.repeat(44)}`,
    semantics: {
      locale: 'zh-CN',
      meaning: `预算${'😀'.repeat(238)}`,
      fallback: '😀'.repeat(80),
      tone: '😀'.repeat(80),
      use_when: Array.from({ length: 4 }, (_, item) => `${item}${'😀'.repeat(63)}`),
      avoid_when: Array.from({ length: 4 }, (_, item) => `${item}${'😀'.repeat(63)}`),
    },
    tags: ['预算'],
  }));
  await writeFile(join(directory, 'manifest.json'), JSON.stringify({
    kind: 'amoji.pack', schema_version: '0.1', pack_id: '40000000-0000-4000-8000-000000000100', name: '预算测试', created_at: '2026-09-16T00:00:00Z', expressions,
    defaults: expressions.map(({ asset_id, revision_id }: { asset_id: string; revision_id: string }) => ({ asset_id, revision_id })),
  }));
  const catalog = await SampleCatalog.load(new URL(`file://${directory}/`));
  const server = createAmojiServer(new SampleRuntime(catalog));
  const client = new Client({ name: 'amoji-budget-test', version: '1' });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });
  const _meta = { 'x-codex-turn-metadata': { thread_id: 'budget', turn_id: 'turn-1' } };
  const result = await client.callTool({ name: 'amoji_search', arguments: { query: '预算', limit: 5 }, _meta });
  assert.equal(result.isError, undefined, JSON.stringify(result.content));
  assert.equal(result.structuredContent, undefined);
  const content = result.content as Array<{ type: string; text: string }>;
  assert.deepEqual(content.map(item => item.type), ['text']);
  assert.ok(Buffer.byteLength(content[0]!.text) <= 8 * 1024);
  assert.doesNotMatch(content[0]!.text, /visual|\/blobs\/|data:image|base64/);
  const value = JSON.parse(content[0]!.text);
  assert.ok(value.candidates.length >= 1 && value.candidates.length < 5);
  for (const candidate of value.candidates) {
    assert.equal([...candidate.name].length, 47);
    assert.equal(candidate.semantics.avoid_when.length, 4);
    assert.equal([...candidate.semantics.avoid_when[3]].length, 64);
    assert.equal(candidate.semantics.avoid_when[3], `3${'😀'.repeat(63)}`);
    assert.ok(Buffer.byteLength(JSON.stringify({ name: candidate.name, semantics: candidate.semantics })) >= 3_900);
    assert.deepEqual(Object.keys(candidate).sort(), ['asset_id', 'name', 'revision_id', 'selection_token', 'semantics']);
  }
  const missing = await client.callTool({ name: 'amoji_resolve', arguments: { asset_id: expressions[0].asset_id, revision_id: '30000000-0000-4000-8000-000000009999' }, _meta });
  assert.equal(missing.isError, true);
});
