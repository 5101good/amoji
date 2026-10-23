import { L } from "./transport.js";
import { rasterPicture } from "./raster-picture.js";

// Presentation belongs to the host adapter. Cached values originate only from
// the bridge's frozen, session-bound message projection, never Client input.
export function rememberMessage(s, key, segments) {
  s.messageCache ??= new Map();
  if (s.messageCache.size >= 128 && !s.messageCache.has(key))
    s.messageCache.delete(s.messageCache.keys().next().value);
  s.messageCache.set(key, segments);
}

export async function messageSegments(s, key, read) {
  const cached = s.messageCache?.get(key);
  if (cached) return cached;
  s.messageReads ??= new Map();
  if (s.messageReads.has(key)) return s.messageReads.get(key);
  const pending = read().then(segments => {
    if (segments.some(segment => segment.kind === "expression"))
      rememberMessage(s, key, segments);
    return segments;
  }).finally(() => s.messageReads.delete(key));
  s.messageReads.set(key, pending);
  return pending;
}

export function messageView($, e, s, segments, human) {
  const { Box, Text, Markdown } = $.ui.resolve(e);
  return Box({
    key: human ? "amoji-human-message" : "amoji-assistant-message",
    width: "100%", flexDirection: "column",
    alignItems: human ? "flex-end" : "flex-start",
    marginY: 1,
    children: [
      ...segments.map((segment, index) => segment.kind === "text"
        ? Markdown({ text: segment.text })
        : Box({
          flexDirection: "column", alignItems: human ? "flex-end" : "flex-start",
          children: [
            ...(e.surface === "desktop" && segment.preview ? [
              rasterPicture($, e, s, { key: `message-image:${index}`, source: segment.preview, alt: segment.meaning }),
            ] : []),
            Text({ children: [segment.name || segment.fallback], dimColor: true }),
            ...(segment.note ? [Text({ children: [segment.note] })] : []),
            ...(segment.rationale ? [Text({ children: [segment.rationale], dimColor: true })] : []),
            ...(segment.options ? [Text({ children: [segment.options.map(o => o.label).join(" · ")], dimColor: true })] : []),
          ],
        })),
    ],
  });
}

export function deliveryText(s) {
  const d = s.delivery;
  if (!d) return "";
  if (d.phase === "error") return d.error;
  if (d.phase === "waiting")
    return L(s, `已发送「${d.name}」 · 等待 Claude 回复`, `Sent “${d.name}” · Waiting for Claude`);
  return L(s, `正在发送「${d.name}」…`, `Sending “${d.name}”…`);
}
