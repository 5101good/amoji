import { createHash } from 'node:crypto';
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { SessionEvent } from '@deepseek-ai/dsh-session';

export const COLLABORATION_CONTEXT = 'amoji:collaboration';
const VARIABLE = 'amoji_collaboration_text';
export type CollaborationRule = { id: string; revision: string } & (
  { template: 'response-organization@1'; config: { layout: 'answer-first' | 'concise' | 'example-first' } } |
  { template: 'completion-self-check@1'; config: { evidence: 'required'; unknowns: 'explicit' } }
);
export interface CollaborationInstruction { id: string; revision: string; instruction: string; conflictGroup: 'explanation' | 'response-organization' | 'completion-report' | 'handoff' }
export interface CollaborationReceipt { status: 'prepared' | 'bound' | 'attached' | 'cancelled' | 'unknown' | 'failed' | 'unsupported'; turnStartSeq?: number; snapshotSeq?: number; digest?: string; reason?: string }
interface Intent { action: CollaborationInstruction; status: CollaborationReceipt['status']; turn?: number; text?: string }
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
      const toolContinuation = lastAssistant?.type === 'assistant/message' && lastAssistant.data.message.content.some(b => b.type === 'tool-call') && events.findLast(e => e.type === 'turn/start')?.seq === turn;
      const hasWork = state.claimed || toolContinuation;
      // Never manufacture a different snapshot during a completion-only assembly.
      if (hasWork || state.turn !== turn) {
        const intent = [...state.intents.values()].find(i => i.turn === turn && (i.status === 'bound' || i.status === 'attached'));
        if (state.rules.length || intent || state.text) {
          try { state.text = envelope(this.hostInstanceId, agent.id, turn, state.rules, intent?.action); state.failure = undefined; }
          catch { state.failure = 'context-budget'; return assembly; }
          if (intent) intent.text = state.text;
        }
        state.turn = turn;
      }
      state.claimed = false;
      if (!state.text) return assembly;
      assembly.contexts.push({ name: COLLABORATION_CONTEXT, text: `{{${VARIABLE}}}` });
      assembly.variables[VARIABLE] = state.text;
      return assembly;
    }));
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
    if (intent.status === 'cancelled') return { status: 'cancelled' };
    if (state.failure) return { status: 'failed', reason: state.failure };
    if (intent.turn === undefined) return { status: intent.status };
    const events = agent.session.snapshotEvents();
    const user = events.find(e => e.seq > intent.turn! && e.type === 'user/message' && e.data.source.kind === 'user' && 'rpcId' in e.data.source && e.data.source.rpcId === rpcId);
    const end = events.find(e => e.seq > intent.turn! && e.type === 'turn/end');
    const snapshot = events.find(e => e.seq > intent.turn! && (!end || e.seq < end.seq) && section(e) === intent.text);
    if (user && snapshot && intent.text) return { status: 'attached', turnStartSeq: intent.turn, snapshotSeq: snapshot.seq, digest: hash(intent.text) };
    if (end?.type === 'turn/end') return { status: end.data.reason.kind === 'aborted' ? 'cancelled' : 'failed', turnStartSeq: intent.turn, reason: 'no-admitted-matching-snapshot' };
    return { status: 'bound', turnStartSeq: intent.turn };
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
    if (!anchor || hash(JSON.stringify(anchor)) !== saved.anchor?.digest) return false;
    this.authorize(agent);
    try { this.setRules(agent, saved.rules); }
    catch { this.forget(agent); return false; }
    const state = this.valid(agent)!;
    for (const [rpcId, intent] of structuredClone(saved.intents)) {
      // An unobserved request stays uncertain. Never rebind it when old inbox items replay.
      state.intents.set(rpcId, { ...intent, status: intent.status === 'cancelled' ? 'cancelled' : 'unknown' });
    }
    return true;
  }
  dispose(): void { for (const dispose of this.disposers.splice(0)) dispose(); }
}
