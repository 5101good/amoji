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
import type { StoredMessage } from '../src/messages.js';
import { actAllows, humanSendable, type Expression } from '../src/protocol/index.js';
import { SEEDS } from './helpers/store-runtime.js';
import { fields } from './helpers/fixtures.js';
const toolModule = new URL('../.cache/dsh-source/tools.mjs', import.meta.url).href;
const { defineTool } = await import(toolModule) as { defineTool(options: ToolOptions): ToolOptions };
const signal = () => new AbortController().signal;
const parsed = (value: unknown) => JSON.parse((value as { text: string }).text);
const submit = (adapter: DshAdapter, sessionId: string, ref: { asset_id: string; revision_id: string }, requestId: string, s = signal()) => adapter.rpc('amoji/submit', { sessionId, input: { ref }, requestId }, s);

class Session implements DshSession {
  events: DshEvent[] = [];
  constructor(readonly id: string) {}
  snapshotEvents() { return this.events; }
  append(type: string, data: Record<string, unknown>) { const event = { type, seq: this.events.length, data: structuredClone(data) }; this.events.push(event); return event; }
}
async function setup(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'amoji-dsh-'));
  const service = await startSharedService(directory, SEEDS);
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
  const exec = (session: Session, callId = 'call-1'): DshExecution => {
    const seq = turns.get(session.id);
    if (seq !== undefined && !session.events.some(e => e.type === 'turn/start' && e.seq === seq)) {
      while (session.events.length < seq) session.append('fixture/padding', {});
      session.append('turn/start', {});
    }
    return { agent: { id: session.id, session }, callId, rootCallId: 'root-call', signal: signal() };
  };
  const call = (name: string, args: unknown, context: DshExecution) => tools.get(name)!.execute(args, context);
  return { directory, client, runtime, ctx, a, b, sessions, turns, tools, prompts, adapter, exec, call, disposers };
}

test('0.1.5-rc.2 defineTool 的真实入口：身份、回合、参数拒绝和双会话精确版本', async t => {
  const f = await setup(t);
  await assert.rejects(f.call('amoji_search', { query: '庆祝' }, { callId: 'x', signal: signal() }), /DSH_CONTEXT_UNAVAILABLE/);
  await assert.rejects(f.call('amoji_search', { query: '庆祝' }, f.exec(new Session(f.a.id))), /DSH_CONTEXT_UNAVAILABLE/);
  await assert.rejects(f.call('amoji_search', { query: '庆祝', sessionId: f.b.id }, f.exec(f.a)), /INVALID_ARGUMENT/);
  f.turns.delete(f.a.id); await assert.rejects(f.call('amoji_search', { query: '庆祝' }, f.exec(f.a)), /DSH_TURN_UNAVAILABLE/); f.turns.set(f.a.id, 7);
  const token = parsed(await f.call('amoji_search', { query: '庆祝' }, f.exec(f.a, 'search-call'))).candidates[0].selection_token;
  const foreign = parsed(await f.call('amoji_express', { selection_token: token }, f.exec(f.b)));
  assert.deepEqual([foreign.status, foreign.reason], ['rejected', 'invalid_selection_token'], '其他会话的凭据以原因码拒绝，不是工具错误');
  const emitted = await f.call('amoji_express', { selection_token: token }, f.exec(f.a, 'emit-call')) as { text: string; meta: { messageId: string; visualHash: string } };
  assert.equal(parsed(emitted).status, 'sent'); assert.equal(parsed(emitted).act, 'core:celebrate'); assert.doesNotMatch(emitted.text, /base64|visual|image\/|sha256/);
  const content = f.tools.get('amoji_express')!.output.render({}, emitted); assert.ok(content.every(b => b.type === 'text'));
  assert.deepEqual(f.tools.get('amoji_express')!.output.presentationMeta!({}, emitted), emitted.meta);
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
  const ref = { asset_id: expression.asset_id, revision_id: expression.revision_id };
  const first = await submit(f.adapter, f.a.id, ref, 'user-choice-1') as HistoryEntry;
  assert.equal(first.host!.status, 'accepted'); assert.equal(first.message.mode, 'turn', 'AI 空闲时宿主判定为普通回合');
  assert.equal(f.a.events.some(event => event.type.startsWith('amoji/')), false);
  const recovered = new DshAdapter(f.ctx, new ConnectedRuntime(f.client), 'fixture-host');
  assert.equal(((await recovered.rpc('amoji/history', { sessionId: f.a.id }, signal())) as HistoryEntry[])[0]!.host!.status, 'accepted');
  const again = await submit(f.adapter, f.a.id, ref, 'user-choice-1') as HistoryEntry; assert.equal(first.meta.messageId, again.meta.messageId);
  assert.equal(f.prompts[0]!.requestId, `amoji:${first.meta.messageId}`); assert.equal(f.prompts.length, 1, '已接受的原消息不再次调用宿主');
  assert.ok(f.prompts.every(p => p.sessionId === f.a.id && p.content.every(c => c.type === 'text'))); assert.doesNotMatch(JSON.stringify(f.prompts), /data:image|base64|visual/);
  await assert.rejects(submit(f.adapter, f.a.id, { asset_id: other.asset_id, revision_id: other.revision_id }, 'user-choice-1'), /REQUEST_CONFLICT/);
  const turn = f.a.append('turn/start', {}); f.a.append('user/message', { id: 'host-message-1', source: { kind: 'user', rpcId: first.host!.requestId } });
  const replay = new Session(f.a.id); replay.events = JSON.parse(JSON.stringify(f.a.events)); f.sessions.set(f.a.id, replay);
  const fresh = new DshAdapter(f.ctx, f.runtime, 'fixture-host'); const rows = await fresh.rpc('amoji/history', { sessionId: f.a.id }, signal()) as HistoryEntry[];
  assert.equal(rows.length, 1); assert.deepEqual(rows[0]!.host, { status: 'observed', requestId: first.host!.requestId, hostMessageId: 'host-message-1', seq: turn.seq + 1, turnStartSeq: turn.seq });
  // Human sends work for every host; AI tools still require a real turn at the service boundary.
  for (const host of ['dsh', 'codex', 'claude-code'] as const) {
    const idle = await f.client.bind({ host, sessionId: host === 'dsh' ? f.a.id : 'idle-session' });
    await assert.rejects(f.client.search(idle, '庆祝'), /TURN_REQUIRED/);
    await assert.rejects(f.client.express(idle, { act: 'core:ack' }), /TURN_REQUIRED/);
    await f.client.unbind(idle);
  }
});
test('人类搜索 RPC 复用同一检索核心：真实会话、完整精确版本、严格边界且不创建回合', async t => {
  const f = await setup(t); f.turns.clear();
  const search = (query: string, limit?: number) => f.adapter.rpc('amoji/search', { sessionId: f.a.id, query, ...(limit ? { limit } : {}) }, signal()) as Promise<Expression[]>;
  const name = await search('一起庆祝'); const partial = await search('苦笑', 5); const act = await search('core:stepwise', 5); const english = await search('thanks', 5);
  assert.equal(name[0]!.name['zh-CN'], '一起庆祝'); assert.equal(partial[0]!.name['zh-CN'], '挠头苦笑'); assert.equal(act[0]!.realizes, 'core:stepwise'); assert.equal(english[0]!.realizes, 'core:thanks', '任何语言都检索全部语言');
  const exact = (await f.client.list()).find(e => e.asset_id === name[0]!.asset_id)!; assert.deepEqual(name[0], exact, '返回完整精确版本');
  assert.deepEqual(await search('完全不存在', 5), []);
  await assert.rejects(search('   '), /1–240/);
  await assert.rejects(search('😀'.repeat(241)), /1–240/);
  await assert.rejects(search('庆祝', 6), /1–5/);
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
  assert.equal((await f.adapter.rpc('amoji/history', { sessionId: f.b.id }, signal()) as StoredMessage[]).length, 0);
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
  const previous = process.env.AMOJI_DATA_DIR; const previousDsh=process.env.DSH_HOME; process.env.DSH_HOME=join(f.directory,'dsh-profile'); process.env.AMOJI_DATA_DIR = f.directory;
  try {
    await plugin.apply(f.ctx); assert.ok(plugin.inject.includes('connection')); assert.ok(f.tools.has('amoji_express'));
    const result = await handler!('amoji/catalog', { sessionId: f.a.id }, signal()) as { ok: boolean; value: unknown[] }; assert.equal(result.ok, true); assert.equal(result.value.length, (await f.client.list()).filter(humanSendable).length);
    const searched = await handler!('amoji/search', { sessionId: f.a.id, query: '苦笑', limit: 5 }, signal()) as { ok: boolean; value: Expression[] }; assert.equal(searched.ok, true); assert.equal(searched.value[0]!.name['zh-CN'], '挠头苦笑');
    const denied = await handler!('amoji/catalog', { sessionId: 'unknown-session' }, signal()) as { ok: boolean }; assert.equal(denied.ok, false);
  } finally {
    for (const close of cleanups.reverse()) await close();
    if (previousDsh === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME=previousDsh;
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
  const previous = process.env.AMOJI_DATA_DIR; const previousDsh=process.env.DSH_HOME; process.env.DSH_HOME=join(f.directory,'dsh-profile'); process.env.AMOJI_DATA_DIR = f.directory;
  let origin: string | undefined;
  try {
    await plugin.apply(f.ctx);
    const info = JSON.parse(await readFile(new URL('../adapters/dsh/BUILD.json', import.meta.url), 'utf8'));
    assert.equal(info.serviceApi, f.client.identity.apiVersion); assert.equal(info.databaseVersion, f.client.identity.databaseVersion);
    assert.ok(info.providedManagementCapabilities.includes('create-drafts-v1'));
    assert.ok(info.providedManagementCapabilities.includes('text-suggestions-v1'));
    assert.ok(info.requiredCapabilities.includes('library-management-v1'));
    assert.ok(info.providedManagementCapabilities.includes('library-management-v1'));
    const packaged = await import(new URL('../adapters/dsh/runtime/src/library-store.js', import.meta.url).href);
    assert.equal(typeof packaged.LibraryStore.open, 'function');
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
    const saved = await f.client.saveDraft(draft.draft_id, draft.version, { ...fields, name: { 'zh-CN': 'dsh新创建', en: 'Created in dsh' } }, (await readFile(await f.client.blobPath(sample.visual.primary.sha256))).toString('base64'));
    const created = await f.client.confirmDraft(saved.draft_id, saved.version);
    const found = parsed(await f.call('amoji_search', { query: 'dsh新创建' }, f.exec(f.a)));
    assert.equal(found.candidates[0].revision_id, created.revision_id);
    const emitted = await f.call('amoji_express', { selection_token: found.candidates[0].selection_token }, f.exec(f.a)) as { text: string; meta: { ref: { revision_id: string } } };
    assert.equal(parsed(emitted).act, created.realizes); assert.equal(emitted.meta.ref.revision_id, created.revision_id);
    assert.doesNotMatch(emitted.text, /visual|base64|data:image/);
    assert.deepEqual([...f.tools.keys()].sort(), ['amoji_express', 'amoji_resolve', 'amoji_search']);
    assert.equal(f.prompts.length, 0);
  } finally {
    for (const close of cleanups.reverse()) await close();
    if (previousDsh === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME=previousDsh;
    if (previous === undefined) delete process.env.AMOJI_DATA_DIR; else process.env.AMOJI_DATA_DIR = previous;
  }
  if (origin) await assert.rejects(fetch(origin));
});

test('没有持久化监听时拒绝用户投递，不把内存 append 当已保存', async t => {
  const f = await setup(t); f.ctx.sessions.flush = async () => false;
  const e = (await f.client.list())[0]!;
  await assert.rejects(f.adapter.rpc('amoji/submit', { sessionId: f.a.id, input: { ref: { asset_id: e.asset_id, revision_id: e.revision_id } }, requestId: 'no-persistence' }, signal()), /DSH_PERSISTENCE_UNAVAILABLE/);
  await assert.rejects(f.adapter.rpc('amoji/submit', { sessionId: f.a.id, input: { ref: { asset_id: e.asset_id, revision_id: e.revision_id } }, requestId: 'no-persistence' }, signal()), /DSH_PERSISTENCE_UNAVAILABLE/);
  assert.equal(f.prompts.length, 0);
});

test('不同真实回合按精确版本发送，模型始终只有文字投影', async t => {
  const f = await setup(t); const catalog = await f.client.list();
  const multi = await f.call('amoji_search', { query: 'core', limit: 3 }, f.exec(f.a, 'multi-search'));
  assert.equal(JSON.parse(f.tools.get('amoji_search')!.output.render({}, multi)[0]!.text).candidates.length, 3);
  for (const [index, name] of ['准备好了', '一起庆祝', '暂时没把握'].entries()) {
    const expression = catalog.find(e => e.name['zh-CN'] === name)!;
    f.turns.set(f.a.id, 20 + index);
    const candidate = parsed(await f.call('amoji_search', { query: name }, f.exec(f.a, `search-${index}`))).candidates[0];
    const result = await f.call('amoji_express', { selection_token: candidate.selection_token }, f.exec(f.a, `emit-${index}`)) as { text: string; meta: { ref: { revision_id: string }; visualHash: string } };
    assert.equal(parsed(result).act, expression.realizes); assert.equal(result.meta.ref.revision_id, expression.revision_id); assert.equal(result.meta.visualHash, expression.visual.primary.sha256);
    assert.ok(f.tools.get('amoji_express')!.output.render({}, result).every(block => block.type === 'text'));
    assert.doesNotMatch(result.text, /base64|data:image|visual|sha256/);
  }
  assert.equal((await f.adapter.rpc('amoji/history', { sessionId: f.a.id }, signal()) as unknown[]).length, 3);
});

test('真实 defineTool 注册 resolve：精确版本纯文字、严格参数与可信上下文、无发送副作用', async t => {
  const f = await setup(t); assert.deepEqual([...f.tools.keys()].sort(), ['amoji_express', 'amoji_resolve', 'amoji_search']);
  const e = (await f.client.list())[0]!; const ref = { asset_id: e.asset_id, revision_id: e.revision_id };
  const result = await f.call('amoji_resolve', ref, f.exec(f.a));
  const tool = f.tools.get('amoji_resolve')!; const content = tool.output.render(ref, result);
  assert.ok(content.every(block => block.type === 'text'));
  assert.equal(JSON.parse(content[0]!.text).meaning, e.semantics[e.original_locale]!.meaning); assert.equal(JSON.parse(content[0]!.text).revision_id, e.revision_id);
  assert.doesNotMatch(JSON.stringify(result), /visual|data:image|base64|sha256|message_id/); assert.equal(tool.output.presentationMeta, undefined);
  await assert.rejects(f.call('amoji_resolve', { ...ref, revision_id: 'unknown-version' }, f.exec(f.a)), /REVISION_NOT_FOUND/);
  await assert.rejects(f.call('amoji_resolve', { ...ref, asset_id: 'unknown-asset' }, f.exec(f.a)), /REVISION_NOT_FOUND/);
  assert.deepEqual(parsed(await f.call('amoji_resolve', { message_id: 'missing' }, f.exec(f.a))), { error: 'message_not_found' });
  await assert.rejects(f.call('amoji_resolve', { ...ref, sessionId: f.b.id }, f.exec(f.a)), /INVALID_ARGUMENT/);
  assert.deepEqual(parsed(await f.call('amoji_resolve', { asset_id: e.asset_id }, f.exec(f.a))), { error: 'invalid_arguments' });
  await assert.rejects(f.call('amoji_resolve', ref, { callId: 'x', signal: signal() }), /DSH_CONTEXT_UNAVAILABLE/);
  f.turns.clear(); await assert.rejects(f.call('amoji_resolve', ref, f.exec(f.a)), /DSH_TURN_UNAVAILABLE/);
  assert.deepEqual(await f.adapter.rpc('amoji/history', { sessionId: f.a.id }, signal()), []); assert.equal(f.a.events.some(e => e.type.startsWith('amoji/')), false); assert.equal(f.prompts.length, 0);
});

test('幂等 submit job 与各 RPC waiter 的取消独立；无人等待仍完成同一工作', async t => {
  const f = await setup(t); const e = (await f.client.list())[0]!; const ref = { asset_id: e.asset_id, revision_id: e.revision_id };
  for (const mode of ['second', 'first', 'all'] as const) {
    let release!: () => void; let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }); const started = new Promise<void>(resolve => { entered = resolve; });
    let calls = 0; let jobSignal: AbortSignal | undefined;
    f.ctx.sessionController.prompt = async (_request, internal) => { calls++; jobSignal = internal; entered(); await gate; internal.throwIfAborted(); return { accepted: true }; };
    const a = new AbortController(); const b = new AbortController();
    const request = { sessionId: f.a.id, input: { ref }, requestId: `waiters-${mode}` };
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
    const request = { sessionId: f.a.id, input: { ref: { asset_id: e.asset_id, revision_id: e.revision_id } }, requestId: `lifecycle-${mode}` };
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
      assert.equal(messages[0]!.dsh_submission, 'attempted', '迟到成功不能越过生命周期终止写共享 accepted');
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
  const result = await f.adapter.rpc('amoji/submit', { sessionId: id, input: { ref: { asset_id: e.asset_id, revision_id: e.revision_id } }, requestId: 'first-expression' }, signal()) as HistoryEntry;
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
  await assert.rejects(f.adapter.rpc('amoji/submit', { sessionId: f.a.id, input: { ref: { asset_id: e.asset_id, revision_id: e.revision_id } }, requestId: 'flush-failed' }, signal()), /DSH_OUTCOME_UNKNOWN/);
  assert.equal(f.prompts.length, 1);
  const [row] = await f.adapter.rpc('amoji/history', { sessionId: f.a.id }, signal()) as HistoryEntry[];
  assert.equal(row!.host!.status, 'unknown'); assert.equal(row!.message.dsh_submission, 'attempted');
  const other = await f.client.bind({ host: 'dsh', hostInstanceId: 'fixture-host', sessionId: f.b.id });
  await assert.rejects(f.client.dshAccepted(other, row!.message.message_id), /BINDING_MISMATCH/);
  const foreign = await f.client.bind({ host: 'codex', hostInstanceId: 'fixture-host', sessionId: f.a.id, turnId: 'turn' });
  await assert.rejects(f.client.dshAccepted(foreign, row!.message.message_id), /BINDING_MISMATCH/);
  const emitted = await f.call('amoji_express', { act: 'core:working' }, f.exec(f.a)) as { meta: { messageId: string } };
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
  assert.equal(catalog.type, 'server-response'); assert.equal(catalog.rpcId, 'fixture-rpc'); assert.equal(catalog.result.value.length, (await f.client.list()).filter(humanSendable).length);
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
  f.turns.clear(); const sent = await client.submit(f.a.id, { ref: expression }, 'whole-expression-ref');
  assert.equal(sent.meta.ref!.revision_id, expression.revision_id);
  for (const { endpoint, payload } of payloads.filter(p => p.endpoint === 'amoji/visual' || p.endpoint === 'amoji/submit')) assert.deepEqual(Object.keys(endpoint === 'amoji/submit' ? payload.input.ref : payload.ref).sort(), ['asset_id', 'revision_id']);
});

test('用户表情 prompt 是固定声明加精确投影：数据而非指令，不含图片与内部引用', async t => {
  const { humanExpressionText, HUMAN_EXPRESSION_NOTICE } = await import('../src/projection.js');
  const f = await setup(t); f.turns.clear(); const e = (await f.client.list())[0]!;
  const row = await f.adapter.rpc('amoji/submit', { sessionId: f.a.id, input: { ref: { asset_id: e.asset_id, revision_id: e.revision_id }, note: '顺便看看测试' }, requestId: 'expression-context' }, signal()) as HistoryEntry;
  const text = f.prompts[0]!.content.map(part => part.text).join('\n');
  assert.equal(text, humanExpressionText(row.message)); assert.ok(text.startsWith(HUMAN_EXPRESSION_NOTICE));
  const projection = JSON.parse(text.slice(HUMAN_EXPRESSION_NOTICE.length + 1));
  assert.equal(projection.act, e.realizes); assert.equal(projection.note, '顺便看看测试'); assert.equal(projection.meaning, e.semantics[e.original_locale]!.meaning);
  assert.doesNotMatch(text, /asset_id|revision_id|sha256|base64/);
  assert.match(f.tools.get('amoji_search')!.description, /selection_token/);
  assert.match(f.tools.get('amoji_express')!.description, /不是授权/);
  assert.match(f.tools.get('amoji_resolve')!.description, /已附带语义时无需/);
});

test('dsh 每个回应窗口最多一条 AI 表情：拒绝是原因码，重开 Host 仍按原回合计数', async t => {
  const f = await setup(t);
  f.turns.set(f.a.id, f.a.append('turn/start', {}).seq);
  assert.equal(parsed(await f.call('amoji_express', { act: 'core:ready' }, f.exec(f.a))).status, 'sent');
  const limited = parsed(await f.call('amoji_express', { act: 'core:celebrate' }, f.exec(f.a)));
  assert.deepEqual([limited.status, limited.reason], ['rejected', 'rate_limited']);
  const reopened = new DshAdapter(f.ctx, new ConnectedRuntime(f.client), 'fixture-host');
  assert.equal(parsed(await reopened.tool('amoji_express').execute({ act: 'core:celebrate' }, f.exec(f.a))).reason, 'rate_limited');
  f.a.append('turn/end', {}); f.a.append('turn/start', {}); f.a.append('assistant/message', { content: '纯文字回应' }); f.a.append('turn/end', {});
  f.turns.set(f.a.id, f.a.append('turn/start', {}).seq);
  assert.equal(parsed(await reopened.tool('amoji_express').execute({ act: 'core:celebrate' }, f.exec(f.a))).status, 'sent', '新回应窗口重新计数');
  await assert.rejects(reopened.tool('amoji_express').execute({ act: 'core:celebrate', turnOrdinal: 99 }, f.exec(f.a)), /INVALID_ARGUMENT/);
  assert.equal((await f.adapter.rpc('amoji/history', { sessionId: f.a.id }, signal()) as unknown[]).length, 2);
});

test('真实 Session 冷恢复后按原生回合序号计算回应窗口', async t => {
  const { Session: NativeSession } = await import('@deepseek-ai/dsh-session');
  const { SessionId, SessionLogOffset } = await import('@deepseek-ai/dsh-session/types');
  const { validateStoredEvents } = await import('@deepseek-ai/dsh-session-persistence');
  const f = await setup(t); const id = SessionId('native-turn-policy'); let session = NativeSession.create(id);
  f.ctx.sessions.get = key => key === id ? session : undefined;
  f.ctx.sessionProjections.stateOf = () => ({ openTurnStartSeq: [...session.snapshotEvents()].reverse().find(e => e.type === 'turn/start')?.seq ?? null });
  const execution = (): DshExecution => ({ agent: { id, session }, callId: 'native-policy', signal: signal() });
  session.append('turn/start', { turn: 1 });
  assert.equal(parsed(await f.call('amoji_express', { act: 'core:ready' }, execution())).status, 'sent');
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } });
  const events = validateStoredEvents(session.header, JSON.parse(JSON.stringify(session.snapshotEvents())));
  session = NativeSession.fromRestore(id, events, session.header, SessionLogOffset(0), 'shared-frozen');
  session.append('turn/start', { turn: 2 });
  const fresh = new DshAdapter(f.ctx, f.runtime, 'fixture-host');
  assert.equal(parsed(await fresh.tool('amoji_express').execute({ act: 'core:ready' }, execution())).status, 'sent');
  assert.equal(parsed(await fresh.tool('amoji_express').execute({ act: 'core:ready' }, execution())).reason, 'rate_limited');
});

test('原生管理白名单经共享服务读版本、草稿与偏好，拒绝路径和未知会话', async t => {
  const f = await setup(t);
  const entries = await f.adapter.rpc('amoji/management', { sessionId: f.a.id, method: 'listEntries', args: {} }, signal()) as any[];
  assert.ok(entries.length);
  const versions = await f.adapter.rpc('amoji/management', { sessionId: f.a.id, method: 'listRevisions', args: { asset_id: entries[0].expression.asset_id } }, signal()) as any[];
  assert.equal(versions[0].revision_id, entries[0].expression.revision_id);
  const draft = await f.adapter.rpc('amoji/management', { sessionId: f.a.id, method: 'createDraft', args: {} }, signal()) as any;
  assert.equal(draft.version, 1);
  await assert.rejects(f.adapter.rpc('amoji/management', { sessionId: 'unknown', method: 'createDraft', args: {} }, signal()), /session not found/);
  await assert.rejects(f.adapter.rpc('amoji/management', { sessionId: f.a.id, method: 'blobPath', args: { path: '/tmp' } }, signal()), /INVALID_ARGUMENT/);
});

test('认证二进制完整包路由实际导出再导入，无路径与凭据泄漏并有界读取', async t => {
  const f=await setup(t); const {installPackRoutes,readBounded}=await import('../src/dsh/host-management.js');
  const routes=new Map<string,import('@deepseek-ai/dsh-client-connection').ConnectionFetchRoute>();
  const ctx={...f.ctx,connection:{fetch:{register(route:import('@deepseek-ai/dsh-client-connection').ConnectionFetchRoute){routes.set(route.path,route);return async()=>{};}}}};
  installPackRoutes(ctx,f.runtime,async(id,s)=>f.adapter.rpc('amoji/history',{sessionId:id},s));
  const entries=await f.client.listEntries();const entry=entries[0]!.expression;const ref={asset_id:entry.asset_id,revision_id:entry.revision_id};
  const exported=await routes.get('/api/amoji/pack-export')!.fetch(new Request('http://local/api/amoji/pack-export?sessionId=session-a',{method:'POST',body:JSON.stringify({refs:[ref],name:'测试包'})}));
  assert.equal(exported.status,200);assert.equal(exported.headers.get('content-type'),'application/zip');const bytes=await exported.arrayBuffer();assert.ok(bytes.byteLength>0);
  const imported=await routes.get('/api/amoji/pack-import')!.fetch(new Request('http://local/api/amoji/pack-import?sessionId=session-a',{method:'POST',body:bytes}));assert.equal(imported.status,200);const result=await imported.json();assert.equal(result.result.existing,1);assert.doesNotMatch(JSON.stringify(result),/secret|dataRoot|session-a/);
  const rejected=await routes.get('/api/amoji/pack-export')!.fetch(new Request('http://local/api/amoji/pack-export?sessionId=unknown',{method:'POST',body:'{}'}));assert.equal(rejected.status,400);
  await assert.rejects(readBounded(new Request('http://local',{method:'POST',body:'12345'}),4),/PACK_LIMIT_EXCEEDED/);
});

test('提交超时或断线重连后先核对原生消息，未知结果不盲目重发且不串会话', async t => {
  const f = await setup(t); const e = (await f.client.list())[0]!;
  const request = { sessionId: f.a.id, input: { ref: { asset_id: e.asset_id, revision_id: e.revision_id } }, requestId: 'uncertain' };
  let calls = 0;
  f.ctx.sessionController.prompt = async () => { calls++; throw new Error('transport ended after admission'); };
  await assert.rejects(f.adapter.rpc('amoji/submit', request, signal()), /DSH_OUTCOME_UNKNOWN/);
  const uncertain = await f.adapter.rpc('amoji/submit', request, signal()) as HistoryEntry;
  assert.equal(uncertain.host!.status, 'unknown'); assert.equal(calls, 1);
  assert.equal((await f.adapter.rpc('amoji/history', { sessionId: f.b.id }, signal()) as HistoryEntry[]).length, 0);
  f.a.append('user/message', { id: 'persisted-after-timeout', source: { kind: 'user', rpcId: uncertain.host!.requestId } });
  const reconciled = await f.adapter.rpc('amoji/submit', request, signal()) as HistoryEntry;
  assert.equal(reconciled.host!.status, 'observed'); assert.equal(reconciled.meta.messageId, uncertain.meta.messageId); assert.equal(calls, 1);
});

test('两个适配器争用同一请求只有一个原生 prompt，重连 RPC 可恢复同核心失效租约', async t => {
  const f = await setup(t); const e = (await f.client.list())[0]!;
  const request = { sessionId: f.a.id, input: { ref: { asset_id: e.asset_id, revision_id: e.revision_id } }, requestId: 'race' };
  const second = new DshAdapter(f.ctx, f.runtime, 'fixture-host');
  const rows = await Promise.all([f.adapter.rpc('amoji/submit', request, signal()), second.rpc('amoji/submit', request, signal())]) as HistoryEntry[];
  assert.equal(f.prompts.length, 1); assert.equal(rows[0]!.meta.messageId, rows[1]!.meta.messageId);
  let entered!: () => void; let release!: () => void;
  const ready = new Promise<void>(r => { entered = r; }); const gate = new Promise<void>(r => { release = r; });
  f.ctx.sessionController.prompt = async () => { entered(); await gate; return { accepted: true }; };
  const hangingRequest = { ...request, requestId: 'hanging' };
  const hanging = f.adapter.rpc('amoji/submit', hangingRequest, signal());
  const cancelled = assert.rejects(hanging, /CONNECTION_CLOSED/); await ready;
  t.after(release);
  // End only this connection via the authenticated public RPC (not the whole shared service).
  const d = JSON.parse(await readFile(join(f.directory, 'service.json'), 'utf8'));
  const originalFetch = globalThis.fetch; let lease: string | undefined;
  globalThis.fetch = async (input, init) => { if (String(input).endsWith('/rpc')) lease = (init!.headers as Record<string,string>)['x-amoji-connection']; return originalFetch(input, init); };
  try { await f.client.list(); } finally { globalThis.fetch = originalFetch; }
  await fetch(`${d.origin}/rpc`, { method: 'POST', headers: { Authorization: `Bearer ${d.secret}`, 'x-amoji-service': d.serviceId, 'x-amoji-connection': lease!, 'Content-Type':'application/json' }, body: JSON.stringify({ method:'close', params:{} }) });
  for (let i = 0; i < 30 && !f.client.signal.aborted; i++) await new Promise(r => setTimeout(r, 10));
  await assert.rejects(f.adapter.rpc('amoji/catalog', { sessionId: f.a.id }, signal()), /CONNECTION_CLOSED/);
  await f.adapter.rpc('amoji/reconnect', { sessionId: f.a.id }, signal());
  assert.equal((await f.adapter.rpc('amoji/catalog', { sessionId: f.a.id }, signal()) as unknown[]).length, (await f.client.list()).filter(humanSendable).length);
  const original = await f.adapter.rpc('amoji/submit', request, signal()) as HistoryEntry;
  assert.equal(original.meta.messageId, rows[0]!.meta.messageId); assert.equal(f.prompts.length, 1);
  await cancelled;
  const recovered = await Promise.race([f.adapter.rpc('amoji/submit', hangingRequest, signal()), new Promise(r => setTimeout(() => r('still waiting for old host'), 250))]);
  release();
  assert.notEqual(recovered, 'still waiting for old host', '重连核对不能继续等待已中止的旧宿主工作');
  assert.equal((recovered as HistoryEntry).host!.status, 'unknown');
});

test('AI建议RPC先核对会话，模型默认读取待用选择；生成不发聊天或修改库',async t=>{
 const f=await setup(t);let calls=0;
 f.ctx.sessionController.modelCatalog=async()=>({default:{provider:'p',model:'default'},routableProviders:['p'],groups:[],failures:[]});
 f.ctx.llm={listProviders:()=>[{id:'p',name:'P'}],listModels:async()=>[{provider:'p',id:'current',name:'Current'}],resolveModelInfo:async()=>({provider:'p',id:'current',name:'Current'}),async *stream(){calls++;yield{type:'text-delta',index:0,text:JSON.stringify({realizes:'core:thanks',name:'谢谢',meaning:'感谢对方的帮助',fallback:'谢谢',tags:['感谢']})};yield{type:'finish',reason:{kind:'stop'}};}};
 f.a.append('model/selection',{provider:'p',model:'current'});const adapter=new DshAdapter(f.ctx,f.runtime,'fixture-host');
 const before=await f.client.list();const events=f.a.snapshotEvents().length;
 const models=await adapter.rpc('amoji/management',{sessionId:f.a.id,method:'listSuggestionModels',args:{}},signal()) as any;
 assert.deepEqual(models.current,{provider:'p',model:'current'});
 const args={intent:'感谢对方帮助',provider:'p',model:'current'};
 await assert.rejects(adapter.rpc('amoji/management',{sessionId:'unknown',method:'suggestAiText',args},signal()),/session not found/);assert.equal(calls,0);
 const result=await adapter.rpc('amoji/management',{sessionId:f.a.id,method:'suggestAiText',args},signal()) as any;
 assert.equal(result.method,'dsh-llm-v1');assert.equal(calls,1);assert.equal(f.prompts.length,0);assert.equal(f.a.snapshotEvents().length,events);assert.deepEqual(await f.client.list(),before);
 const defaultModels=await adapter.rpc('amoji/management',{sessionId:f.b.id,method:'listSuggestionModels',args:{}},signal()) as any;assert.deepEqual(defaultModels.current,{provider:'p',model:'default'});
});
test('决策选择投递失败后可按原请求重试：已保存与已送达是两个状态', async t => {
  const f = await setup(t);
  const emitted = await f.call('amoji_express', { act: 'core:decide', options: [{ id: 'a', label: '方案甲' }, { id: 'b', label: '方案乙' }], rationale: '需要你定方向' }, f.exec(f.a, 'decide-call')) as { meta: { messageId: string } };
  const id = emitted.meta.messageId; const choose = (option: string) => f.adapter.rpc('amoji/choose', { sessionId: f.a.id, messageId: id, option }, signal()) as Promise<HistoryEntry[]>;
  const prompt = f.ctx.sessionController.prompt; let fail = true;
  f.ctx.sessionController.prompt = async (request, s) => { if (fail) { fail = false; throw new Error('host unavailable'); } return prompt(request, s); };
  await assert.rejects(choose('a'), /host unavailable/);
  const saved = (await f.adapter.rpc('amoji/history', { sessionId: f.a.id }, signal()) as HistoryEntry[]).find(r => r.message.message_id === id)!;
  assert.equal(saved.message.choice!.option, 'a'); assert.equal(saved.host!.status, 'prepared'); assert.equal(f.prompts.length, 0);
  await assert.rejects(choose('b'), /ALREADY_CHOSEN/);
  await choose('a');
  assert.equal(f.prompts.length, 1); assert.equal(f.prompts[0]!.requestId, `amoji-choice:${id}`); assert.match(f.prompts[0]!.content[0]!.text, /方案甲/);
  f.a.append('user/message', { id: 'host-choice', source: { kind: 'user', rpcId: `amoji-choice:${id}` } });
  const again = await choose('a'); assert.equal(f.prompts.length, 1, '已观察到就不再重发');
  assert.equal(again.find(r => r.message.message_id === id)!.host!.status, 'observed');
});
test('选择器目录与检索只给人能发送的表情', async t => {
  const f = await setup(t);
  const catalog = await f.adapter.rpc('amoji/catalog', { sessionId: f.a.id }, signal()) as Expression[];
  assert.ok(catalog.length > 0); assert.ok(catalog.every(e => actAllows(e.realizes, 'h2a') && (e.directions ?? ['h2a']).includes('h2a')));
  assert.ok((await f.runtime.catalog.all()).some(e => !actAllows(e.realizes, 'h2a')), '完整目录仍含只由 AI 发出的表情');
  const found = await f.adapter.rpc('amoji/search', { sessionId: f.a.id, query: 'core:ack', limit: 5 }, signal()) as Expression[];
  assert.ok(found.every(e => actAllows(e.realizes, 'h2a')));
});
test('撤回与同码位信号合并对模型可见：工作中立即告知，空闲时随下一条一起带上', async t => {
  const f = await setup(t);
  const send = (act: string, requestId: string) => f.adapter.rpc('amoji/submit', { sessionId: f.a.id, input: { act }, requestId }, signal()) as Promise<HistoryEntry>;
  const retract = (messageId: string) => f.adapter.rpc('amoji/retract', { sessionId: f.a.id, messageId }, signal());
  f.exec(f.a); // the AI is working: a turn is open
  const first = await send('core:clarify', 'r-1'); assert.equal(first.message.mode, 'backchannel');
  const second = await send('core:clarify', 'r-2');
  const history = await f.runtime.messages({ host: 'dsh', hostInstanceId: 'fixture-host', sessionId: f.a.id });
  assert.ok(history.find(m => m.message_id === first.message.message_id)!.retracted_at, '尚未送达的同码位信号只保留最新');
  const secondPrompt = f.prompts.find(p => p.requestId === `amoji:${second.message.message_id}`)!;
  assert.match(secondPrompt.content[0]!.text, /此前用户撤回了/); assert.match(secondPrompt.content[0]!.text, new RegExp(first.message.message_id));
  // Explicit retraction while the AI works reaches it at once.
  const third = await send('core:redirect', 'r-3');
  await retract(third.message.message_id);
  const told = f.prompts.find(p => p.requestId === `amoji-retract:${third.message.message_id}`)!;
  assert.match(told.content[0]!.text, /撤回/); assert.match(told.content[0]!.text, new RegExp(third.message.message_id));
  // Idle: no prompt of its own (it would start a turn); the record rides the next expression.
  f.turns.clear();
  const idle = await send('core:thanks', 'r-4'); const before = f.prompts.length;
  await retract(idle.message.message_id);
  assert.equal(f.prompts.length, before);
  const next = await send('core:ack', 'r-5');
  assert.match(f.prompts.find(p => p.requestId === `amoji:${next.message.message_id}`)!.content[0]!.text, new RegExp(`此前用户撤回了.*${idle.message.message_id}`));
});
