import { clientRequestSchema } from '@deepseek-ai/dsh-client-connection';
import type { JsonValue } from '@deepseek-ai/dsh-util-values';
import { PanelServer } from '../panel-server.js';
import { expressionMessageText } from './expression-message.js';
import { modelProjection } from '../projection.js';
import { searchExpressions } from '../search.js';
import { fail, nonempty, object, type BindingContext } from '../shared-contract.js';
import type { AdapterRuntime } from '../adapter-runtime.js';
import type { ExpressionRef } from '../sample-catalog.js';
import type { SampleMessage } from '../sample-runtime.js';
import type { DshEvent, DshExecution, DshSession, HostPort, HistoryEntry, ToolOptions, VisualMeta } from './contracts.js';

export function visualMeta(message: SampleMessage): VisualMeta {
  const e = message.revision;
  return { kind: 'amoji', messageId: message.message_id, ref: { asset_id: e.asset_id, revision_id: e.revision_id }, visualHash: e.visual.primary.sha256, posterHash: e.visual.poster?.sha256 ?? null, alt: e.semantics.fallback };
}
function refOf(value: unknown): ExpressionRef { const r = object(value, ['asset_id', 'revision_id']); return { asset_id: nonempty(r.asset_id), revision_id: nonempty(r.revision_id) }; }
function modelText(value: unknown): string {
  const text = record(value).text;
  if (typeof text !== 'string' || !text) fail('DSH_OUTPUT_INVALID', '工具缺少固定文字结果');
  return text;
}
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }

export class DshAdapter {
  private panel?: Promise<PanelServer>;
  private readonly pending = new Map<string, { ref: ExpressionRef; work: Promise<HistoryEntry> }>();
  private readonly lifecycle: AbortSignal;
  constructor(private readonly ctx: HostPort, private readonly runtime: AdapterRuntime, private readonly hostInstanceId: string) {
    nonempty(hostInstanceId);
    const disposed = new AbortController();
    this.lifecycle = AbortSignal.any([disposed.signal, ...(runtime.connectionSignal ? [runtime.connectionSignal] : [])]);
    ctx.effect(() => async () => { disposed.abort(new Error('DSH_ADAPTER_DISPOSED')); if (this.panel) await (await this.panel).close(); }, 'amoji: submission lifecycle');
  }
  private context(sessionId: string): BindingContext { return { host: 'dsh', hostInstanceId: this.hostInstanceId, sessionId }; }
  private capture(exec: DshExecution): { context: BindingContext; check(): void } {
    const agent = exec.agent;
    if (!agent || !agent.id || agent.session?.id !== agent.id || this.ctx.sessions.get(agent.id) !== agent.session) fail('DSH_CONTEXT_UNAVAILABLE', '缺少宿主登记的真实会话身份');
    nonempty(exec.callId); if (exec.rootCallId !== undefined) nonempty(exec.rootCallId);
    const session = agent.session; const sessionId = agent.id;
    const seq = this.ctx.sessionProjections.stateOf(session, 'turnBoundary')?.openTurnStartSeq;
    if (!Number.isSafeInteger(seq) || seq === null || seq === undefined || seq < 0) fail('DSH_TURN_UNAVAILABLE', '工具必须运行在真实开启的回合');
    const starts = session.snapshotEvents().filter(event => event.type === 'turn/start' && event.seq <= seq);
    if (!starts.some(event => event.seq === seq)) fail('DSH_TURN_UNAVAILABLE', '当前回合缺少原生事件，无法执行频率策略');
    const turnOrdinal = starts.length;
    const check = () => { exec.signal.throwIfAborted(); if (exec.agent !== agent || agent.id !== sessionId || agent.session !== session || this.ctx.sessions.get(sessionId) !== session || this.ctx.sessionProjections.stateOf(session, 'turnBoundary')?.openTurnStartSeq !== seq) fail('DSH_CONTEXT_CHANGED', '调用会话或回合已变化'); };
    check(); return { context: { ...this.context(sessionId), turnId: `turn:${seq}`, turnOrdinal }, check };
  }
  tool(name: 'amoji_search' | 'amoji_resolve' | 'amoji_emit'): ToolOptions {
    return { name, description: name === 'amoji_search' ? '仅在你想主动用表情回应时检索；返回候选固定语义及供 amoji_emit 使用的 selection_token。无合适候选就用文字，每回合最多发一个。' : name === 'amoji_resolve' ? '按 asset_id 和 revision_id 读取精确版本的固定文字语义，不发送消息。用户表达中已有固定语义时无需调用 resolve。' : '仅使用本回合 amoji_search 返回的 selection_token 发送合适表情，不得自造或猜测 token。收到用户表情无需重复发送；不合适或失败就用文字回应。模型只接收固定文字语义。',
      parameters: name === 'amoji_search' ? { query: { type: 'string', required: true }, limit: { type: 'integer' } } : name === 'amoji_resolve' ? { asset_id: { type: 'string', required: true }, revision_id: { type: 'string', required: true } } : { selection_token: { type: 'string', required: true } },
      output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: modelText(value) }], ...(name === 'amoji_emit' ? { presentationMeta: (_args: unknown, value: unknown) => record(value).meta as JsonValue } : {}) },
      execute: async (raw, exec): Promise<JsonValue> => {
        const frozen = this.capture(exec);
        const keys = name === 'amoji_search' ? ['query', 'limit'] : name === 'amoji_resolve' ? ['asset_id', 'revision_id'] : ['selection_token'];
        const args = object(raw, keys, name === 'amoji_search' ? ['query'] : keys);
        if (name === 'amoji_resolve') {
          const expression = await this.runtime.catalog.resolve(refOf(args)); frozen.check();
          return { text: modelProjection(expression) };
        }
        if (name === 'amoji_search') {
          const result = await this.runtime.search(frozen.context, nonempty(args.query), args.limit === undefined ? undefined : Number(args.limit)); frozen.check();
          return { text: JSON.stringify(result) };
        }
        frozen.check(); const message = await this.runtime.emit(frozen.context, nonempty(args.selection_token)); frozen.check();
        const meta = visualMeta(message);
        return { text: JSON.stringify({ message_id: message.message_id, expression: JSON.parse(modelProjection(message.revision)) }), meta };
      } };
  }
  private async flush(session: DshSession): Promise<void> {
    if (!await this.ctx.sessions.flush(session)) fail('DSH_PERSISTENCE_UNAVAILABLE', '宿主未启用会话持久化；无法确认记录保存');
  }
  private async inspect(sessionId: string, signal: AbortSignal): Promise<readonly DshEvent[]> { signal.throwIfAborted(); const result = await this.ctx.sessionController.inspect(sessionId, signal); signal.throwIfAborted(); return result.events; }
  private async session(sessionId: string, signal: AbortSignal): Promise<DshSession> {
    signal.throwIfAborted(); const result = await this.ctx.sessionController.resolveAgent(sessionId); signal.throwIfAborted();
    if ('error' in result) throw result.error;
    if (result.agent.id !== sessionId || result.agent.session.id !== sessionId) fail('DSH_CONTEXT_MISMATCH', '宿主解析了其他会话');
    return result.agent.session;
  }
  private async rows(sessionId: string, events: readonly DshEvent[]): Promise<HistoryEntry[]> {
    return (await this.runtime.messages(this.context(sessionId))).map(message => {
      if (message.direction !== 'human_to_ai') return { message, meta: visualMeta(message), host: null };
      const requestId = `amoji:${message.message_id}`;
      const user = events.find(e => e.type === 'user/message' && record(record(e.data).source).kind === 'user' && record(record(e.data).source).rpcId === requestId);
      const accepted = message.dsh_submission === 'accepted';
      const turn = user ? [...events].reverse().find(e => e.type === 'turn/start' && e.seq <= user.seq) : undefined;
      return { message, meta: visualMeta(message), host: { status: user ? 'observed' : accepted ? 'accepted' : 'prepared', requestId, ...(user ? { hostMessageId: nonempty(record(user.data).id), seq: user.seq } : {}), ...(turn ? { turnStartSeq: turn.seq } : {}) } };
    });
  }
  async rpc(endpoint: string, raw: unknown, signal: AbortSignal): Promise<unknown> {
    signal = AbortSignal.any([signal, this.lifecycle]);
    signal.throwIfAborted();
    const allowed: Record<string, string[]> = { manage: ['sessionId'], catalog: ['sessionId'], search: ['sessionId', 'query', 'limit'], history: ['sessionId'], visual: ['sessionId', 'ref', 'messageId'], submit: ['sessionId', 'ref', 'requestId'], display: ['sessionId', 'messageId', 'hash', 'state'] };
    const method = endpoint.replace(/^amoji\//, ''); const keys = allowed[method]; if (!keys) fail('INVALID_ARGUMENT', '未知 Amoji RPC');
    const required = method === 'visual' ? ['sessionId', 'ref'] : method === 'search' ? ['sessionId', 'query'] : keys;
    const args = object(raw, keys, required); const sessionId = nonempty(args.sessionId);
    const events = await this.inspect(sessionId, signal); const context = this.context(sessionId);
    if (method === 'manage') {
      if (!this.runtime.creation) fail('CAPABILITY_UNAVAILABLE', '当前共享服务不支持创建，请更新服务');
      const session = await this.session(sessionId, signal);
      this.panel ??= PanelServer.start(this.runtime, async () => {}).catch(error => { this.panel = undefined; throw error; });
      const panel = await this.panel;
      signal.throwIfAborted();
      if (this.ctx.sessions.get(sessionId) !== session) fail('DSH_CONTEXT_CHANGED', '创建面板的会话已变化');
      return { url: panel.url(context) };
    }
    if (method === 'catalog') return this.runtime.catalog.all();
    if (method === 'search') return searchExpressions(await this.runtime.catalog.all(), args.query as string, args.limit === undefined ? 3 : Number(args.limit));
    if (method === 'history') return this.rows(sessionId, events);
    if (method === 'visual') {
      const ref = refOf(args.ref); const expression = await this.runtime.catalog.resolve(ref);
      if (args.messageId !== undefined) {
        const message = (await this.runtime.messages(context)).find(m => m.message_id === args.messageId);
        if (!message || message.revision.asset_id !== ref.asset_id || message.revision.revision_id !== ref.revision_id) fail('BINDING_MISMATCH', '图片不属于此会话消息');
      } else if (!(await this.runtime.catalog.all()).some(e => e.asset_id === ref.asset_id && e.revision_id === ref.revision_id)) fail('REVISION_NOT_FOUND', '版本不在当前可选库中');
      if (!this.runtime.readBlob) fail('BLOB_UNAVAILABLE', '共享核心未提供素材读取');
      const data = async (blob: { sha256: string; mime: string }) => `data:${blob.mime};base64,${(await this.runtime.readBlob!(blob.sha256)).toString('base64')}`;
      const primary = await data(expression.visual.primary); const poster = expression.visual.poster ? await data(expression.visual.poster) : null; signal.throwIfAborted();
      return { expression, primary, poster };
    }
    if (method === 'display') {
      const messageId = nonempty(args.messageId); const message = (await this.runtime.messages(context)).find(m => m.message_id === messageId);
      if (!message || ![message.revision.visual.primary.sha256, message.revision.visual.poster?.sha256].includes(nonempty(args.hash))) fail('BINDING_MISMATCH', '显示回执不匹配消息素材');
      if (!['rendered', 'fallback', 'failed'].includes(String(args.state))) fail('INVALID_ARGUMENT', '显示状态不合法');
      signal.throwIfAborted();
      await this.runtime.acknowledge(context, messageId, args.state === 'rendered' ? 'rendered' : 'fallback');
      return null;
    }
    const requestId = nonempty(args.requestId); const ref = refOf(args.ref); const key = JSON.stringify([sessionId, requestId]);
    signal.throwIfAborted();
    let job = this.pending.get(key);
    if (job && (job.ref.asset_id !== ref.asset_id || job.ref.revision_id !== ref.revision_id)) fail('REQUEST_CONFLICT', '请求已绑定其他版本');
    if (!job) {
      // Once admitted, the idempotent job continues even with no UI waiters. A
      // browser disconnect cannot cancel another retry or erase its saved outcome.
      // Shared connection loss or adapter teardown still owns and cancels the job.
      const jobSignal = AbortSignal.any([AbortSignal.timeout(30000), this.lifecycle]);
      job = { ref, work: this.submit(sessionId, ref, requestId, jobSignal) };
      this.pending.set(key, job);
      const completed = () => { if (this.pending.get(key) === job) this.pending.delete(key); };
      void job.work.then(completed, completed);
    }
    return this.waitForSubmission(job.work, signal);
  }
  private waitForSubmission(work: Promise<HistoryEntry>, signal: AbortSignal): Promise<HistoryEntry> {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const cancelled = () => { signal.removeEventListener('abort', cancelled); reject(signal.reason); };
      signal.addEventListener('abort', cancelled, { once: true });
      void work.then(value => { signal.removeEventListener('abort', cancelled); if (!signal.aborted) resolve(value); }, error => { signal.removeEventListener('abort', cancelled); if (!signal.aborted) reject(error); });
    });
  }
  private async submit(sessionId: string, ref: ExpressionRef, requestId: string, signal: AbortSignal): Promise<HistoryEntry> {
    const session = await this.session(sessionId, signal); const context = this.context(sessionId);
    const message = await this.runtime.receive(context, ref, requestId); signal.throwIfAborted();
    const hostRequestId = `amoji:${message.message_id}`;
    await this.flush(session);
    signal.throwIfAborted();
    const result = await this.ctx.sessionController.prompt({ sessionId, requestId: hostRequestId, mode: 'queue', content: [{ type: 'text', text: expressionMessageText(message.revision) }] }, signal);
    signal.throwIfAborted();
    if (result.accepted !== true) fail('DSH_NOT_ACCEPTED', '宿主未接受输入');
    await this.flush(session);
    signal.throwIfAborted();
    if (!this.runtime.dshAccepted) fail('CAPABILITY_UNAVAILABLE', '共享服务不支持 dsh 投递回执');
    await this.runtime.dshAccepted(context, message.message_id); signal.throwIfAborted();
    const entry = (await this.rows(sessionId, session.snapshotEvents())).find(r => r.message.message_id === message.message_id)!;
    signal.throwIfAborted();
    return entry;
  }
}
export function installDsh(ctx: HostPort, runtime: AdapterRuntime, hostInstanceId: string, defineTool: (options: ToolOptions) => unknown): DshAdapter {
  const adapter = new DshAdapter(ctx, runtime, hostInstanceId);
  for (const name of ['amoji_search', 'amoji_resolve', 'amoji_emit'] as const) ctx.tools.register(defineTool(adapter.tool(name)));
  ctx.effect(() => {
    const releases: Array<() => Promise<void>> = [];
    const dispose = async () => { await Promise.all(releases.splice(0).reverse().map(async release => release())); };
    try {
      for (const method of ['catalog', 'search', 'history', 'visual', 'submit', 'display', 'manage']) {
        const endpoint = `amoji/${method}`;
        releases.push(ctx.connection.fetch.register({ path: `/api/${endpoint}`, methods: ['POST'], requestBody: 'buffered', fetch: async request => {
          if (request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') return new Response('content type must be application/json', { status: 415 });
          let body: unknown; try { body = await request.json(); } catch { return new Response('body is not JSON', { status: 400 }); }
          const parsed = clientRequestSchema.safeParse(body);
          if (!parsed.success || parsed.data.method !== endpoint) return new Response('invalid RPC envelope', { status: 400 });
          const message = parsed.data;
          let result: import('./contracts.js').RpcResult<unknown>;
          try { result = { ok: true, value: await adapter.rpc(endpoint, message.payload, request.signal) }; }
          catch (error) { result = { ok: false, error: { code: 'amoji/failed', message: error instanceof Error ? error.message : 'Amoji 操作失败', details: {} } }; }
          return Response.json({ type: 'server-response', rpcId: message.rpcId, result });
        } }));
      }
    } catch (error) { void dispose(); throw error; }
    return dispose;
  }, 'amoji: bounded human RPC routes');
  return adapter;
}
