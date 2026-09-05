export interface HostContext {
  host: 'codex';
  sessionId: string;
  turnId: string;
}

/** Observed on CLI 0.151.0 and Desktop-bundled 0.140.0-alpha.2, not model arguments. */
export function codexContext(meta: unknown): HostContext {
  if (!meta || typeof meta !== 'object') throw new Error('宿主没有提供可信的会话上下文');
  const envelope = meta as Record<string, unknown>;
  const value = envelope['x-codex-turn-metadata'];
  if (!value || typeof value !== 'object') throw new Error('宿主没有提供可信的会话上下文');
  const turn = value as Record<string, unknown>;
  if (typeof turn.thread_id !== 'string' || !turn.thread_id.trim() || typeof turn.turn_id !== 'string' || !turn.turn_id.trim()) {
    throw new Error('宿主没有提供可信的会话和回合上下文');
  }
  if ((envelope.threadId !== undefined && envelope.threadId !== turn.thread_id) || (turn.session_id !== undefined && turn.session_id !== turn.thread_id)) {
    throw new Error('宿主会话标识不一致');
  }
  return { host: 'codex', sessionId: turn.thread_id, turnId: turn.turn_id };
}
