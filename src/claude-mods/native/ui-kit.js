import { wrapText } from "./text-layout.js";

// Text size, weight and mono arrived after Claude Code 2.1.296; older engines
// refuse the whole tree. They draw the same hierarchy with bold and dim text.
const RICH_TEXT = [2, 1, 299];
export function supportsRichText(version) {
  const parts = String(version || "").split(/[.-]/).slice(0, 3).map(Number);
  if (parts.length < 3 || parts.some(n => !Number.isSafeInteger(n))) return false;
  for (let i = 0; i < 3; i++) if (parts[i] !== RICH_TEXT[i]) return parts[i] > RICH_TEXT[i];
  return true;
}

// One accent and translucent neutrals: the same values read on Desktop's light
// and dark themes, so surfaces lift gently instead of drawing hard outlines.
export const ACCENT = "#8B9BFF";
export const SURFACE = "#8080801a";
const SURFACE_HOVER = "#8080802e";
export const LINE = "#80808033";

const RICH = {
  title: { size: "title", weight: "semibold" },
  heading: { size: "heading", weight: "semibold" },
  label: { weight: "medium" },
  body: {},
  caption: { size: "footnote", dimColor: true },
  mono: { size: "caption", mono: true, dimColor: true },
};
const PLAIN = {
  title: { bold: true },
  heading: { bold: true },
  label: { bold: true },
  body: {},
  caption: { dimColor: true },
  mono: { dimColor: true },
};
const TONE = { success: "success", error: "error", warning: "warning", info: ACCENT, busy: ACCENT };
const ICON = { success: "●", error: "●", warning: "●", info: "●", busy: "◌" };

// Bilingual market text arrives as "中文 / English"; show the reader's half.
export function localized(s, value) {
  const parts = String(value || "").split(" / ");
  return parts.length === 2 ? (s.language === "en" ? parts[1] : parts[0]).trim() : String(value || "");
}

// Shared presentation for every Amoji pane view. Desktop wraps prose itself;
// only the terminal, measured in cells, needs explicit line breaks.
export function kit($, e, s, columns) {
  const { Box, Text } = $.ui.resolve(e);
  const styles = s.rich ? RICH : PLAIN;
  // Desktop wraps prose itself, but beside a picture its line can come out a
  // little wider than the cells it was given and lose its last glyph. Text in
  // such a narrow column breaks early there, with a cell to spare; full-width
  // text (a card's inner width included) is left to Desktop.
  const wrap = (value, width) => e.surface === "terminal" ? wrapText(value, width ?? columns)
    : width !== undefined && width < columns - 8 ? wrapText(value, width - 1) : String(value ?? "");
  const text = (variant, value, width, extra = {}) =>
    Text({ children: [wrap(value, width)], wrap: "wrap", ...styles[variant], ...extra });
  const caption = (value, width) => text("caption", value, width);
  const row = (children, extra = {}) => Box({ flexDirection: "row", alignItems: "center", gap: 1, flexWrap: "wrap",
    children: children.filter(Boolean), ...extra });
  return {
    title: (value, width) => text("title", value, width),
    heading: (value, width) => text("heading", value, width),
    label: (value, width) => text("label", value, width),
    body: (value, width) => text("body", value, width),
    caption,
    // Machine facts (counts, versions, locales) in a quiet monospaced line.
    mono: (value) => Text({ children: [String(value)], wrap: "wrap", ...styles.mono }),
    // At most `lines` lines in a column `width` cells wide, then an ellipsis.
    clamp: (variant, value, width, lines = 2) => {
      const all = wrapText(value, Math.max(12, width - 1)).split("\n");
      const shown = all.slice(0, lines).join("\n") + (all.length > lines ? "…" : "");
      return Text({ children: [shown], wrap: "wrap", ...styles[variant] });
    },
    meta: (parts, width) => caption(parts.filter(Boolean).join(" · "), width),
    one: (variant, value) => Text({ children: [String(value ?? "")], wrap: "truncate-end", ...styles[variant] }),
    tone: (kind, value, width) => text("body", value, width, { color: TONE[kind] }),
    badge: (kind, value) => Text({ children: [value], color: TONE[kind] || ACCENT, ...(s.rich ? { size: "caption", weight: "medium" } : { bold: true }) }),
    pill: (value) => Text({ children: [` ${value} `], backgroundColor: SURFACE_HOVER, ...(s.rich ? { size: "caption", mono: true } : {}) }),
    dot: (kind) => Text({ children: [ICON[kind] || "●"], color: TONE[kind] || ACCENT }),
    status: (kind, value) => Box({ flexDirection: "row", gap: 1, width: "100%", paddingX: 1,
      backgroundColor: SURFACE, borderStyle: "round", borderColor: kind === "error" ? "error" : LINE, children: [
        Text({ children: [ICON[kind] || "●"], color: TONE[kind] }),
        Box({ flexGrow: 1, minWidth: 0, children: [text("body", value, columns - 6, kind === "error" ? { color: "error" } : {})] }),
      ] }),
    // A keyed surface is a hover scope: it brightens under the pointer.
    card: ({ key, selected = false, gap = 1, children, direction = "column" }) => Box({
      ...(key ? { key, hover: { backgroundColor: SURFACE_HOVER, ...(selected ? {} : { borderColor: LINE }) } } : {}),
      flexDirection: direction, width: "100%", minWidth: 0, gap,
      ...(direction === "row" ? { alignItems: "center" } : {}),
      borderStyle: "round", borderColor: selected ? ACCENT : LINE, backgroundColor: SURFACE, paddingX: 1,
      children: children.filter(Boolean),
    }),
    // Label above value, the semantic spec of an expression.
    spec: (rows) => Box({ flexDirection: "column", width: "100%", gap: 1, borderStyle: "round", borderColor: LINE,
      backgroundColor: SURFACE, paddingX: 1, children: rows.filter(([, value]) => value).map(([key, value]) =>
        Box({ flexDirection: "column", width: "100%", minWidth: 0, children: [
          Text({ children: [key], ...styles.mono }), text("body", value, columns - 4),
        ] })) }),
    section: (value) => Text({ children: [value], ...styles.mono }),
    row,
    ACCENT,
  };
}
