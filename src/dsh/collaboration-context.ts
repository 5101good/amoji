import { createHash } from 'node:crypto';
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm';
import { joinContextSections } from '@deepseek-ai/dsh-system-prompt';
import type { SessionEvent } from '@deepseek-ai/dsh-session';

export const COLLABORATION_CONTEXT = 'amoji:collaboration';
const VARIABLE = 'amoji_collaboration_text';
export type CollaborationRule = { id: string; revision: string } & (
  { template: 'response-organization@1'; config: { layout: 'answer-first' | 'concise' | 'example-first' } } |
  { template: 'completion-self-check@1'; config: { evidence: 'required'; unknowns: 'explicit' } }
);
export interface CollaborationInstruction { id: string; revision: string; instruction: string; conflictGroup: 'explanation' | 'response-organization' | 'completion-report' | 'handoff' }
export interface CollaborationReceipt { status: 'prepared' | 'bound' | 'attached' | 'cancelled' | 'unknown' | 'failed' | 'unsupported'; turnStartSeq?: number; snapshotSeq?: number; digest?: string; reason?: string }
interface Intent { action: CollaborationInstruction; status: CollaborationReceipt['status']; turn?: number }
export interface CollaborationCheckpoint { version: 1; profile: string; session: string; createdAt: number; anchor?: { seq: number; digest: string }; rules: CollaborationRule[]; intents: [string, Intent][] }
interface State { rules: CollaborationRule[]; intents: Map<string, Intent>; claimed: boolean; turn?: number; text?: string; generation: number; failure?: string }
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const openTurn = (agent: Agent): number | undefined => {
  for (const event of agent.session.snapshotEvents().toReversed()) {
    if (event.type === 'turn/end') return undefined;
    if (event.type === 'turn/start') return event.seq;
  }
};
function section(event: SessionEvent): string | undefined {
  if (event.type !== 'user/message') return;
  const source = event.data.source;
  if (source.kind !== 'plugin' || !('sections' in source)) return;
  return source.sections?.find(s => s.name === COLLABORATION_CONTEXT)?.text;
}
function envelope(profile: string, session: string, turn: number, rules: CollaborationRule[], intent?: CollaborationInstruction): string {
  const active = rules.filter(r => !intent || (r.template === 'response-organization@1' ? 'response-organization' : 'completion-report') !== intent.conflictGroup);
  const content = active.map(rule => ({ ...rule, guidance: rule.template === 'response-organization@1'
    ? ({ 'answer-first': '先回答结论，再给依据。Answer first, then give supporting detail.', concise: '简洁作答，保留必要信息。Be concise without omitting necessary information.', 'example-first': '先给具体示例，再解释。Give a concrete example before explanation.' }[rule.config.layout])
    : '完成前检查已有证据；明确未验证和未知项。Before reporting completion, inspect available evidence and state unverified or unknown items.' }));
  const text = JSON.stringify({ schema: 'amoji.collaboration/1', scope: { profile, session, turnStartSeq: turn }, priority: '用户明确文本和宿主更高优先级规则优先。这些是用户约定而非强制执行。Explicit user instructions and higher-priority host rules prevail; these are guidance, not enforcement.', rules: content, instruction: intent ?? null, ...(content.length || intent ? {} : { state: '此前 Amoji 约定已停用。Previous Amoji conventions are disabled.' }) });
  if (Buffer.byteLength(text) > 8192) throw new Error('Collaboration context exceeds 8 KiB');
  return text;
}

/** A non-driving adapter: only native inbox claims and admitted snapshots establish attachment. */
export class CollaborationContext {
  private readonly states = new WeakMap<Agent, State>();
  private readonly disposers: (() => unknown)[] = [];
  constructor(private readonly ctx: Context, readonly hostInstanceId: string) {
    this.disposers.push(ctx.on('agent/session-start', ({ agent, source }) => { if (source === 'clear') this.forget(agent); }));
    this.disposers.push(ctx.on('agent/inbox/claimed', ({ agent, message }) => {
      const state = this.valid(agent); if (!state) return;
      state.claimed = true;
      if (message.source.kind !== 'user' || !('rpcId' in message.source)) return;
      const intent = state.intents.get(String(message.source.rpcId));
      if (!intent || intent.status !== 'prepared') return;
      const turn = openTurn(agent); if (turn === undefined) return;
      intent.status = 'bound'; intent.turn = turn;
    }));
    this.disposers.push(ctx.on('agent/inbox/discarded', ({ agent, message }) => {
      if (message.source.kind !== 'user' || !('rpcId' in message.source)) return;
      const intent = this.valid(agent)?.intents.get(String(message.source.rpcId));
      if (intent && intent.status === 'prepared') intent.status = 'cancelled';
    }));
    this.disposers.push(ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
      const assembly = await next();
      const agent = context.agent;
      if (!agent || context.scope !== agent || context.signal?.aborted) return assembly;
      const state = this.valid(agent); const turn = openTurn(agent);
      if (!state || turn === undefined) return assembly;
      if (assembly.contexts.some(c => c.name === COLLABORATION_CONTEXT) || Object.hasOwn(assembly.variables, VARIABLE)) {
        state.failure = 'context-name-collision'; return assembly;
      }
      const events = agent.session.snapshotEvents();
      const lastAssistant = events.findLast(e => e.type === 'assistant/message');
      const toolContinuation = lastAssistant?.type === 'assistant/message' && lastAssistant.seq > turn && lastAssistant.data.message.content.some(b => b.type === 'tool-call') && events.findLast(e => e.type === 'turn/start')?.seq === turn;
      const hasWork = state.claimed || toolContinuation;
      // Never manufacture a different snapshot during a completion-only assembly.
      if (hasWork) {
        const intent = [...state.intents.values()].find(i => i.turn === turn && (i.status === 'bound' || i.status === 'attached'));
        if (state.rules.length || intent || state.text) {
          try { state.text = envelope(this.hostInstanceId, agent.id, turn, state.rules, intent?.action); state.failure = undefined; }
          catch { state.failure = 'context-budget'; return assembly; }
        }
        state.turn = turn;
      }
      state.claimed = false;
      if (!state.text) return assembly;
      assembly.contexts.push({ name: COLLABORATION_CONTEXT, text: `{{${VARIABLE}}}` });
      assembly.variables[VARIABLE] = state.text;
      return assembly;
    }));
    // Outermost cooperative waterfall: validate the downstream decision before admission.
    // Only our exact named section may be edited; another plugin's input is preserved.
    this.disposers.push(ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
      const decision = await next();
      const state = this.valid(agent); const turn = openTurn(agent);
      if (decision.kind !== 'enter' || !state || turn === undefined || signal.aborted || !state.text || state.failure) return decision;
      const native = agent.session.snapshotEvents().filter(e => e.seq > turn && e.type === 'user/message').map(e => (e as Extract<SessionEvent, { type: 'user/message' }>).data);
      const users = [...native, ...decision.messages].filter(m => m.source.kind === 'user');
      const entries = [...state.intents.entries()].filter(([, i]) => i.turn === turn && i.status === 'bound');
      const missing = entries.filter(([rpcId]) => !users.some(m => 'rpcId' in m.source && m.source.rpcId === rpcId));
      if (users.length && !missing.length) return decision;
      for (const [, intent] of missing) intent.status = 'failed';
      const previous = state.text;
      const remaining = entries.find(([rpcId]) => users.some(m => 'rpcId' in m.source && m.source.rpcId === rpcId))?.[1].action;
      state.text = users.length && (state.rules.length || remaining) ? envelope(this.hostInstanceId, agent.id, turn, state.rules, remaining) : undefined;
      const messages: UserMessage[] = [];
      for (const message of decision.messages) {
        const source = message.source;
        if (source.kind !== 'plugin' || !('sections' in source) || !source.sections?.some(c => c.name === COLLABORATION_CONTEXT && c.text === previous)) { messages.push(message); continue; }
        const sections = source.sections.flatMap(c => c.name !== COLLABORATION_CONTEXT ? [c] : state.text ? [{ ...c, text: state.text }] : []);
        const originalText = joinContextSections(source.sections);
        const content = message.content.flatMap(block => block.type === 'text' && block.text === originalText ? (sections.length ? [{ ...block, text: joinContextSections(sections) }] : []) : [block]);
        if (content.length) messages.push(createUserMessage({ content, source: { ...source, sections } }));
      }
      return { ...decision, messages };
    }, { prepend: true }));
  }
  private valid(agent: Agent): State | undefined { return this.ctx.agents.get(agent.id) === agent ? this.states.get(agent) : undefined; }
  /** Called only after the host has established an exact profile/session identity, or explicit new user opt-in. */
  authorize(agent: Agent): void {
    if (this.ctx.agents.get(agent.id) !== agent) throw new Error('Unknown live session');
    if (!this.states.has(agent)) this.states.set(agent, { rules: [], intents: new Map(), claimed: false, generation: 0 });
  }
  forget(agent: Agent): void { this.states.delete(agent); }
  setRules(agent: Agent, rules: readonly CollaborationRule[]): void {
    const state = this.valid(agent); if (!state) throw new Error('Session identity is not authorized');
    if (rules.length > 2 || new Set(rules.map(r => r.template)).size !== rules.length) throw new Error('At most one rule per template');
    for (const rule of rules) {
      if (rule.template === 'response-organization@1') { if (!['answer-first', 'concise', 'example-first'].includes(rule.config.layout)) throw new Error('Invalid layout'); }
      else if (rule.template !== 'completion-self-check@1' || rule.config.evidence !== 'required' || rule.config.unknowns !== 'explicit') throw new Error('Unsupported template');
    }
    envelope(this.hostInstanceId, agent.id, openTurn(agent) ?? 0, [...rules]);
    state.rules = structuredClone([...rules]); state.generation++;
  }
  prepare(agent: Agent, rpcId: string, action: CollaborationInstruction): void {
    const state = this.valid(agent); if (!state) throw new Error('Session identity is not authorized');
    if (!rpcId || Buffer.byteLength(action.instruction) > 2048) throw new Error('Invalid instruction');
    envelope(this.hostInstanceId, agent.id, openTurn(agent) ?? 0, state.rules, action);
    const previous = state.intents.get(rpcId);
    if (previous) { if (JSON.stringify(previous.action) !== JSON.stringify(action)) throw new Error('Request identity conflict'); return; }
    state.intents.set(rpcId, { action: structuredClone(action), status: 'prepared' });
  }
  /** Read only: uncertain delivery is never retried and replay cannot activate an intent. */
  receipt(agent: Agent, rpcId: string): CollaborationReceipt {
    const state = this.valid(agent); if (!state) return { status: 'unsupported', reason: 'identity-not-restored' };
    const intent = state.intents.get(rpcId); if (!intent) return { status: 'unknown', reason: 'original-request-not-known' };
    if (intent.status === 'cancelled' || intent.status === 'failed') return { status: intent.status };
    if (state.failure) return { status: 'failed', reason: state.failure };
    const events = agent.session.snapshotEvents();
    let turn = intent.turn;
    // A crash may have persisted the intent before its native claim was recorded locally.
    // Reconstruct only from one exact original rpcId, never by dispatching it again.
    if (turn === undefined && intent.status === 'unknown') {
      const originals = events.filter(e => e.type === 'user/message' && e.data.source.kind === 'user' && 'rpcId' in e.data.source && e.data.source.rpcId === rpcId);
      if (originals.length !== 1) return { status: 'unknown', reason: 'original-request-not-unambiguously-admitted' };
      turn = events.findLast(e => e.type === 'turn/start' && e.seq < originals[0]!.seq)?.seq;
    }
    if (turn === undefined) return { status: intent.status };
    const end = events.find(e => e.seq > turn! && e.type === 'turn/end');
    const inTurn = (event: SessionEvent) => event.seq > turn! && (!end || event.seq < end.seq);
    const user = events.find(e => inTurn(e) && e.type === 'user/message' && e.data.source.kind === 'user' && 'rpcId' in e.data.source && e.data.source.rpcId === rpcId);
    const snapshot = events.find(e => {
      const text = inTurn(e) && section(e); if (!text || Buffer.byteLength(text) > 8192) return false;
      try {
        const value = JSON.parse(text);
        return value.schema === 'amoji.collaboration/1' && value.scope?.profile === this.hostInstanceId && value.scope.session === agent.id && value.scope.turnStartSeq === turn && JSON.stringify(value.instruction) === JSON.stringify(intent.action);
      } catch { return false; }
    });
    if (user && snapshot) return { status: 'attached', turnStartSeq: turn, snapshotSeq: snapshot.seq, digest: hash(section(snapshot)!) };
    if (end?.type === 'turn/end' && end.data.reason.kind === 'aborted') return { status: 'cancelled', turnStartSeq: turn };
    if (intent.status === 'unknown') return { status: 'unknown', turnStartSeq: turn, reason: 'original-request-not-proven' };
    if (end) return { status: 'failed', turnStartSeq: turn, reason: 'no-admitted-matching-snapshot' };
    return { status: 'bound', turnStartSeq: turn };
  }
  checkpoint(agent: Agent): CollaborationCheckpoint {
    const state = this.valid(agent); if (!state) throw new Error('Session identity is not authorized');
    const anchor = agent.session.snapshotEvents().at(-1);
    return structuredClone({ version: 1, ...(anchor ? { anchor: { seq: anchor.seq, digest: hash(JSON.stringify(anchor)) } } : {}), profile: this.hostInstanceId, session: agent.id, createdAt: agent.session.header.createdAt, rules: state.rules, intents: [...state.intents] });
  }
  /** Only exact native cold-resume identity may recover rules; histories are never authorization. */
  restore(agent: Agent, saved: CollaborationCheckpoint): boolean {
    if (saved.version !== 1 || saved.profile !== this.hostInstanceId || saved.session !== agent.id || saved.createdAt !== agent.session.header.createdAt || agent.session.header.parentSession || this.ctx.agents.get(agent.id) !== agent) return false;
    const anchor = saved.anchor && agent.session.snapshotEvents().find(e => e.seq === saved.anchor!.seq);
    if (saved.anchor && (!anchor || hash(JSON.stringify(anchor)) !== saved.anchor.digest)) return false;
    if (!saved.anchor && !agent.session.snapshotEvents().some(e => e.type === 'user/message' && e.data.source.kind === 'user' && 'rpcId' in e.data.source && saved.intents.some(([rpcId]) => 'rpcId' in e.data.source && e.data.source.rpcId === rpcId))) return false;
    this.authorize(agent);
    try { this.setRules(agent, saved.rules); }
    catch { this.forget(agent); return false; }
    const state = this.valid(agent)!;
    for (const [rpcId, intent] of structuredClone(saved.intents)) {
      // An unobserved request stays uncertain. Never rebind it when old inbox items replay.
      state.intents.set(rpcId, { ...intent, status: intent.status === 'cancelled' || intent.status === 'failed' ? intent.status : 'unknown' });
    }
    return true;
  }
  dispose(): void { for (const dispose of this.disposers.splice(0)) dispose(); }
}
