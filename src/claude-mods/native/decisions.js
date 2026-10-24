import { L } from "./transport.js";
import { answer, quickReply, retryUnsent } from "./controller.js";

// What the AI is waiting on, above the composer: decision options (RFC §8.5)
// and quick replies. An answer states a preference, never an authorization.
export function decisionStrip($, e, s, Button) {
  const { Box, Text } = $.ui.resolve(e);
  const rows = [];
  if (s.unsent && s.delivery?.phase === "error")
    rows.push(Box({ key: "amoji-unsent", flexDirection: "row", gap: 1, alignItems: "center", flexWrap: "wrap", children: [
      Text({ children: [L(s, `已保存「${s.unsent.name}」，但还没送达 Claude`, `Saved “${s.unsent.name}”, but Claude has not received it`)], color: "error" }),
      Button({ key: "amoji-unsent-retry", label: L(s, "重新发送", "Send again"), onPress: () => retryUnsent($, s) }),
    ] }));
  for (const card of s.cards || []) {
    const headline = card.rationale || card.gloss;
    rows.push(Box({ key: "amoji-card:" + card.messageId, flexDirection: "row", gap: 1, alignItems: "center", flexWrap: "wrap", children: [
      Text({ children: [card.options ? L(s, `需要你选一下：${headline}`, `Your choice is needed: ${headline}`) : headline], bold: true }),
      ...(card.options || []).map(o => Button({ key: `decide:${card.messageId}:${o.id}`, label: o.label, onPress: () => answer($, s, card, o.id) })),
      ...(card.replies || []).map(r => Button({ key: `reply:${card.messageId}:${r.act}`, label: r.label, onPress: () => quickReply($, s, card, r) })),
      ...(card.options ? [Text({ children: [L(s, "选择只表达偏好，不是批准", "A choice states a preference, not approval")], dimColor: true })] : []),
    ] }));
  }
  return rows;
}
