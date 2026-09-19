import { randomUUID, randomBytes } from 'node:crypto';
import type { HostContext } from './codex-context.js';
import { SampleCatalog, type Expression, type ExpressionRef } from './sample-catalog.js';
import type { MessageJournal } from './message-journal.js';
import { buildSearchResult, type SearchCandidate } from './search.js';

interface Selection { context: HostContext; ref: ExpressionRef; expires: number; messageId?: string }
export interface SampleMessage {
  message_id: string;
  binding_id: string;
  direction: 'human_to_ai' | 'ai_to_human';
  created_at: string;
  revision: Expression;
  delivery: 'pending';
  /** dsh native prompt accepted and flushed; not proof of a rendered user message. */
  dsh_submission?: 'accepted';
  presentation: 'pending' | 'rendered' | 'fallback';
}
interface Session { version: number; bindingId: string; messages: SampleMessage[]; emittedTurns: Set<string>; received: Map<string, string> }
export type Candidate = SearchCandidate;

/** Narrow integration runtime with optional history journal; not the editable shared library. */
export class SampleRuntime {
  private readonly selections = new Map<string, Selection>();
  private readonly sessions = new Map<string, Session>();
  constructor(readonly catalog: SampleCatalog, private readonly now: () => number = Date.now, private readonly journal?: MessageJournal) {}

  private session(context: HostContext): Session {
    const key = `${context.host}:${context.sessionId}`;
    let session = this.sessions.get(key);
    const stored = this.journal?.load(context);
    if (!session || (stored && stored.version !== session.version)) {
      session = { version: stored?.version ?? 0, bindingId: stored?.bindingId ?? randomUUID(), messages: stored?.messages ?? [], emittedTurns: new Set(stored?.emittedTurns), received: new Map(stored?.received) };
      this.sessions.set(key, session);
    }
    return session;
  }

  private persist(context: HostContext, session: Session): void {
    if (!this.journal) return;
    try {
      session.version = this.journal.save(context, { bindingId: session.bindingId, messages: session.messages, emittedTurns: [...session.emittedTurns], received: [...session.received] }, session.version);
    } catch (error) {
      this.sessions.delete(`${context.host}:${context.sessionId}`);
      throw error;
    }
  }

  search(context: HostContext, query: string, limit = 3): { candidates: Candidate[]; policy: string } {
    const matches = this.catalog.search(query, limit);
    const result = buildSearchResult(matches, () => randomBytes(24).toString('base64url'));
    result.candidates.forEach((candidate, index) => this.selections.set(candidate.selection_token, {
      context: { ...context }, ref: { asset_id: matches[index]!.asset_id, revision_id: matches[index]!.revision_id }, expires: this.now() + 300000,
    }));
    return result;
  }

  emit(context: HostContext, token: string): SampleMessage {
    const selection = this.selections.get(token);
    if (!selection) throw new Error('选择凭据不存在，请重新检索');
    if (selection.context.host !== context.host || selection.context.sessionId !== context.sessionId) throw new Error('不能使用其他会话的选择凭据');
    if (selection.context.turnId !== context.turnId) throw new Error('不能使用其他回合的选择凭据');
    const session = this.session(context);
    if (selection.messageId) return structuredClone(session.messages.find(m => m.message_id === selection.messageId)!);
    if (selection.expires <= this.now()) throw new Error('选择凭据已过期，请重新检索');
    if (session.emittedTurns.has(context.turnId)) throw new Error('每回合最多发送一个 AI 表情');
    const message: SampleMessage = {
      message_id: randomUUID(), binding_id: session.bindingId, direction: 'ai_to_human', created_at: new Date(this.now()).toISOString(),
      revision: this.catalog.resolve(selection.ref), delivery: 'pending', presentation: 'pending',
    };
    session.messages.push(message);
    session.emittedTurns.add(context.turnId);
    this.persist(context, session);
    selection.messageId = message.message_id;
    return structuredClone(message);
  }

  messages(context: HostContext): SampleMessage[] { return structuredClone(this.session(context).messages); }

  receive(context: HostContext, ref: ExpressionRef, requestId: string): SampleMessage {
    const session = this.session(context);
    const previous = session.received.get(requestId);
    if (previous) {
      const message = session.messages.find(m => m.message_id === previous)!;
      if (message.revision.asset_id !== ref.asset_id || message.revision.revision_id !== ref.revision_id) throw new Error('该请求已用于其他表情');
      return structuredClone(message);
    }
    const message: SampleMessage = { message_id: randomUUID(), binding_id: session.bindingId, direction: 'human_to_ai', created_at: new Date(this.now()).toISOString(),
      revision: this.catalog.resolve(ref), delivery: 'pending', presentation: 'pending' };
    session.messages.push(message);
    session.received.set(requestId, message.message_id);
    this.persist(context, session);
    return structuredClone(message);
  }

  acknowledge(context: HostContext, messageId: string, presentation: 'rendered' | 'fallback'): void {
    const session = this.session(context);
    const message = session.messages.find(m => m.message_id === messageId);
    if (!message) throw new Error('当前会话不存在此消息');
    message.presentation = presentation;
    this.persist(context, session);
  }
}
