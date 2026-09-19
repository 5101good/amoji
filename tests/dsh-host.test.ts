import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startSharedService } from '../src/shared-service.js';
import { SharedClient } from '../src/shared-client.js';
import { ConnectedRuntime } from '../src/adapter-runtime.js';
import { DshAdapter, installDsh } from '../src/dsh/host.js';
import type { DshEvent, DshExecution, DshSession, HostPort, ToolOptions, HistoryEntry, VisualData } from '../src/dsh/contracts.js';
import type { SampleMessage } from '../src/sample-runtime.js';
const toolModule = new URL('../.cache/dsh-source/tools.mjs', import.meta.url).href;
const { defineTool } = await import(toolModule) as { defineTool(options: ToolOptions): ToolOptions };
const signal = () => new AbortController().signal;

class Session implements DshSession {
  events: DshEvent[] = [];
  constructor(readonly id: string) {}
  snapshotEvents() { return this.events; }
  append(type: string, data: Record<string, unknown>) { const event = { type, seq: this.events.length, data: structuredClone(data) }; this.events.push(event); return event; }
}
async function setup(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'amoji-dsh-'));
  const service = await startSharedService(directory, new URL('../assets/samples/', import.meta.url));
  const client = await SharedClient.connect({ directory, requiredCapabilities: ['dsh-idle-submission-v1'] });
  t.after(async () => { await client.close(); await service.close(); await rm(directory, { recursive: true, force: true }); });
  const runtime = new ConnectedRuntime(client); const a = new Session('session-a'); const b = new Session('session-b'); const sessions = new Map([[a.id, a], [b.id, b]]); const turns = new Map([[a.id, 7], [b.id, 11]]);
  const tools = new Map<string, ToolOptions>(); const prompts: Array<{ sessionId: string; requestId: string; content: readonly { type: 'text'; text: string }[] }> = [];
  const disposers: Array<() => void | Promise<void>> = [];
  const ctx: HostPort = {
    tools: { register(value) { const tool = value as ToolOptions; tools.set(tool.name, tool); } },
    sessions: { get: id => sessions.get(id), flush: async () => true },
    sessionProjections: { stateOf: session => ({ openTurnStartSeq: turns.get(session.id) ?? null }) },
    sessionController: {
      resolveAgent: async id => { const session = sessions.get(id); return session ? { agent: { id, session } } : { error: new Error('session not found') }; },
      inspect: async id => { const session = sessions.get(id); if (!session) throw new Error('session not found'); return { events: session.snapshotEvents() }; },
      prompt: async request => { prompts.push(request); return { accepted: true }; },
    },
    connection: { fetch: { register: () => async () => {} } },
    effect(factory) { disposers.push(factory()); },
  };
  installDsh(ctx, runtime, 'fixture-host', defineTool);
  const adapter = new DshAdapter(ctx, runtime, 'fixture-host');
  const exec = (session: Session, callId = 'call-1'): DshExecution => ({ agent: { id: session.id, session }, callId, rootCallId: 'root-call', signal: signal() });
  const call = (name: string, args: unknown, context: DshExecution) => tools.get(name)!.execute(args, context);
  return { directory, client, runtime, ctx, a, b, sessions, turns, tools, prompts, adapter, exec, call, disposers };
}

test('0.1.5-rc.2 defineTool 的真实入口：身份、回合、参数拒绝和双会话精确版本', async t => {
  const f = await setup(t);
  await assert.rejects(f.call('amoji_search', { query: '庆祝' }, { callId: 'x', signal: signal() }), /DSH_CONTEXT_UNAVAILABLE/);
  await assert.rejects(f.call('amoji_search', { query: '庆祝' }, f.exec(new Session(f.a.id))), /DSH_CONTEXT_UNAVAILABLE/);
  await assert.rejects(f.call('amoji_search', { query: '庆祝', sessionId: f.b.id }, f.exec(f.a)), /INVALID_ARGUMENT/);
  f.turns.delete(f.a.id); await assert.rejects(f.call('amoji_search', { query: '庆祝' }, f.exec(f.a)), /DSH_TURN_UNAVAILABLE/); f.turns.set(f.a.id, 7);
  const found = await f.call('amoji_search', { query: '庆祝' }, f.exec(f.a, 'search-call')) as { text: string };
  const token = JSON.parse(found.text).candidates[0].selection_token;
  await assert.rejects(f.call('amoji_emit', { selection_token: token }, f.exec(f.b)), /BINDING_MISMATCH/);
  const emitted = await f.call('amoji_emit', { selection_token: token }, f.exec(f.a, 'emit-call')) as { text: string; meta: { messageId: string; visualHash: string } };
  assert.match(emitted.text, /庆祝/); assert.doesNotMatch(emitted.text, /base64|visual|image\/|sha256/);
  const content = f.tools.get('amoji_emit')!.output.render({}, emitted); assert.ok(content.every(b => b.type === 'text'));
  assert.deepEqual(f.tools.get('amoji_emit')!.output.presentationMeta!({}, emitted), emitted.meta);
  const history = await f.adapter.rpc('amoji/history', { sessionId: f.a.id }, signal()) as HistoryEntry[];
  assert.equal(history[0]!.meta.visualHash, emitted.meta.visualHash);
  assert.equal((await f.adapter.rpc('amoji/history', { sessionId: f.b.id }, signal()) as unknown[]).length, 0);
  await assert.rejects(f.adapter.rpc('amoji/visual', { sessionId: f.b.id, ref: history[0]!.meta.ref, messageId: emitted.meta.messageId }, signal()), /BINDING_MISMATCH/);
  const visual = await f.adapter.rpc('amoji/visual', { sessionId: f.a.id, ref: history[0]!.meta.ref, messageId: emitted.meta.messageId }, signal()) as VisualData;
  assert.ok(visual.primary.startsWith('data:image/'));
  await f.adapter.rpc('amoji/display', { sessionId: f.a.id, messageId: emitted.meta.messageId, hash: emitted.meta.visualHash, state: 'failed' }, signal());
  assert.equal((await f.adapter.rpc('amoji/history', { sessionId: f.a.id }, signal()) as HistoryEntry[])[0]!.message.presentation, 'fallback');
  assert.equal(f.a.events.some(event => event.type.startsWith('amoji/')), false, '不得污染原生 Session 冷恢复');
});

test('idle submission 不造 turn；幂等 requestId、纯文字 prompt 与持久记录恢复', async t => {
  const f = await setup(t); f.turns.clear(); const [expression, other] = await f.client.list(); assert.ok(expression && other);
  const ref = { asset_id: expression.asset_id, revision_id: expression.revision_id }; const request = { sessionId: f.a.id, ref, requestId: 'user-choice-1' };
  const first = await f.adapter.rpc('amoji/submit', request, signal()) as HistoryEntry;
  assert.equal(first.host!.status, 'accepted'); assert.equal(first.message.delivery, 'pending');
  assert.equal(f.a.events.some(event => event.type.startsWith('amoji/')), false);
  const recovered = new DshAdapter(f.ctx, new ConnectedRuntime(f.client), 'fixture-host');
  assert.equal(((await recovered.rpc('amoji/history', { sessionId: f.a.id }, signal())) as HistoryEntry[])[0]!.host!.status, 'accepted');
  const again = await f.adapter.rpc('amoji/submit', request, signal()) as HistoryEntry; assert.equal(first.meta.messageId, again.meta.messageId);
  assert.equal(f.prompts[0]!.requestId, `amoji:${first.meta.messageId}`); assert.equal(f.prompts[0]!.requestId, f.prompts[1]!.requestId);
  assert.ok(f.prompts.every(p => p.sessionId === f.a.id && p.content.every(c => c.type === 'text'))); assert.doesNotMatch(JSON.stringify(f.prompts), /data:image|base64|visual/);
  await assert.rejects(f.adapter.rpc('amoji/submit', { ...request, ref: { asset_id: other.asset_id, revision_id: other.revision_id } }, signal()), /REQUEST_CONFLICT/);
  const turn = f.a.append('turn/start', {}); f.a.append('user/message', { id: 'host-message-1', source: { kind: 'user', rpcId: first.host!.requestId } });
  const replay = new Session(f.a.id); replay.events = JSON.parse(JSON.stringify(f.a.events)); f.sessions.set(f.a.id, replay);
  const fresh = new DshAdapter(f.ctx, f.runtime, 'fixture-host'); const rows = await fresh.rpc('amoji/history', { sessionId: f.a.id }, signal()) as HistoryEntry[];
  assert.equal(rows.length, 1); assert.deepEqual(rows[0]!.host, { status: 'observed', requestId: first.host!.requestId, hostMessageId: 'host-message-1', seq: turn.seq + 1, turnStartSeq: turn.seq });
  const binding = await f.client.bind({ host: 'dsh', sessionId: f.a.id });
  await assert.rejects(f.client.search(binding, '庆祝'), /TURN_REQUIRED/); await assert.rejects(f.client.emit(binding, 'forged'), /TURN_REQUIRED/); await f.client.unbind(binding);
  await assert.rejects(f.client.bind({ host: 'codex', sessionId: 'x' }), /真实回合/);
});

test('人类搜索 RPC 复用同一检索核心：真实会话、完整精确版本、严格边界且不创建回合', async t => {
  const f = await setup(t); f.turns.clear();
  const name = await f.adapter.rpc('amoji/search', { sessionId: f.a.id, query: '一起庆祝' }, signal()) as import('../src/sample-catalog.js').Expression[];
  const tag = await f.adapter.rpc('amoji/search', { sessionId: f.a.id, query: '自嘲', limit: 5 }, signal()) as import('../src/sample-catalog.js').Expression[];
  const semantics = await f.adapter.rpc('amoji/search', { sessionId: f.a.id, query: '支持你的努力', limit: 5 }, signal()) as import('../src/sample-catalog.js').Expression[];
  assert.equal(name[0]!.name, '一起庆祝'); assert.equal(tag[0]!.name, '挠头苦笑'); assert.equal(semantics[0]!.name, '一步一步来');
  assert.equal(name[0]!.revision_id, '30000000-0000-4000-8000-000000000001'); assert.ok(name[0]!.semantics.avoid_when?.includes('对方正在表达痛苦时'));
  assert.deepEqual(await f.adapter.rpc('amoji/search', { sessionId: f.a.id, query: '完全不存在', limit: 5 }, signal()), []);
  await assert.rejects(f.adapter.rpc('amoji/search', { sessionId: f.a.id, query: '   ' }, signal()), /1–240/);
  await assert.rejects(f.adapter.rpc('amoji/search', { sessionId: f.a.id, query: '😀'.repeat(241) }, signal()), /1–240/);
  await assert.rejects(f.adapter.rpc('amoji/search', { sessionId: f.a.id, query: '庆祝', limit: 6 }, signal()), /1–5/);
  await assert.rejects(f.adapter.rpc('amoji/search', { sessionId: 'unknown-session', query: '庆祝' }, signal()), /session not found/);
  assert.equal(f.a.events.length, 0); assert.equal(f.prompts.length, 0);
});

test('异步操作后取消或切换不改投其他会话；同回合多个工具共享 turn', async t => {
  const f = await setup(t); const original = f.runtime.search.bind(f.runtime);
  const controller = new AbortController(); const exec = f.exec(f.a); exec.signal = controller.signal;
  f.runtime.search = async (...args) => { const result = await original(...args); controller.abort(); return result; };
  await assert.rejects(f.call('amoji_search', { query: '庆祝' }, exec), /abort/i);
  f.runtime.search = async (...args) => { const result = await original(...args); exec.agent = { id: f.b.id, session: f.b }; return result; };
  const moved = f.exec(f.a); f.runtime.search = async (...args) => { const result = await original(...args); moved.agent = { id: f.b.id, session: f.b }; return result; };
  await assert.rejects(f.call('amoji_search', { query: '庆祝' }, moved), /DSH_CONTEXT_CHANGED/);
  assert.equal((await f.adapter.rpc('amoji/history', { sessionId: f.b.id }, signal()) as SampleMessage[]).length, 0);
});

test('打包 Host 入口真实加载、连接同一个服务并经 Connection RPC 调用', async t => {
  const f = await setup(t); f.tools.clear();
  const cleanups: Array<() => void | Promise<void>> = [];
  let handler: ((endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>) | undefined;
  f.ctx.effect = factory => { cleanups.push(factory()); };
  const routes = new Map<string, import('@deepseek-ai/dsh-client-connection').ConnectionFetchRoute>();
  f.ctx.connection.fetch.register = route => { routes.set(route.path, route); return async () => { routes.delete(route.path); }; };
  handler = async (endpoint, payload, signal) => (await (await routes.get(`/api/${endpoint}`)!.fetch(new Request(`http://localhost/api/${endpoint}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: 'test-rpc', method: endpoint, payload }), signal }))).json()).result;
  const entry = new URL('../.cache/dsh-source/host-entry.mjs', import.meta.url).href;
  const plugin = await import(entry) as { apply(ctx: HostPort): Promise<void>; inject: string[] };
  const previous = process.env.AMOJI_DATA_DIR; process.env.AMOJI_DATA_DIR = f.directory;
  try {
    await plugin.apply(f.ctx); assert.ok(plugin.inject.includes('connection')); assert.ok(f.tools.has('amoji_emit'));
    const result = await handler!('amoji/catalog', { sessionId: f.a.id }, signal()) as { ok: boolean; value: unknown[] }; assert.equal(result.ok, true); assert.equal(result.value.length, 3);
    const searched = await handler!('amoji/search', { sessionId: f.a.id, query: '自嘲', limit: 5 }, signal()) as { ok: boolean; value: Array<{ name: string }> }; assert.equal(searched.ok, true); assert.equal(searched.value[0]!.name, '挠头苦笑');
    const denied = await handler!('amoji/catalog', { sessionId: 'unknown-session' }, signal()) as { ok: boolean }; assert.equal(denied.ok, false);
  } finally {
    for (const close of cleanups.reverse()) await close();
    if (previous === undefined) delete process.env.AMOJI_DATA_DIR; else process.env.AMOJI_DATA_DIR = previous;
  }
});

test('打包dsh Host提供会话校验的创建面板入口，不增加模型工具且销毁时关闭面板', async t => {
  const f = await setup(t);
  const cleanups: Array<() => void | Promise<void>> = [];
  let handler: ((endpoint: string, payload: unknown, signal: AbortSignal) => Promise<any>) | undefined;
  f.ctx.effect = factory => { cleanups.push(factory()); };
  const routes = new Map<string, import('@deepseek-ai/dsh-client-connection').ConnectionFetchRoute>();
  f.ctx.connection.fetch.register = route => { routes.set(route.path, route); return async () => { routes.delete(route.path); }; };
  handler = async (endpoint, payload, signal) => (await (await routes.get(`/api/${endpoint}`)!.fetch(new Request(`http://localhost/api/${endpoint}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: 'test-rpc', method: endpoint, payload }), signal }))).json()).result;
  const plugin = await import(new URL('../.cache/dsh-source/host-entry.mjs', import.meta.url).href);
  const previous = process.env.AMOJI_DATA_DIR; process.env.AMOJI_DATA_DIR = f.directory;
  let origin: string | undefined;
  try {
    await plugin.apply(f.ctx);
    const info = JSON.parse(await readFile(new URL('../adapters/dsh/BUILD.json', import.meta.url), 'utf8'));
    assert.equal(info.serviceApi, f.client.identity.apiVersion); assert.equal(info.databaseVersion, f.client.identity.databaseVersion);
    assert.ok(info.providedManagementCapabilities.includes('create-drafts-v1'));
    assert.ok(info.providedManagementCapabilities.includes('text-suggestions-v1'));
    const denied = await handler!('amoji/manage', { sessionId: 'unknown-session' }, signal()); assert.equal(denied.ok, false);
    const result = await handler!('amoji/manage', { sessionId: f.a.id }, signal()); assert.equal(result.ok, true);
    const url = new URL(result.value.url); origin = url.origin;
    const headers = { Authorization: `Bearer ${url.hash.slice(1)}`, 'Content-Type': 'application/json' };
    const state = await (await fetch(`${origin}/api/state`, { headers })).json();
    assert.equal(state.host, 'dsh'); assert.equal(state.session_id, f.a.id); assert.equal(state.creation_available, true); assert.equal(state.suggestion_available, true);
    assert.match(await (await fetch(origin)).text(), /draft-form/);
    const draft = await (await fetch(`${origin}/api/draft/create`, { method: 'POST', headers, body: '{}' })).json();
    assert.equal((await f.client.getDraft(draft.draft_id)).draft_id, draft.draft_id);
    const sample = (await f.client.list())[0]!;
    const saved = await f.client.saveDraft(draft.draft_id, draft.version, { name: 'dsh新创建', semantics: { locale: 'zh-CN', meaning: '新创建的肯定', fallback: '肯定' }, rights: { license: '仅供个人使用' } }, (await readFile(await f.client.blobPath(sample.visual.primary.sha256))).toString('base64'));
    const created = await f.client.confirmDraft(saved.draft_id, saved.version);
    const found = JSON.parse((await f.call('amoji_search', { query: created.name }, f.exec(f.a)) as { text: string }).text);
    assert.equal(found.candidates[0].revision_id, created.revision_id);
    const emitted = await f.call('amoji_emit', { selection_token: found.candidates[0].selection_token }, f.exec(f.a)) as { text: string };
    assert.equal(JSON.parse(emitted.text).expression.revision_id, created.revision_id);
    assert.doesNotMatch(emitted.text, /visual|base64|data:image/);
    assert.deepEqual([...f.tools.keys()].sort(), ['amoji_emit', 'amoji_resolve', 'amoji_search']);
    assert.equal(f.prompts.length, 0);
  } finally {
    for (const close of cleanups.reverse()) await close();
    if (previous === undefined) delete process.env.AMOJI_DATA_DIR; else process.env.AMOJI_DATA_DIR = previous;
  }
  if (origin) await assert.rejects(fetch(origin));
});

test('没有持久化监听时拒绝用户投递，不把内存 append 当已保存', async t => {
  const f = await setup(t); f.ctx.sessions.flush = async () => false;
  const e = (await f.client.list())[0]!;
  await assert.rejects(f.adapter.rpc('amoji/submit', { sessionId: f.a.id, ref: { asset_id: e.asset_id, revision_id: e.revision_id }, requestId: 'no-persistence' }, signal()), /DSH_PERSISTENCE_UNAVAILABLE/);
  await assert.rejects(f.adapter.rpc('amoji/submit', { sessionId: f.a.id, ref: { asset_id: e.asset_id, revision_id: e.revision_id }, requestId: 'no-persistence' }, signal()), /DSH_PERSISTENCE_UNAVAILABLE/);
  assert.equal(f.prompts.length, 0);
});

test('三样本在不同真实回合使用同一核心精确版本，模型始终只有文字投影', async t => {
  const f = await setup(t); const catalog = await f.client.list();
  const multi = await f.call('amoji_search', { query: '时', limit: 3 }, f.exec(f.a, 'multi-search'));
  assert.equal(JSON.parse(f.tools.get('amoji_search')!.output.render({}, multi)[0]!.text).candidates.length, 3);
  for (const [index, expression] of catalog.entries()) {
    f.turns.set(f.a.id, 20 + index);
    const found = await f.call('amoji_search', { query: expression.name }, f.exec(f.a, `search-${index}`)) as { text: string };
    const candidate = JSON.parse(found.text).candidates[0];
    const result = await f.call('amoji_emit', { selection_token: candidate.selection_token }, f.exec(f.a, `emit-${index}`)) as { text: string; meta: { messageId: string; visualHash: string } };
    assert.equal(JSON.parse(result.text).expression.revision_id, expression.revision_id); assert.equal(result.meta.visualHash, expression.visual.primary.sha256);
    assert.ok(f.tools.get('amoji_emit')!.output.render({}, result).every(block => block.type === 'text'));
    assert.doesNotMatch(result.text, /base64|data:image|visual|sha256/);
  }
  assert.equal((await f.adapter.rpc('amoji/history', { sessionId: f.a.id }, signal()) as unknown[]).length, 3);
});

test('真实 defineTool 注册 resolve：精确版本纯文字、严格参数与可信上下文、无发送副作用', async t => {
  const f = await setup(t); assert.deepEqual([...f.tools.keys()].sort(), ['amoji_emit', 'amoji_resolve', 'amoji_search']);
  const e = (await f.client.list())[0]!; const ref = { asset_id: e.asset_id, revision_id: e.revision_id };
  const result = await f.call('amoji_resolve', ref, f.exec(f.a));
  const tool = f.tools.get('amoji_resolve')!; const content = tool.output.render(ref, result);
  assert.ok(content.every(block => block.type === 'text'));
  assert.deepEqual(JSON.parse(content[0]!.text).semantics, e.semantics); assert.equal(JSON.parse(content[0]!.text).revision_id, e.revision_id);
  assert.doesNotMatch(JSON.stringify(result), /visual|data:image|base64|sha256|message_id/); assert.equal(tool.output.presentationMeta, undefined);
  await assert.rejects(f.call('amoji_resolve', { ...ref, revision_id: 'unknown-version' }, f.exec(f.a)), /REVISION_NOT_FOUND/);
  await assert.rejects(f.call('amoji_resolve', { ...ref, asset_id: 'unknown-asset' }, f.exec(f.a)), /REVISION_NOT_FOUND/);
  await assert.rejects(f.call('amoji_resolve', { ...ref, sessionId: f.b.id }, f.exec(f.a)), /INVALID_ARGUMENT/);
  await assert.rejects(f.call('amoji_resolve', { asset_id: e.asset_id }, f.exec(f.a)), /invalid arguments/i);
  await assert.rejects(f.call('amoji_resolve', ref, { callId: 'x', signal: signal() }), /DSH_CONTEXT_UNAVAILABLE/);
  f.turns.clear(); await assert.rejects(f.call('amoji_resolve', ref, f.exec(f.a)), /DSH_TURN_UNAVAILABLE/);
  assert.deepEqual(await f.adapter.rpc('amoji/history', { sessionId: f.a.id }, signal()), []); assert.equal(f.a.events.length, 0); assert.equal(f.prompts.length, 0);
});

test('幂等 submit job 与各 RPC waiter 的取消独立；无人等待仍完成同一工作', async t => {
  const f = await setup(t); const e = (await f.client.list())[0]!; const ref = { asset_id: e.asset_id, revision_id: e.revision_id };
  for (const mode of ['second', 'first', 'all'] as const) {
    let release!: () => void; let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }); const started = new Promise<void>(resolve => { entered = resolve; });
    let calls = 0; let jobSignal: AbortSignal | undefined;
    f.ctx.sessionController.prompt = async (_request, internal) => { calls++; jobSignal = internal; entered(); await gate; internal.throwIfAborted(); return { accepted: true }; };
    const a = new AbortController(); const b = new AbortController();
    const request = { sessionId: f.a.id, ref, requestId: `waiters-${mode}` };
    const first = f.adapter.rpc('amoji/submit', request, a.signal); await started;
    const second = f.adapter.rpc('amoji/submit', request, b.signal);
    await new Promise(resolve => setTimeout(resolve, 10));
    const firstCancelled = mode !== 'second' ? assert.rejects(first, /first cancelled/) : undefined;
    const secondCancelled = mode !== 'first' ? assert.rejects(second, /second cancelled/) : undefined;
    if (mode !== 'second') a.abort(new Error('first cancelled'));
    if (mode !== 'first') b.abort(new Error('second cancelled'));
    // Cancellation must settle before the paused shared prompt is released.
    await Promise.race([Promise.all([firstCancelled, secondCancelled]), new Promise((_, reject) => setTimeout(() => reject(new Error('waiter did not cancel promptly')), 250))]);
    assert.equal(jobSignal!.aborted, false);
    const survivor = mode === 'all' ? f.adapter.rpc('amoji/submit', request, signal()) : mode === 'first' ? second : first;
    release(); const result = await survivor as HistoryEntry; assert.equal(result.host!.status, 'accepted'); assert.equal(calls, 1);
  }
});

test('共享 submit 生命周期：连接断开或 adapter 卸载中止工作，迟到 prompt 不落 accepted', async t => {
  for (const mode of ['connection', 'adapter'] as const) await t.test(mode, async t => {
    const f = await setup(t); const e = (await f.client.list())[0]!;
    let release!: () => void; let entered!: () => void; let internal: AbortSignal | undefined;
    const gate = new Promise<void>(resolve => { release = resolve; }); const started = new Promise<void>(resolve => { entered = resolve; });
    f.ctx.sessionController.prompt = async (_request, jobSignal) => { internal = jobSignal; entered(); await gate; return { accepted: true }; }; // Deliberately ignores cancellation.
    const request = { sessionId: f.a.id, ref: { asset_id: e.asset_id, revision_id: e.revision_id }, requestId: `lifecycle-${mode}` };
    const waiter = new AbortController(); const result = f.adapter.rpc('amoji/submit', request, waiter.signal);
    await started;
    const cancelled = assert.rejects(result, /waiter cancelled/); waiter.abort(new Error('waiter cancelled')); await cancelled;
    assert.equal(internal!.aborted, false, '只有 waiter 取消时工作仍可继续');
    try {
      if (mode === 'connection') await f.client.close();
      else for (const dispose of f.disposers.reverse()) await dispose();
      assert.equal(internal!.aborted, true, '连接或 adapter 生命周期必须传播给独立 job');
    } finally { release(); await new Promise(resolve => setTimeout(resolve, 20)); }
    const observer = await SharedClient.connect({ directory: f.directory });
    try {
      const binding = await observer.bind({ host: 'dsh', hostInstanceId: 'fixture-host', sessionId: f.a.id });
      const messages = await observer.history(binding);
      assert.equal(messages.length, 1);
      assert.equal(messages[0]!.dsh_submission, undefined, '迟到成功不能越过生命周期终止写共享 accepted');
      await observer.unbind(binding);
    } finally { await observer.close(); }
    assert.equal(f.a.events.some(event => event.type.startsWith('amoji/')), false, 'Session 不得出现自定义事件');
    await assert.rejects(f.adapter.rpc('amoji/submit', { ...request, requestId: 'after-lifecycle' }, signal()));
  });
});

test('真实 Session 零文字首发表情，经 flush 文件重建后 native rpcId 与共享消息关联', async t => {
  const { Session: NativeSession } = await import('@deepseek-ai/dsh-session');
  const { SessionId, SessionLogOffset } = await import('@deepseek-ai/dsh-session/types');
  const { validateStoredEvents } = await import('@deepseek-ai/dsh-session-persistence');
  const { writeFile } = await import('node:fs/promises');
  const f = await setup(t); const id = SessionId('native-first-amoji'); let session = NativeSession.create(id);
  const file = join(f.directory, 'native-session.json');
  f.ctx.sessions.get = key => key === id ? session : undefined;
  f.ctx.sessions.flush = async () => { await writeFile(file, JSON.stringify({ header: session.header, events: session.snapshotEvents() })); return true; };
  f.ctx.sessionController.resolveAgent = async () => ({ agent: { id, session } });
  f.ctx.sessionController.inspect = async () => ({ events: session.snapshotEvents() });
  f.ctx.sessionController.prompt = async request => {
    session.append('user/message', { role: 'user', id: 'native-user-message' as never, content: [...request.content], source: { kind: 'user', rpcId: request.requestId as never } }, { surfaceOp: 'append' });
    return { accepted: true };
  };
  assert.equal(session.snapshotEvents().length, 0);
  const e = (await f.client.list())[0]!;
  const result = await f.adapter.rpc('amoji/submit', { sessionId: id, requestId: 'first-expression', ref: { asset_id: e.asset_id, revision_id: e.revision_id } }, signal()) as HistoryEntry;
  assert.equal(result.host!.status, 'observed');
  assert.equal(session.snapshotEvents().some(e => e.type.startsWith('amoji/')), false);
  const stored = JSON.parse(await readFile(file, 'utf8'));
  session = NativeSession.fromRestore(id, validateStoredEvents(stored.header, stored.events), stored.header, SessionLogOffset(0), 'shared-frozen');
  const fresh = new DshAdapter(f.ctx, f.runtime, 'fixture-host');
  const rows = await fresh.rpc('amoji/history', { sessionId: id }, signal()) as HistoryEntry[];
  assert.equal(rows[0]!.host!.requestId, `amoji:${result.message.message_id}`);
  assert.equal(rows[0]!.host!.hostMessageId, 'native-user-message');
  assert.equal(rows[0]!.message.dsh_submission, 'accepted');
});

test('accepted 必须在 prompt 后 flush 成功，且共享回执拒绝跨会话/跨宿主/AI方向', async t => {
  const f = await setup(t); const e = (await f.client.list())[0]!;
  let flushes = 0; f.ctx.sessions.flush = async () => ++flushes === 1;
  await assert.rejects(f.adapter.rpc('amoji/submit', { sessionId: f.a.id, requestId: 'flush-failed', ref: { asset_id: e.asset_id, revision_id: e.revision_id } }, signal()), /DSH_PERSISTENCE_UNAVAILABLE/);
  assert.equal(f.prompts.length, 1);
  const [row] = await f.adapter.rpc('amoji/history', { sessionId: f.a.id }, signal()) as HistoryEntry[];
  assert.equal(row!.host!.status, 'prepared'); assert.equal(row!.message.dsh_submission, undefined);
  const other = await f.client.bind({ host: 'dsh', hostInstanceId: 'fixture-host', sessionId: f.b.id });
  await assert.rejects(f.client.dshAccepted(other, row!.message.message_id), /BINDING_MISMATCH/);
  const foreign = await f.client.bind({ host: 'codex', hostInstanceId: 'fixture-host', sessionId: f.a.id, turnId: 'turn' });
  await assert.rejects(f.client.dshAccepted(foreign, row!.message.message_id), /BINDING_MISMATCH/);
  const found = JSON.parse((await f.call('amoji_search', { query: e.name }, f.exec(f.a)) as { text: string }).text);
  const emitted = await f.call('amoji_emit', { selection_token: found.candidates[0].selection_token }, f.exec(f.a)) as { meta: { messageId: string } };
  const own = await f.client.bind({ host: 'dsh', hostInstanceId: 'fixture-host', sessionId: f.a.id });
  await assert.rejects(f.client.dshAccepted(own, emitted.meta.messageId), /BINDING_MISMATCH/);
});

test('真实 Connection 允许网关 /api interceptor 与 Amoji exact routes 共存、派发与卸载', async t => {
  const { Context } = await import('@deepseek-ai/cordis');
  const { HostConnectionService } = await import('@deepseek-ai/dsh-client-connection');
  const f = await setup(t); const context = new Context();
  const connection = new HostConnectionService(context, [], {} as never);
  const gateway = connection.rpc.intercept('/api', endpoint => endpoint === 'session/native', async () => ({ ok: true, value: 'native gateway' }));
  t.after(gateway);
  f.ctx.connection = connection as unknown as HostPort['connection'];
  const cleanup: Array<() => void | Promise<void>> = []; f.ctx.effect = factory => { cleanup.push(factory()); };
  installDsh(f.ctx, f.runtime, 'fixture-host', defineTool);
  const handler = connection.createSharedFetchHandler('/api');
  const call = (endpoint: string, payload: unknown, method = endpoint) => handler.fetch(new Request(`http://localhost/api/${endpoint}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: 'fixture-rpc', method, payload }) }));
  assert.equal((await (await call('session/native', {})).json()).result.value, 'native gateway');
  const catalog = await (await call('amoji/catalog', { sessionId: f.a.id })).json();
  assert.equal(catalog.type, 'server-response'); assert.equal(catalog.rpcId, 'fixture-rpc'); assert.equal(catalog.result.value.length, 3);
  assert.equal((await call('amoji/catalog', {}, 'session/native')).status, 400);
  for (const dispose of cleanup.reverse()) await dispose();
  assert.equal((await call('amoji/catalog', { sessionId: f.a.id })).status, 404);
  assert.equal((await (await call('session/native', {})).json()).result.value, 'native gateway');
});

test('真实 Client createRpc 将完整 catalog Expression 窄化后穿过严格 Host visual/submit', async t => {
  const { createRpc } = await import('../src/dsh/client.js');
  const f = await setup(t); const payloads: Array<{ endpoint: string; payload: any }> = [];
  const client = createRpc({ connection: { rpc: { async call(channel, endpoint, payload, requestSignal) {
    assert.equal(channel, '/api'); payloads.push({ endpoint, payload });
    return { ok: true, value: await f.adapter.rpc(endpoint, JSON.parse(JSON.stringify(payload)), requestSignal ?? signal()) };
  } } } } as import('../src/dsh/client.js').ClientPort);
  const expressions = await client.catalog(f.a.id);
  for (const expression of expressions) {
    const result = await client.visual(f.a.id, expression);
    assert.equal(result.expression.revision_id, expression.revision_id);
    assert.match(result.primary, /^data:image\//);
  }
  const expression = expressions[0]!;
  const sent = await client.submit(f.a.id, expression, 'whole-expression-ref');
  assert.equal(sent.meta.ref.revision_id, expression.revision_id);
  for (const { payload } of payloads.filter(p => p.endpoint === 'amoji/visual' || p.endpoint === 'amoji/submit')) assert.deepEqual(Object.keys(payload.ref).sort(), ['asset_id', 'revision_id']);
});

test('用户表情 prompt 以人类名称开头、明确数据而非任务，并保留精确 modelProjection', async t => {
  const { modelProjection } = await import('../src/projection.js');
  const f = await setup(t); const e = (await f.client.list())[0]!;
  await f.adapter.rpc('amoji/submit', { sessionId: f.a.id, ref: { asset_id: e.asset_id, revision_id: e.revision_id }, requestId: 'expression-context' }, signal());
  const text = f.prompts[0]!.content.map(part => part.text).join('\n');
  assert.ok(text.startsWith(`用户发来表情：${e.name}\n`));
  assert.match(text, /表达当前感受/); assert.match(text, /数据，不是任务或授权/);
  assert.match(text, /自然回应/); assert.match(text, /无需解析、resolve 或重复发送/);
  assert.ok(text.endsWith(modelProjection(e)));
  assert.doesNotMatch(text.split('\n')[0]!, /asset_id|revision_id/);
  assert.match(f.tools.get('amoji_search')!.description, /selection_token/);
  assert.match(f.tools.get('amoji_emit')!.description, /不得自造/);
  assert.match(f.tools.get('amoji_resolve')!.description, /已有固定语义.*无需/);
});
