import type { ExpressionApplication } from "../application/expressions.js";
import type { BindingContext } from "../shared-contract.js";
import type { StoredMessage } from "../messages.js";
import { HUMAN_EXPRESSION_NOTICE, humanExpressionText } from "../projection.js";

const MARKER = /\[\[amoji:([0-9a-f-]{36})\]\]/g;
export function messageMarker(
  message: Pick<StoredMessage, "message_id">,
): string {
  return `[[amoji:${message.message_id}]]`;
}
/** The prompt text of a human expression: its marker, then the RFC §10.2 one-sentence projection. */
export function humanText(message: StoredMessage, locale?: string): string {
  return `${messageMarker(message)}\n${humanExpressionText(message, locale).replaceAll("@", "\\u0040")}`;
}
export type MessageSegment =
  | { kind: "text"; text: string }
  | { kind: "expression"; message: StoredMessage };
/** A marker is only a local reference. The same-session journal is the authority. */
export async function renderSegments(
  app: ExpressionApplication,
  context: BindingContext,
  direction: StoredMessage["direction"],
  text: string,
  locale?: string,
): Promise<MessageSegment[]> {
  if (!text.includes("[[amoji:") || text.length > 100_000)
    return [{ kind: "text", text }];
  const history = await app.history(context);
  const messages = new Map(
    history
      .filter((m) => m.direction === direction)
      .map((m) => [m.message_id, m]),
  );
  if (direction === "human_to_ai") {
    const first = /^\[\[amoji:([0-9a-f-]{36})\]\]/.exec(text);
    const message = first && messages.get(first[1]!);
    // The projection may have been written in another UI locale; the journal message is the authority.
    return message && text.startsWith(`${messageMarker(message)}\n${HUMAN_EXPRESSION_NOTICE}\n`)
      ? [{ kind: "expression", message }]
      : [{ kind: "text", text }];
  }
  const result: MessageSegment[] = [];
  let offset = 0;
  let count = 0;
  for (const match of text.matchAll(MARKER)) {
    const message = messages.get(match[1]!);
    if (!message || ++count > 4) continue;
    if (match.index > offset)
      result.push({ kind: "text", text: text.slice(offset, match.index) });
    result.push({ kind: "expression", message });
    offset = match.index + match[0].length;
  }
  if (offset < text.length)
    result.push({ kind: "text", text: text.slice(offset) });
  return result.length ? result : [{ kind: "text", text }];
}
