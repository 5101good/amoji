import type {DshPublisher} from './publisher.js';
import { effectSelection, type EffectSelection } from '../effects.js';
import type { DshCollaboration } from './collaboration.js';
import { AiSuggestions, conversationModel } from './ai-suggestions.js';
import { clientRequestSchema } from '@deepseek-ai/dsh-client-connection';
import type { JsonValue } from '@deepseek-ai/dsh-util-values';
import { management, failure, installPackRoutes } from './host-management.js';
import { PanelServer } from '../panel-server.js';
import { expressionMessageText } from './expression-message.js';
import { choiceText } from '../projection.js';
import { searchExpressions } from '../search.js';
import { runModelTool, EXPRESS_DESCRIPTION } from '../model-tools.js';
import { actGloss, backchannelEligible, humanSendable, interruptEligible, type ExpressionRef, type Mode } from '../protocol/index.js';
import { fail, nonempty, object, type BindingContext } from '../shared-contract.js';
import type { AdapterRuntime } from '../adapter-runtime.js';
import type { ReceiveInput } from '../library-store.js';
import type { StoredMessage } from '../messages.js';
import type { DshEvent, DshExecution, DshSession, HostPort, HistoryEntry, PackSummary, SubmitInput, ToolOptions, VisualMeta } from './contracts.js';

export function visualMeta(message: StoredMessage): VisualMeta {
  const e = message.revision; const direction = message.from.role === 'human' ? 'h2a' : 'a2h';
  return { kind: 'amoji', messageId: message.message_id, act: message.act, direction, policy: message.glyph_policy,
    ref: e ? { asset_id: e.asset_id, revision_id: e.revision_id } : null, visualHash: e?.visual.primary.sha256 ?? null, posterHash: e?.visual.poster?.sha256 ?? null,
    alt: actGloss(message.act, direction).text };
}
function refOf(value: unknown): ExpressionRef { const r = object(value, ['asset_id', 'revision_id']); return { asset_id: nonempty(r.asset_id), revision_id: nonempty(r.revision_id) }; }
function modelText(value: unknown): string {
  const text = record(value).text;
  if (typeof text !== 'string' || !text) fail('DSH_OUTPUT_INVALID', '工具缺少固定文字结果');
  return text;
}
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function submitInput(value: unknown): SubmitInput {
  const v = object(value, ['ref', 'act', 'note', 'respondsTo', 'anchor', 'effect'], []);
  if (v.ref === undefined && v.act === undefined) fail('INVALID_ARGUMENT', '需要表情或码位');
  const anchor = v.anchor === undefined ? undefined : object(v.anchor, ['message_id', 'exact', 'prefix', 'suffix'], ['message_id']);
  return { ...(v.ref === undefined ? {} : { ref: refOf(v.ref) }), ...(v.act === undefined ? {} : { act: nonempty(v.act) }),
    ...(v.note === undefined || v.note === '' ? {} : { note: nonempty(v.note) }), ...(v.respondsTo === undefined ? {} : { respondsTo: nonempty(v.respondsTo) }),
    ...(anchor ? { anchor: { message_id: nonempty(anchor.message_id), ...(anchor.exact === undefined ? {} : { exact: nonempty(anchor.exact) }), ...(anchor.prefix === undefined ? {} : { prefix: String(anchor.prefix) }), ...(anchor.suffix === undefined ? {} : { suffix: String(anchor.suffix) }) } } : {}),
    ...(v.effect === undefined ? {} : { effect: effectSelection(v.effect) }) };
}
const sameInput = (a: SubmitInput, b: SubmitInput) => JSON.stringify(a) === JSON.stringify(b);

const TOOL_PARAMETERS: Record<'amoji_express' | 'amoji_search' | 'amoji_resolve', ToolOptions['parameters']> = {
  amoji_express: {
    act: { type: 'string', description: '注册表码位，如 core:uncertain；与 selection_token 二选一' },
    selection_token: { type: 'string', description: '本回合 amoji_search 返回的凭据' },
    intensity: { type: 'integer', enum: [1, 2, 3] },
    rationale: { type: 'string', description: '不超过 80 字，说明为什么发这个表情' },
    responds_to: { type: 'string' },
    replies: { type: 'array', items: { type: 'string' }, description: '最多 4 个人可发出的码位作为快捷回复' },
    options: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true }, label: { type: 'string', required: true } } }, description: 'core:decide 必填，2–6 个选项' },
  },
  amoji_search: { query: { type: 'string', required: true }, limit: { type: 'integer' } },
  amoji_resolve: { asset_id: { type: 'string' }, revision_id: { type: 'string' }, message_id: { type: 'string' } },
};
const TOOL_DESCRIPTIONS = {
  amoji_express: EXPRESS_DESCRIPTION,
  amoji_search: '只在需要指定角色或细腻语气时检索；查询可用任何语言。返回候选语义与供 amoji_express 使用的 selection_token。limit 1–5，默认 3。',
  amoji_resolve: '按 asset_id + revision_id 读取精确版本语义，或按 message_id 读取一条消息的投影；不发送。用户表情已附带语义时无需调用。',
};

export class DshAdapter {
  private readonly aiSuggestions: AiSuggestions;
  private panel?: Promise<PanelServer>;
  private readonly pending = new Map<string, { input: SubmitInput; work: Promise<HistoryEntry> }>();
  private readonly lifecycle: AbortSignal;
  constructor(private readonly ctx: HostPort, private readonly runtime: AdapterRuntime, private readonly hostInstanceId: string, private readonly collaboration?: DshCollaboration, private readonly publisher?: DshPublisher) {
    nonempty(hostInstanceId);
    this.aiSuggestions = new AiSuggestions(ctx.llm);
    const disposed = new AbortController();
    this.lifecycle = disposed.signal;
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
  tool(name: 'amoji_express' | 'amoji_search' | 'amoji_resolve'): ToolOptions {
    return { name, description: TOOL_DESCRIPTIONS[name], parameters: TOOL_PARAMETERS[name],
      output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: modelText(value) }], ...(name === 'amoji_express' ? { presentationMeta: (_args: unknown, value: unknown) => (record(value).meta ?? null) as JsonValue } : {}) },
      execute: async (raw, exec): Promise<JsonValue> => {
        const frozen = this.capture(exec);
        const args = object(raw, Object.keys(TOOL_PARAMETERS[name]), name === 'amoji_search' ? ['query'] : []);
        const run = await runModelTool(this.runtime, frozen.context, name, args); frozen.check();
        return { text: JSON.stringify(run.result), ...(run.message ? { meta: visualMeta(run.message) as unknown as JsonValue } : {}) };
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
  private openTurn(session: DshSession): number | undefined {
    const seq = this.ctx.sessionProjections.stateOf(session, 'turnBoundary')?.openTurnStartSeq;
    return Number.isSafeInteger(seq) && seq !== null && seq !== undefined && seq >= 0 ? seq : undefined;
  }
  private async rows(sessionId: string, events: readonly DshEvent[]): Promise<HistoryEntry[]> {
    const context = this.context(sessionId);
    const messages = await this.runtime.messages(context);
    if (this.collaboration && messages.some(m => m.effect_intent)) await this.session(sessionId, this.lifecycle);
    return Promise.all(messages.map(async message => {
      const effect = message.effect_intent ? (this.collaboration ? await this.collaboration.receipt(sessionId, message) : { status: 'unsupported' as const, reason: 'host-context-unavailable' }) : undefined;
      if (message.direction !== 'human_to_ai') {
        if (!message.choice) return { message, meta: visualMeta(message), host: null };
        const choiceId = `amoji-choice:${message.message_id}`;
        const answered = events.find(e => e.type.startsWith('user/') && record(record(e.data).source).rpcId === choiceId);
        return { message, meta: visualMeta(message), host: { status: answered ? 'observed' as const : 'prepared' as const, requestId: choiceId, ...(answered ? { hostMessageId: nonempty(record(answered.data).id), seq: answered.seq } : {}) } };
      }
      const requestId = `amoji:${message.message_id}`;
      const user = events.find(e => e.type.startsWith('user/') && record(record(e.data).source).rpcId === requestId);
      // A steering signal that the agent claimed during its turn reached the model there.
      if (user && message.signal === 'queued' && this.runtime.signalState) await Promise.resolve(this.runtime.signalState(context, message.message_id, 'delivered_to_model')).then(updated => { message.signal = updated.signal; }).catch(() => {});
      const accepted = message.dsh_submission === 'accepted';
      const turn = user ? [...events].reverse().find(e => e.type === 'turn/start' && e.seq <= user.seq) : undefined;
      return { ...(effect ? { effect } : {}), message, meta: visualMeta(message), host: { status: user ? 'observed' : accepted ? 'accepted' : message.dsh_submission === 'attempted' ? 'unknown' : 'prepared', requestId, ...(user ? { hostMessageId: nonempty(record(user.data).id), seq: user.seq } : {}), ...(turn ? { turnStartSeq: turn.seq } : {}) } };
    }));
  }
  private async packs(): Promise<PackSummary[]> {
    if (!this.runtime.packDrafts) return [];
    const available = new Set((await this.runtime.catalog.all()).map(e => e.asset_id));
    const latest = new Map<string, PackSummary>();
    for (const pack of await this.runtime.packDrafts.listPacks()) {
      const assets = pack.expressions.map(e => e.asset_id).filter(id => available.has(id));
      const current = latest.get(pack.pack_id);
      if (!assets.length || (current && current.version >= pack.version)) continue;
      latest.set(pack.pack_id, { pack_id: pack.pack_id, release_id: pack.release_id, version: pack.version, name: pack.name, original_locale: pack.original_locale, assets });
    }
    return [...latest.values()];
  }
  async rpc(endpoint: string, raw: unknown, signal: AbortSignal): Promise<unknown> {
    const reconnect = endpoint === 'amoji/reconnect';
    signal = AbortSignal.any([signal, this.lifecycle, ...(!reconnect && this.runtime.connectionSignal ? [this.runtime.connectionSignal] : [])]);
    signal.throwIfAborted();
    const allowed: Record<string, string[]> = { reconnect: ['sessionId'], management: ['sessionId', 'method', 'args'], manage: ['sessionId'], catalog: ['sessionId'], packs: ['sessionId'], search: ['sessionId', 'query', 'limit'], history: ['sessionId'], 'collaboration.rules': ['sessionId'], 'collaboration.enable': ['sessionId', 'selection', 'generation', 'replace'], 'collaboration.disable': ['sessionId', 'selection', 'generation'], 'collaboration.disableAll': ['sessionId', 'generation'], 'collaboration.capabilities': ['sessionId'], 'collaboration.receipts': ['sessionId'], visual: ['sessionId', 'ref', 'messageId'], effects: ['sessionId', 'ref'], submit: ['sessionId', 'input', 'requestId'], retract: ['sessionId', 'messageId'], choose: ['sessionId', 'messageId', 'option'], display: ['sessionId', 'messageId', 'hash', 'state'] };
    const method = endpoint.replace(/^amoji\//, ''); if (method.startsWith('marketplace.') || method.startsWith('publisher.')) allowed[method] = ['sessionId', 'args']; const keys = allowed[method]; if (!keys) fail('INVALID_ARGUMENT', '未知 Amoji RPC');
    const required = method === 'visual' ? ['sessionId', 'ref'] : method === 'search' ? ['sessionId', 'query'] : keys;
    const args = object(raw, keys, required); const sessionId = nonempty(args.sessionId);
    const events = await this.inspect(sessionId, signal); const context = this.context(sessionId);
    if (method.startsWith('publisher.')) { await this.session(sessionId, signal); if (!this.publisher) fail('CAPABILITY_UNAVAILABLE', '发布能力不可用'); return this.publisher.call(method.slice(10), args.args); }
    if (method.startsWith('marketplace.')) { await this.session(sessionId, signal); if (!this.runtime.marketplace) fail('CAPABILITY_UNAVAILABLE', '市场能力不可用'); return this.runtime.marketplace.marketplace(method.slice(12), args.args); }
    if (method === 'reconnect') {
      if (!this.runtime.reconnect) fail('CAPABILITY_UNAVAILABLE', '当前连接不支持恢复，请升级插件');
      await this.runtime.reconnect(); signal.throwIfAborted(); return null;
    }
    if (method === 'management') {
      const operation = nonempty(args.method);
      if (operation === 'listSuggestionModels') {
        object(args.args, []);
        const models = await this.aiSuggestions.models(signal);
        const current = conversationModel(events) ?? (await this.ctx.sessionController.modelCatalog?.())?.default ?? null;
        signal.throwIfAborted();
        return { models, current: current ? { provider: current.provider, model: current.model } : null };
      }
      if (operation === 'suggestAiText') return this.aiSuggestions.suggest(sessionId, args.args, signal);
      return management(this.runtime, operation, args.args);
    }
    if (method === 'manage') {
      if (!this.runtime.creation) fail('CAPABILITY_UNAVAILABLE', '当前共享服务不支持创建，请更新服务');
      const session = await this.session(sessionId, signal);
      this.panel ??= PanelServer.start(this.runtime, async () => {}).catch(error => { this.panel = undefined; throw error; });
      const panel = await this.panel;
      signal.throwIfAborted();
      if (this.ctx.sessions.get(sessionId) !== session) fail('DSH_CONTEXT_CHANGED', '创建面板的会话已变化');
      return { url: panel.url(context) };
    }
    if (['collaboration.rules', 'collaboration.enable', 'collaboration.disable', 'collaboration.disableAll'].includes(method)) {
      if (!this.collaboration) return method === 'collaboration.rules' ? { generation: 0, rules: [], choices: [], identity: 'pending' } : fail('CAPABILITY_UNAVAILABLE', '当前宿主身份待恢复');
      await this.session(sessionId, signal);
      if (method === 'collaboration.rules') return this.collaboration.rules(sessionId);
      if (!Number.isSafeInteger(args.generation) || Number(args.generation) < 0) fail('INVALID_ARGUMENT', '无效规则 generation');
      return this.collaboration.change(sessionId, { kind: method.slice('collaboration.'.length) as 'enable' | 'disable' | 'disableAll', generation: Number(args.generation), ...(args.selection ? { selection: effectSelection(args.selection) } : {}), ...(args.replace ? { replace: effectSelection(args.replace) } : { replace: null }) });
    }
    if (method === 'collaboration.capabilities') return { supported: !!this.collaboration && !!this.runtime.collaboration, scopes: ['turn', 'conversation'], reason: this.collaboration && this.runtime.collaboration ? null : 'host-context-unavailable' };
    if (method === 'collaboration.receipts') return (await this.rows(sessionId, events)).filter(row => row.effect);
    if (method === 'effects') {
      if (!this.runtime.collaboration || !this.collaboration) fail('CAPABILITY_UNAVAILABLE', '当前宿主不支持协作效果，可明确选择仅发送');
      return this.runtime.collaboration.choices(context, refOf(args.ref));
    }
    if (method === 'catalog') return (await this.runtime.catalog.all()).filter(humanSendable);
    if (method === 'packs') return this.packs();
    if (method === 'search') return searchExpressions((await this.runtime.catalog.all()).filter(humanSendable), args.query as string, args.limit === undefined ? 3 : Number(args.limit));
    if (method === 'history') return this.rows(sessionId, events);
    if (method === 'retract') {
      if (!this.runtime.retract) fail('CAPABILITY_UNAVAILABLE', '当前服务不支持撤回');
      await this.runtime.retract(context, nonempty(args.messageId)); return this.rows(sessionId, events);
    }
    if (method === 'choose') return this.choose(sessionId, nonempty(args.messageId), nonempty(args.option), signal);
    if (method === 'visual') {
      const ref = refOf(args.ref); const expression = await this.runtime.catalog.resolve(ref);
      if (args.messageId !== undefined) {
        const message = (await this.runtime.messages(context)).find(m => m.message_id === args.messageId);
        if (!message?.revision || message.revision.asset_id !== ref.asset_id || message.revision.revision_id !== ref.revision_id) fail('BINDING_MISMATCH', '图片不属于此会话消息');
      } else if (!(await this.runtime.catalog.all()).some(e => e.asset_id === ref.asset_id && e.revision_id === ref.revision_id)) fail('REVISION_NOT_FOUND', '版本不在当前可选库中');
      if (!this.runtime.readBlob) fail('BLOB_UNAVAILABLE', '共享核心未提供素材读取');
      const data = async (blob: { sha256: string; mime: string }) => `data:${blob.mime};base64,${(await this.runtime.readBlob!(blob.sha256)).toString('base64')}`;
      const primary = await data(expression.visual.primary); const poster = expression.visual.poster ? await data(expression.visual.poster) : null; signal.throwIfAborted();
      return { expression, primary, poster };
    }
    if (method === 'display') {
      const messageId = nonempty(args.messageId); const message = (await this.runtime.messages(context)).find(m => m.message_id === messageId);
      if (!message || (message.revision ? ![message.revision.visual.primary.sha256, message.revision.visual.poster?.sha256].includes(nonempty(args.hash)) : args.hash !== 'text')) fail('BINDING_MISMATCH', '显示回执不匹配消息素材');
      if (!['rendered', 'fallback', 'failed'].includes(String(args.state))) fail('INVALID_ARGUMENT', '显示状态不合法');
      signal.throwIfAborted();
      await this.runtime.acknowledge(context, messageId, args.state === 'rendered' ? 'rendered' : 'fallback');
      return null;
    }
    const input = submitInput(args.input);
    if (input.effect && (!this.collaboration || !this.runtime.collaboration)) fail('CAPABILITY_UNAVAILABLE', '当前宿主不支持协作效果，可明确选择仅发送');
    const requestId = nonempty(args.requestId); const key = JSON.stringify([sessionId, requestId]);
    signal.throwIfAborted();
    let job = this.pending.get(key);
    if (job && !sameInput(job.input, input)) fail('REQUEST_CONFLICT', '请求已绑定其他表情');
    if (!job) {
      // Once admitted, the idempotent job continues even with no UI waiters. A
      // browser disconnect cannot cancel another retry or erase its saved outcome.
      // Shared connection loss or adapter teardown still owns and cancels the job.
      const jobSignal = AbortSignal.any([AbortSignal.timeout(30000), this.lifecycle, ...(this.runtime.connectionSignal ? [this.runtime.connectionSignal] : [])]);
      const bounded = this.waitForSubmission(this.submit(sessionId, input, requestId, jobSignal), jobSignal).catch(error => {
        if (error instanceof Error && error.name === 'TimeoutError') fail('DSH_OUTCOME_UNKNOWN', '宿主响应超时，投递结果尚待核对；请保留原选择核对原会话。');
        throw error;
      });
      job = { input, work: bounded };
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
  /** Answer a decision once; the answer reaches the model as the user's words, never as an approval. */
  private async choose(sessionId: string, messageId: string, option: string, signal: AbortSignal): Promise<HistoryEntry[]> {
    if (!this.runtime.choose) fail('CAPABILITY_UNAVAILABLE', '当前服务不支持决策作答');
    const session = await this.session(sessionId, signal); const context = this.context(sessionId);
    // The saved choice and its delivery to the model are separate facts: a retry of the same
    // option re-sends under the same request id until the host shows the user message.
    const message = await this.runtime.choose(context, messageId, option);
    const requestId = `amoji-choice:${messageId}`;
    if (!(await this.inspect(sessionId, signal)).some(e => e.type.startsWith('user/') && record(record(e.data).source).rpcId === requestId)) {
      const text = choiceText(message);
      await this.ctx.sessionController.prompt({ sessionId, requestId, mode: this.openTurn(session) === undefined ? 'queue' : 'steer', content: [{ type: 'text', text }] }, signal);
      await this.flush(session);
    }
    return this.rows(sessionId, await this.inspect(sessionId, signal));
  }
  private async submit(sessionId: string, input: SubmitInput, requestId: string, signal: AbortSignal): Promise<HistoryEntry> {
    const session = await this.session(sessionId, signal); const context = this.context(sessionId);
    // The host, not the person, decides the mode from whether the AI is working (RFC §8.3).
    const open = this.openTurn(session);
    const act = input.act ?? (input.ref ? (await this.runtime.catalog.resolve(input.ref)).realizes : '');
    const mode: Mode = open === undefined ? 'turn' : interruptEligible(act) ? 'interrupt' : backchannelEligible(act) ? 'backchannel' : 'turn';
    if (input.effect && mode !== 'turn') fail('EFFECT_UNAVAILABLE', 'AI 工作时不能附带协作效果，可仅发送表情');
    if (input.effect) {
      const existing = (await this.runtime.messages(context)).find(m => m.effect_intent?.requestId === requestId);
      if (!existing) {
        await this.collaboration!.rules(sessionId);
        const choice = (await this.runtime.collaboration!.choices(context, input.ref!)).find(c => JSON.stringify(c.selection) === JSON.stringify(input.effect));
        if (!choice) fail('EFFECT_UNAVAILABLE', '此精确效果不可用于所选表情');
        this.collaboration!.validate(sessionId, choice, input.ref!);
      }
    }
    const receive: ReceiveInput = { ...(input.ref ? { ref: input.ref } : { act }), ...(input.note ? { note: input.note } : {}), ...(input.anchor ? { anchor: input.anchor } : {}),
      ...(input.respondsTo ? { responds_to: input.respondsTo } : {}), ...(input.effect ? { effect: input.effect as EffectSelection } : {}), mode, ...(open !== undefined && mode !== 'turn' ? { sent_during: `turn:${open}` } : {}) };
    const message = await this.runtime.receive(context, receive, requestId); signal.throwIfAborted();
    const row = async () => (await this.rows(sessionId, await this.inspect(sessionId, signal))).find(r => r.message.message_id === message.message_id)!;
    const existing = await row();
    if (existing.host!.status !== 'prepared' || (message.effect_intent?.checkpoint && existing.effect?.status === 'unknown')) return existing;
    await this.flush(session); signal.throwIfAborted();
    if (message.effect_intent) await this.collaboration!.prepare(sessionId, message);
    if (!this.runtime.dshAttempted || !this.runtime.dshAccepted) fail('CAPABILITY_UNAVAILABLE', '共享服务不支持可靠投递，请升级服务后重新连接');
    // The single writer claims dispatch before crossing the host boundary. Any
    // later uncertainty is reconciled by native rpcId, never by another prompt.
    try {
      if (!await this.runtime.dshAttempted(context, message.message_id)) return row();
      signal.throwIfAborted();
      if (message.mode === 'interrupt') {
        // Stop and hold both end the active turn; the record reaches the model with the next turn.
        if (!this.ctx.sessionController.cancel) fail('CAPABILITY_UNAVAILABLE', '宿主不支持停止当前回合，请使用原生停止按钮');
        await this.ctx.sessionController.cancel({ sessionId }, signal);
        await this.runtime.applied?.(context, message.message_id);
      } else {
        if (message.effect_intent) this.collaboration!.dispatched(sessionId, message);
        const history = await this.runtime.messages(context);
        const result = await this.ctx.sessionController.prompt({ sessionId, requestId: `amoji:${message.message_id}`, mode: message.mode === 'backchannel' ? 'steer' : 'queue', content: [{ type: 'text', text: expressionMessageText(message, history) }] }, signal);
        signal.throwIfAborted();
        if (result.accepted !== true) fail('DSH_NOT_ACCEPTED', '宿主未接受输入');
        // A signal that missed its turn starts the next one: it was promoted, never dropped.
        if (message.mode === 'backchannel' && this.openTurn(session) !== open) await this.runtime.signalState?.(context, message.message_id, 'promoted');
      }
      await this.flush(session); signal.throwIfAborted();
      await this.runtime.dshAccepted(context, message.message_id); signal.throwIfAborted();
      return row();
    } catch {
      if (message.effect_intent) this.collaboration!.uncertain(sessionId, message);
      fail('DSH_OUTCOME_UNKNOWN', '投递结果尚待核对。请重新连接并核对原会话；不要重新选择或另发一次。');
    }
  }
}
export function installDsh(ctx: HostPort, runtime: AdapterRuntime, hostInstanceId: string, defineTool: (options: ToolOptions) => unknown, collaboration?: DshCollaboration, publisher?: DshPublisher): DshAdapter {
  const adapter = new DshAdapter(ctx, runtime, hostInstanceId, collaboration, publisher);
  for (const name of ['amoji_express', 'amoji_search', 'amoji_resolve'] as const) ctx.tools.register(defineTool(adapter.tool(name)));
  ctx.effect(() => {
    const releases: Array<() => Promise<void>> = [];
    const dispose = async () => { await Promise.all(releases.splice(0).reverse().map(async release => release())); };
    try {
      releases.push(...installPackRoutes(ctx, runtime, (id, signal) => adapter.rpc('amoji/history', { sessionId: id }, signal)));
      for (const method of [...['beginLogin', 'loginStatus', 'cancelLogin', 'logout', 'drafts', 'create', 'save', 'upload', 'submit', 'retrySubmit', 'reconcile', 'submissions', 'withdraw'].map(m => 'publisher.' + m), ...['search', 'detail', 'install', 'installStatus', 'collect', 'uncollect', 'remove', 'updateCheck', 'local', 'visual', 'refreshRevocations'].map(m => 'marketplace.' + m), 'reconnect', 'catalog', 'packs', 'search', 'history', 'visual', 'collaboration.rules', 'collaboration.enable', 'collaboration.disable', 'collaboration.disableAll', 'collaboration.capabilities', 'collaboration.receipts', 'effects', 'submit', 'retract', 'choose', 'display', 'manage', 'management']) {
        const endpoint = `amoji/${method}`;
        releases.push(ctx.connection.fetch.register({ path: `/api/${endpoint}`, methods: ['POST'], requestBody: 'buffered', fetch: async request => {
          if (request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') return new Response('content type must be application/json', { status: 415 });
          let body: unknown; try { body = await request.json(); } catch { return new Response('body is not JSON', { status: 400 }); }
          const parsed = clientRequestSchema.safeParse(body);
          if (!parsed.success || parsed.data.method !== endpoint) return new Response('invalid RPC envelope', { status: 400 });
          const message = parsed.data;
          let result: import('./contracts.js').RpcResult<unknown>;
          try { result = { ok: true, value: await adapter.rpc(endpoint, message.payload, request.signal) }; }
          catch (error) { result = { ok: false, error: failure(error) }; }
          return Response.json({ type: 'server-response', rpcId: message.rpcId, result });
        } }));
      }
    } catch (error) { void dispose(); throw error; }
    return dispose;
  }, 'amoji: bounded human RPC routes');
  return adapter;
}
