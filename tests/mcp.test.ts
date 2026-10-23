import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createAmojiServer } from '../src/mcp-server.js';
import { exportManifest, withValidatedPack } from '../src/packs.js';
import type { LibraryStore } from '../src/library-store.js';
import { OFFICIAL, openStore, storeRuntime } from './helpers/store-runtime.js';

const meta = (thread: string, turn = 'turn-1') => ({ threadId: thread, 'x-codex-turn-metadata': { thread_id: thread, turn_id: turn } });
const text = (result: Awaited<ReturnType<Client['callTool']>>) => {
  const content = result.content as Array<{ type: string; text: string }>;
  assert.deepEqual(content.map(c => c.type), ['text'], 'models only ever receive text');
  return content[0]!.text;
};
async function connect(t: TestContext, seeds?: URL[]): Promise<{ client: Client; store: LibraryStore }> {
  const { store, directory, close } = await openStore(seeds);
  const server = createAmojiServer(storeRuntime(store, directory));
  const client = new Client({ name: 'amoji-contract-test', version: '1' });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); await close(); });
  return { client, store };
}

test('real MCP calls express by act, return text only, and cannot override sessions or semantics', async t => {
  const { client } = await connect(t);
  assert.deepEqual((await client.listTools()).tools.map(tool => tool.name), ['amoji_express', 'amoji_search', 'amoji_resolve']);
  const forged = await client.callTool({ name: 'amoji_express', arguments: { act: 'core:ack', meaning: '改写', target_session: 'b' }, _meta: meta('thread-a') });
  assert.equal(forged.isError, true, 'unknown arguments are rejected by the tool schema');
  const untrusted = await client.callTool({ name: 'amoji_express', arguments: { act: 'core:ack' } });
  assert.equal(untrusted.isError, true, 'the session comes from the host, never from the model');
  const sent = await client.callTool({ name: 'amoji_express', arguments: { act: 'core:ack', rationale: '确认收到' }, _meta: meta('thread-a') });
  assert.equal(sent.isError, undefined);
  const value = JSON.parse(text(sent));
  assert.deepEqual([value.status, value.act, value.from], ['sent', 'core:ack', 'ai']);
  assert.match(value.display_markdown, /^!\[[^\]]+\]\(<\/.+\/blobs\/[a-f0-9]{64}>\)$/, 'the human display path is a local file, outside the projection');
  const limited = JSON.parse(text(await client.callTool({ name: 'amoji_express', arguments: { act: 'core:thanks' }, _meta: meta('thread-a') })));
  assert.deepEqual([limited.status, limited.reason], ['rejected', 'rate_limited'], 'rejections are reason codes, not tool errors');
  const search = JSON.parse(text(await client.callTool({ name: 'amoji_search', arguments: { query: '加油' }, _meta: meta('thread-a', 'turn-2') })));
  const candidate = search.candidates[0];
  assert.equal(candidate.visual, undefined);
  const chosen = JSON.parse(text(await client.callTool({ name: 'amoji_express', arguments: { selection_token: candidate.selection_token }, _meta: meta('thread-a', 'turn-2') })));
  assert.equal(chosen.status, 'sent');
});

test('search results with very large semantics shrink to fit one 8 KiB text block', async t => {
  // A pack whose every text field is at its protocol maximum.
  const big = await withValidatedPack(await readFile(new URL('pixel-pal.amoji', OFFICIAL)), async pack => {
    const fill = (prefix: string, n: number) => prefix + '😀'.repeat(n - [...prefix].length);
    const template = pack.manifest.expressions[0]!;
    const expressions = Array.from({ length: 5 }, (_, index) => ({
      ...structuredClone(template), asset_id: randomUUID(), revision_id: randomUUID(),
      name: { 'zh-CN': fill(`预算${index}`, 40), en: fill(`budget${index}`, 40) },
      semantics: Object.fromEntries(['zh-CN', 'en'].map(locale => [locale, {
        meaning: fill('预算', 240), fallback: fill('', 80),
        use_when: Array.from({ length: 4 }, (_, item) => fill(String(item), 64)), avoid_when: Array.from({ length: 4 }, (_, item) => fill(`!${item}`, 64)),
        ...(locale === 'en' ? { translation: { from: 'zh-CN', method: 'machine' as const } } : {}),
      }])),
    }));
    return exportManifest({ ...pack.manifest, pack_id: randomUUID(), release_id: randomUUID(), expressions }, blob => pack.readBlob(blob));
  });
  const { client, store } = await connect(t, []);
  await store.importPack(big);
  const result = await client.callTool({ name: 'amoji_search', arguments: { query: '预算', limit: 5 }, _meta: meta('budget') });
  assert.equal(result.isError, undefined, JSON.stringify(result.content));
  const body = text(result);
  assert.ok(Buffer.byteLength(body) <= 8 * 1024);
  assert.doesNotMatch(body, /visual|\/blobs\/|data:image|base64/);
  const value = JSON.parse(body);
  assert.ok(value.candidates.length >= 1 && value.candidates.length < 5, 'candidates are dropped whole, never truncated');
  for (const candidate of value.candidates) assert.equal([...candidate.meaning].length, 240);
  const missing = await client.callTool({ name: 'amoji_resolve', arguments: { asset_id: randomUUID(), revision_id: randomUUID() }, _meta: meta('budget') });
  assert.equal(missing.isError, true);
});
