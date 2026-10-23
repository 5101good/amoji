import { humanExpressionText, messageProjection } from '../projection.js';
import type { StoredMessage } from '../messages.js';

/**
 * The text a human expression contributes to the model context. Pause/stop interrupts the
 * host already executed since the previous turn travel with it as records (RFC §8.3).
 */
export function expressionMessageText(message: StoredMessage, history: readonly StoredMessage[] = []): string {
  const index = history.findIndex(m => m.message_id === message.message_id);
  const earlier = index < 0 ? history : history.slice(0, index);
  const lastTurn = earlier.map(m => m.from.role === 'human' && m.mode !== 'interrupt').lastIndexOf(true);
  const interrupts = earlier.slice(lastTurn + 1).filter(m => m.mode === 'interrupt' && m.applied && !m.retracted_at);
  const records = interrupts.length ? `\n此前用户在 AI 工作时执行了：${JSON.stringify(interrupts.map(m => messageProjection(m)))}` : '';
  return `${humanExpressionText(message)}${records}`;
}

/** Only remove our exact known text block, never other user content or attachments. */
export function expressionPresentationContent(content: unknown, message: StoredMessage, history: readonly StoredMessage[] = []): unknown {
  if (!Array.isArray(content)) return content;
  const known = new Set([expressionMessageText(message, history), humanExpressionText(message)]);
  return content.filter(block => !(block && typeof block === 'object' && block.type === 'text' && (known.has(block.text) || (typeof block.text === 'string' && block.text.startsWith(humanExpressionText(message))))));
}
