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
    connection: { rpc: { intercept: () => async () => {} } },
    effect(factory) { disposers.push(factory()); },
  };
  installDsh(ctx, runtime, 'fixture-host', defineTool);
  const adapter = new DshAdapter(ctx, runtime, 'fixture-host');
  const exec = (session: Session, callId = 'call-1'): DshExecution => ({ agent: { id: session.id, session }, callId, rootCallId: 'root-call', signal: signal() });
  const call = (name: string, args: unknown, context: DshExecution) => tools.get(name)!.execute(args, context);
  return { directory, client, runtime, ctx, a, b, sessions, turns, tools, prompts, adapter, exec, call, disposers };
}

test('固定源码 defineTool 的真实入口：身份、回合、参数拒绝和双会话精确版本', async t => {
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
  assert.equal(f.a.events.at(-1)!.type, 'amoji/display');
});

test('idle submission 不造 turn；幂等 requestId、纯文字 prompt 与持久记录恢复', async t => {
  const f = await setup(t); f.turns.clear(); const [expression, other] = await f.client.list(); assert.ok(expression && other);
  const ref = { asset_id: expression.asset_id, revision_id: expression.revision_id }; const request = { sessionId: f.a.id, ref, requestId: 'user-choice-1' };
  const first = await f.adapter.rpc('amoji/submit', request, signal()) as HistoryEntry;
  assert.equal(first.host!.status, 'accepted'); assert.equal(first.message.delivery, 'pending');
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
  f.ctx.connection.rpc.intercept = (channel, match, callback) => { assert.equal(channel, '/api'); assert.equal(match('amoji/submit'), true); assert.equal(match('arbitrary/write'), false); handler = callback; return async () => { handler = undefined; }; };
  const entry = new URL('../.cache/dsh-source/host-entry.mjs', import.meta.url).href;
  const plugin = await import(entry) as { apply(ctx: HostPort): Promise<void>; inject: string[] };
  const previous = process.env.AMOJI_DATA_DIR; process.env.AMOJI_DATA_DIR = f.directory;
  try {
    await plugin.apply(f.ctx); assert.ok(plugin.inject.includes('connection')); assert.ok(f.tools.has('amoji_emit'));
    const result = await handler!('amoji/catalog', { sessionId: f.a.id }, signal()) as { ok: boolean; value: unknown[] }; assert.equal(result.ok, true); assert.equal(result.value.length, 3);
    const denied = await handler!('amoji/catalog', { sessionId: 'unknown-session' }, signal()) as { ok: boolean }; assert.equal(denied.ok, false);
  } finally {
    for (const close of cleanups.reverse()) await close();
    if (previous === undefined) delete process.env.AMOJI_DATA_DIR; else process.env.AMOJI_DATA_DIR = previous;
  }
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
  const multi = await f.call('amoji_search', { query: 'zh-CN', limit: 3 }, f.exec(f.a, 'multi-search'));
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
    assert.equal(f.a.events.some(event => event.type === 'amoji/accepted'), false, '迟到成功不能越过生命周期终止写 accepted');
    await assert.rejects(f.adapter.rpc('amoji/submit', { ...request, requestId: 'after-lifecycle' }, signal()));
  });
});
