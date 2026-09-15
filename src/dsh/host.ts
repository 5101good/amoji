import { modelProjection } from '../projection.js';
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
  private readonly pending = new Map<string, Promise<HistoryEntry>>();
  constructor(private readonly ctx: HostPort, private readonly runtime: AdapterRuntime, private readonly hostInstanceId: string) { nonempty(hostInstanceId); }
  private context(sessionId: string): BindingContext { return { host: 'dsh', hostInstanceId: this.hostInstanceId, sessionId }; }
  private capture(exec: DshExecution): { context: BindingContext; check(): void } {
    const agent = exec.agent;
    if (!agent || !agent.id || agent.session?.id !== agent.id || this.ctx.sessions.get(agent.id) !== agent.session) fail('DSH_CONTEXT_UNAVAILABLE', '缺少宿主登记的真实会话身份');
    nonempty(exec.callId); if (exec.rootCallId !== undefined) nonempty(exec.rootCallId);
    const session = agent.session; const sessionId = agent.id;
    const seq = this.ctx.sessionProjections.stateOf(session, 'turnBoundary')?.openTurnStartSeq;
    if (!Number.isSafeInteger(seq) || seq === null || seq === undefined || seq < 0) fail('DSH_TURN_UNAVAILABLE', '工具必须运行在真实开启的回合');
    const check = () => { exec.signal.throwIfAborted(); if (exec.agent !== agent || agent.id !== sessionId || agent.session !== session || this.ctx.sessions.get(sessionId) !== session || this.ctx.sessionProjections.stateOf(session, 'turnBoundary')?.openTurnStartSeq !== seq) fail('DSH_CONTEXT_CHANGED', '调用会话或回合已变化'); };
    check(); return { context: { ...this.context(sessionId), turnId: `turn:${seq}` }, check };
  }
  tool(name: 'amoji_search' | 'amoji_emit'): ToolOptions {
    return { name, description: name === 'amoji_search' ? '按固定文字语义检索 Amoji。每回合最多发送一个。' : '将已选精确版本展示给当前会话的人类；模型只接收固定文字语义。',
      parameters: name === 'amoji_search' ? { query: { type: 'string', required: true }, limit: { type: 'integer' } } : { selection_token: { type: 'string', required: true } },
      output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: modelText(value) }], ...(name === 'amoji_emit' ? { presentationMeta: (_args: unknown, value: unknown) => record(value).meta } : {}) },
      execute: async (raw, exec) => {
        const frozen = this.capture(exec);
        const args = object(raw, name === 'amoji_search' ? ['query', 'limit'] : ['selection_token'], name === 'amoji_search' ? ['query'] : ['selection_token']);
        if (name === 'amoji_search') {
          const result = await this.runtime.search(frozen.context, nonempty(args.query), args.limit === undefined ? undefined : Number(args.limit)); frozen.check();
          return { text: JSON.stringify(result) };
        }
        frozen.check(); const message = await this.runtime.emit(frozen.context, nonempty(args.selection_token)); frozen.check();
        const meta = visualMeta(message);
        // Non-surface durable association; no media enters model history.
        exec.agent!.session.append('amoji/tool', { messageId: message.message_id, callId: exec.callId, rootCallId: exec.rootCallId ?? exec.callId, turnId: frozen.context.turnId! });
        await this.flush(exec.agent!.session); frozen.check();
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
      const prepared = events.find(e => e.type === 'amoji/submission' && record(e.data).messageId === message.message_id);
      if (!prepared) return { message, meta: visualMeta(message), host: null };
      const requestId = nonempty(record(prepared.data).requestId);
      const user = events.find(e => e.type === 'user/message' && record(record(e.data).source).rpcId === requestId);
      const accepted = events.some(e => e.type === 'amoji/accepted' && record(e.data).requestId === requestId);
      const turn = user ? [...events].reverse().find(e => e.type === 'turn/start' && e.seq <= user.seq) : undefined;
      return { message, meta: visualMeta(message), host: { status: user ? 'observed' : accepted ? 'accepted' : 'prepared', requestId, ...(user ? { hostMessageId: nonempty(record(user.data).id), seq: user.seq } : {}), ...(turn ? { turnStartSeq: turn.seq } : {}) } };
    });
  }
  async rpc(endpoint: string, raw: unknown, signal: AbortSignal): Promise<unknown> {
    const allowed: Record<string, string[]> = { catalog: ['sessionId'], history: ['sessionId'], visual: ['sessionId', 'ref', 'messageId'], submit: ['sessionId', 'ref', 'requestId'], display: ['sessionId', 'messageId', 'hash', 'state'] };
    const method = endpoint.replace(/^amoji\//, ''); const keys = allowed[method]; if (!keys) fail('INVALID_ARGUMENT', '未知 Amoji RPC');
    const args = object(raw, keys, method === 'visual' ? ['sessionId', 'ref'] : keys); const sessionId = nonempty(args.sessionId);
    const events = await this.inspect(sessionId, signal); const context = this.context(sessionId);
    if (method === 'catalog') return this.runtime.catalog.all();
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
      const session = await this.session(sessionId, signal); signal.throwIfAborted();
      session.append('amoji/display', { messageId, hash: args.hash, state: args.state });
      await this.runtime.acknowledge(context, messageId, args.state === 'rendered' ? 'rendered' : 'fallback');
      await this.flush(session); return null;
    }
    const requestId = nonempty(args.requestId); const ref = refOf(args.ref); const key = JSON.stringify([sessionId, requestId]);
    const pending = this.pending.get(key);
    if (pending) { const result = await pending; if (result.message.revision.asset_id !== ref.asset_id || result.message.revision.revision_id !== ref.revision_id) fail('REQUEST_CONFLICT', '请求已绑定其他版本'); return result; }
    const work = this.submit(sessionId, ref, requestId, signal); this.pending.set(key, work);
    try { return await work; } finally { this.pending.delete(key); }
  }
  private async submit(sessionId: string, ref: ExpressionRef, requestId: string, signal: AbortSignal): Promise<HistoryEntry> {
    const session = await this.session(sessionId, signal); const context = this.context(sessionId);
    const message = await this.runtime.receive(context, ref, requestId); signal.throwIfAborted();
    const hostRequestId = `amoji:${message.message_id}`;
    if (!session.snapshotEvents().some(e => e.type === 'amoji/submission' && record(e.data).requestId === hostRequestId)) {
      session.append('amoji/submission', { requestId: hostRequestId, messageId: message.message_id, ref });
    }
    await this.flush(session);
    signal.throwIfAborted();
    const result = await this.ctx.sessionController.prompt({ sessionId, requestId: hostRequestId, mode: 'queue', content: [{ type: 'text', text: modelProjection(message.revision) }] }, signal);
    if (result.accepted !== true) fail('DSH_NOT_ACCEPTED', '宿主未接受输入');
    if (!session.snapshotEvents().some(e => e.type === 'amoji/accepted' && record(e.data).requestId === hostRequestId)) session.append('amoji/accepted', { requestId: hostRequestId, messageId: message.message_id });
    await this.flush(session);
    return (await this.rows(sessionId, session.snapshotEvents())).find(r => r.message.message_id === message.message_id)!;
  }
}
export function installDsh(ctx: HostPort, runtime: AdapterRuntime, hostInstanceId: string, defineTool: (options: ToolOptions) => unknown): DshAdapter {
  const adapter = new DshAdapter(ctx, runtime, hostInstanceId);
  for (const name of ['amoji_search', 'amoji_emit'] as const) ctx.tools.register(defineTool(adapter.tool(name)));
  ctx.effect(() => ctx.connection.rpc.intercept('/api', endpoint => /^amoji\/(catalog|history|visual|submit|display)$/.test(endpoint), async (endpoint, payload, signal) => {
    try { return { ok: true, value: await adapter.rpc(endpoint, payload, signal) }; }
    catch (error) { return { ok: false, error: { code: 'amoji/failed', message: error instanceof Error ? error.message : 'Amoji 操作失败', details: {} } }; }
  }), 'amoji: bounded human RPC');
  return adapter;
}
