import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SharedClient, stopSharedService } from '../src/shared-client.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const ticketKey = '_amoji_ticket';
const prompt = (n = 1) => `550e8400-e29b-41d4-a716-${String(n).padStart(12, '0')}`;
const payload = (name: string, args: Record<string, unknown>, session = 'session-a', turn = prompt(), invocation = `toolu_${crypto.randomUUID()}`) => ({
  hook_event_name: 'PreToolUse', session_id: session, prompt_id: turn, tool_use_id: invocation,
  tool_name: `mcp__plugin_amoji_amoji__${name}`, tool_input: args,
  cwd: '/unrelated/work', transcript_path: '/must-not-read/transcript.jsonl', permission_mode: 'default',
});
async function sandbox(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'amoji-claude-'));
  const bin = join(directory, 'bin'); await mkdir(bin);
  const opened = join(directory, 'opened.jsonl');
  // Replace only the OS browser launcher. Real Hook, MCP, HTTP, store and web files still execute.
  for (const name of ['open', 'xdg-open']) await writeFile(join(bin, name), `#!${process.execPath}\nrequire('node:fs').appendFileSync(${JSON.stringify(opened)}, JSON.stringify(process.argv.at(-1))+'\\n');\n`, { mode: 0o755 });
  const env = { PATH: `${bin}:${process.env.PATH ?? ''}`, AMOJI_DATA_DIR: join(directory, 'data') };
  const clients: Client[] = [];
  t.after(async () => {
    for (const client of clients) await client.close();
    try { const descriptor = JSON.parse(await readFile(join(env.AMOJI_DATA_DIR, 'service.json'), 'utf8')); await stopSharedService(env.AMOJI_DATA_DIR, descriptor.serviceId); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    finally { await rm(directory, { recursive: true, force: true }); }
  });
  const hook = async (input: unknown) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/claude-hook.ts'], { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', value => { stdout += value; }); child.stderr.on('data', value => { stderr += value; });
    child.stdin.end(typeof input === 'string' ? input : JSON.stringify(input));
    const code = await new Promise(resolve => child.once('close', resolve));
    return { code, stdout, stderr };
  };
  const prepare = async (name: string, args: Record<string, unknown>, session = 'session-a', turn = prompt(), invocation?: string) => {
    const result = await hook(payload(name, args, session, turn, invocation));
    assert.equal(result.code, 0, result.stderr);
    const output = JSON.parse(result.stdout).hookSpecificOutput;
    assert.equal(output.hookEventName, 'PreToolUse');
    assert.equal(output.permissionDecision, undefined);
    assert.equal(output.additionalContext, undefined);
    return output.updatedInput;
  };
  const connect = async () => {
    const client = new Client({ name: 'claude-contract-test', version: '1' }); clients.push(client);
    await client.connect(new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'src/claude-main.ts'], cwd: root, env, stderr: 'pipe' }));
    return client;
  };
  const invoke = async (client: Client, name: string, args: Record<string, unknown>, session = 'session-a', turn = prompt()) => {
    const input = await prepare(name, args, session, turn);
    return client.callTool({ name, arguments: input });
  };
  const latestPanel = async (previous?: string) => {
    for (let i = 0; i < 150; i++) {
      try { const lines = (await readFile(opened, 'utf8')).trim().split('\n'); const url = JSON.parse(lines.at(-1)!); if (url !== previous) return new URL(url); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      await delay(20);
    }
    throw new Error('面板没有通过操作系统启动边界打开');
  };
  return { directory, env, hook, prepare, connect, invoke, latestPanel };
}
function value(result: any) {
  assert.equal(result.isError, undefined, JSON.stringify(result.content));
  assert.deepEqual(result.content.map((c: any) => c.type), ['text']);
  assert.doesNotMatch(JSON.stringify(result.content), /data:image|image_url|"visual"|"provenance"/);
  return JSON.parse(result.content[0].text);
}
function error(result: any, code: RegExp) {
  assert.equal(result.isError, true);
  assert.deepEqual(result.content.map((c: any) => c.type), ['text']);
  assert.match(result.content[0].text, code);
}
function panelApi(panel: URL, path: string, body?: unknown) {
  return fetch(`${panel.origin}${path}`, { headers: { Authorization: `Bearer ${panel.hash.slice(1)}`, 'Content-Type': 'application/json' }, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
}

test('真实 Hook 覆盖模型伪票据并保留审批；缺身份、子代理与非法参数都拒绝', async t => {
  const s = await sandbox(t);
  const input = payload('amoji_search', { query: '一步一步来', limit: 2, [ticketKey]: { sessionId: 'forged' } });
  const valid = await s.hook(input);
  assert.equal(valid.code, 0, valid.stderr);
  const output = JSON.parse(valid.stdout).hookSpecificOutput;
  assert.deepEqual(Object.keys(output).sort(), ['hookEventName', 'updatedInput']);
  assert.equal(output.updatedInput.query, '一步一步来'); assert.equal(output.updatedInput.limit, 2);
  assert.match(output.updatedInput[ticketKey], /^[A-Za-z0-9_-]{43}$/);
  for (const change of [{ session_id: '' }, { prompt_id: undefined }, { tool_use_id: '' }, { agent_id: 'subagent-1' }, { agent_type: 'Explore' }, { tool_name: 'mcp__unrelated__amoji_search' }, { hook_event_name: 'PostToolUse' }, { tool_input: { query: '一步一步来', session_id: 'forged' } }]) {
    const rejected = await s.hook({ ...input, ...change });
    assert.equal(rejected.code, 2, JSON.stringify(change)); assert.equal(rejected.stdout, '');
    assert.match(rejected.stderr, /CLAUDE_|参数/);
  }
  const malformed = await s.hook('{'); assert.equal(malformed.code, 2); assert.equal(malformed.stdout, '');
  const client = await s.connect();
  const tools = (await client.listTools()).tools;
  assert.deepEqual(tools.map(tool => tool.name), ['amoji_express', 'amoji_search', 'amoji_resolve', 'amoji_pick']);
  for (const tool of tools) assert.ok(!Object.keys(tool.inputSchema.properties ?? {}).some(k => /session|turn|prompt|invocation/.test(k)));
  error(await client.callTool({ name: 'amoji_search', arguments: { query: '一步一步来' } }), /CLAUDE_TICKET/);
  error(await client.callTool({ name: 'amoji_search', arguments: { query: '一步一步来', [ticketKey]: 'forged' } }), /CLAUDE_TICKET_UNAVAILABLE/);
  error(await client.callTool({ name: 'amoji_search', arguments: { ...output.updatedInput, query: '庆祝' } }), /CLAUDE_TICKET_MISMATCH/);
  error(await client.callTool({ name: 'amoji_search', arguments: output.updatedInput, _meta: { 'claudecode/toolUseId': 'wrong' } }), /CLAUDE_TICKET_MISMATCH/);
  const found = value(await client.callTool({ name: 'amoji_search', arguments: output.updatedInput })); assert.ok(found.candidates.length);
  error(await client.callTool({ name: 'amoji_search', arguments: output.updatedInput }), /CLAUDE_TICKET_CONSUMED/);
  const probe = await SharedClient.connect({ directory: s.env.AMOJI_DATA_DIR, requiredCapabilities: ['claude-hook-tickets-v1'] });
  await probe.close();
  await assert.rejects(SharedClient.connect({ directory: s.env.AMOJI_DATA_DIR, requiredCapabilities: ['missing-capability'] }), /CAPABILITY_UNAVAILABLE/);
});

test('真实 MCP 按码位表达，面板显示精确视觉，双会话/回合隔离且一回合限量', async t => {
  const s = await sandbox(t); const a = await s.connect(); const b = await s.connect();
  const messages: any[] = []; let previousPanel: URL | undefined;
  for (const [i, act] of ['core:celebrate', 'core:encourage', 'core:ack'].entries()) {
    const turn = prompt(i + 1);
    if (i === 0) {
      const candidate = value(await s.invoke(a, 'amoji_search', { query: '庆祝' }, 'session-a', turn)).candidates[0];
      const foreign = value(await s.invoke(b, 'amoji_express', { selection_token: candidate.selection_token }, 'session-b', turn));
      assert.deepEqual([foreign.status, foreign.reason], ['rejected', 'invalid_selection_token'], 'a token never crosses sessions');
      const resolved = value(await s.invoke(a, 'amoji_resolve', { asset_id: candidate.asset_id, revision_id: candidate.revision_id }, 'session-a', turn));
      assert.equal(resolved.act, candidate.act);
    }
    const sent = value(await s.invoke(b, 'amoji_express', { act }, 'session-a', turn));
    messages.push(sent);
    assert.deepEqual([sent.status, sent.act, sent.from, sent.presentation, sent.panel_opened], ['sent', act, 'ai', 'pending', true]);
    assert.equal(sent.display_markdown, undefined, 'Claude 普通插件的配套面板承担视觉显示');
    const panel = new URL(sent.panel_url); previousPanel = panel;
    const state = await (await panelApi(panel, '/api/state')).json();
    assert.deepEqual([state.host, state.session_id, state.turn_id], ['claude-code', 'session-a', turn]);
    assert.deepEqual(state.messages.map((m: any) => m.message_id), messages.map(m => m.message_id));
    const stored = state.messages.at(-1);
    assert.equal(stored.revision.realizes, act);
    for (const blob of [stored.revision.visual.primary, stored.revision.visual.poster].filter(Boolean)) {
      const response = await panelApi(panel, `/blobs/${blob.sha256}`);
      assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), blob.mime);
      assert.equal(createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex'), blob.sha256);
    }
    assert.equal((await panelApi(panel, '/api/ack', { message_id: sent.message_id, presentation: 'rendered' })).status, 200);
    const limited = value(await s.invoke(a, 'amoji_express', { act: 'core:thanks' }, 'session-a', turn));
    assert.deepEqual([limited.status, limited.reason], ['rejected', 'rate_limited'], 'one AI expression per response window by default');
  }
  const other = value(await s.invoke(b, 'amoji_express', { act: 'core:celebrate' }, 'session-b'));
  const panelB = new URL(other.panel_url);
  assert.notEqual(panelB.hash, previousPanel!.hash);
  assert.equal((await (await panelApi(panelB, '/api/state')).json()).messages.length, 1);
  assert.equal((await panelApi(panelB, '/api/ack', { message_id: messages[0].message_id, presentation: 'rendered' })).status, 404);
  await a.close(); await b.close();
  const resumed = await s.connect();
  const prepared = await s.prepare('amoji_pick', {}, 'session-a', prompt(10));
  const picking = resumed.callTool({ name: 'amoji_pick', arguments: prepared });
  const restored = await s.latestPanel(other.panel_url);
  const history = await (await panelApi(restored, '/api/state')).json();
  assert.equal(history.session_id, 'session-a');
  assert.deepEqual(history.messages.map((m: any) => m.message_id), messages.map(m => m.message_id));
  assert.ok(history.messages.every((m: any) => m.presentation === 'rendered'));
  await panelApi(restored, '/api/cancel', { pick_id: history.pending_pick });
  error(await picking, /取消/);
});

test('人工 pick 只回应发起调用，闲置和串会话选择拒绝，固定语义与原消息 ID 可回放', async t => {
  const s = await sandbox(t); const a = await s.connect(); const b = await s.connect();
  const pickA = a.callTool({ name: 'amoji_pick', arguments: await s.prepare('amoji_pick', {}, 'session-a') });
  const panelA = await s.latestPanel(); const stateA = await (await panelApi(panelA, '/api/state')).json();
  const pickB = b.callTool({ name: 'amoji_pick', arguments: await s.prepare('amoji_pick', {}, 'session-b') });
  const panelB = await s.latestPanel(panelA.href); const stateB = await (await panelApi(panelB, '/api/state')).json();
  const chosen = stateA.expressions[1];
  const body = { pick_id: stateA.pending_pick, asset_id: chosen.asset_id, revision_id: chosen.revision_id };
  assert.equal((await panelApi(panelB, '/api/select', body)).status, 409);
  assert.equal((await panelApi(panelA, '/api/select', { ...body, semantics: 'forged' })).status, 400);
  const selected = await (await panelApi(panelA, '/api/select', body)).json();
  const result = value(await pickA);
  assert.deepEqual([result.from, result.message_id, result.act], ['human', selected.message_id, chosen.realizes]);
  assert.equal(result.meaning, chosen.semantics[chosen.original_locale].meaning);
  assert.equal((await (await panelApi(panelA, '/api/select', body)).json()).message_id, result.message_id);
  assert.equal((await panelApi(panelA, '/api/select', { ...body, pick_id: 'idle-forged' })).status, 409);
  const state = await (await panelApi(panelA, '/api/state')).json();
  assert.equal(state.messages.length, 1); assert.equal(state.messages[0].message_id, result.message_id);
  assert.equal((await (await panelApi(panelB, '/api/state')).json()).messages.length, 0);
  await panelApi(panelB, '/api/cancel', { pick_id: stateB.pending_pick }); error(await pickB, /取消/);
});
