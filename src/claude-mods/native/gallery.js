// Cell geometry belongs to the Mods adapter, never to the expression domain.
export const TILE_HEIGHT = 6;
export const GALLERY_HEADER = 13;
export const WINDOW_LIMIT = 20;
export const PANE_MAX_COLUMNS = 64;
// Read ahead separately from the drawing budget. Scrolling through a small
// library must not launch a Node process and re-encode its pictures each time.
export const BUFFER_LIMIT = 64;
export function galleryLabel(value, columns) {
  const chars = [...value];
  const width = (char) => /[^\u0000-\u00ff]/u.test(char) ? 2 : 1;
  if (chars.reduce((sum, char) => sum + width(char), 0) <= columns) return value;
  let result = "", used = 0;
  for (const char of chars) {
    if (used + width(char) > columns - 1) break;
    result += char;
    used += width(char);
  }
  return result + "…";
}
export function galleryLayout(e) {
  const width = Math.max(18, Math.min(PANE_MAX_COLUMNS, e.props.bodyColumns || 48));
  const columns = Math.max(1, Math.min(4, Math.floor((width + 1) / 10)));
  return { columns, tileWidth: Math.floor((width - (columns - 1)) / columns) };
}
export function galleryWindow(e, total) {
  const { columns } = galleryLayout(e);
  const rows = Math.min(Math.floor(WINDOW_LIMIT / columns),
    Math.max(3, Math.ceil((e.props.scroll?.bodyRows || 36) / TILE_HEIGHT) + 2));
  const first = Math.max(0, Math.floor(((e.props.scroll?.offset || 0) - GALLERY_HEADER) / TILE_HEIGHT) - 1);
  const lastStart = Math.max(0, Math.ceil(total / columns) - rows);
  // Desktop measures native controls differently from terminal cells. Near
  // the end, anchor the final window so a partial final row is never a spacer.
  const scroll = e.props.scroll;
  const nearEnd = (scroll?.offset || 0) > 0 &&
    scroll.offset + scroll.bodyRows >= GALLERY_HEADER + Math.ceil(total / columns) * TILE_HEIGHT - 2 * TILE_HEIGHT;
  const start = nearEnd ? lastStart : Math.min(first, lastStart);
  return { offset: start * columns, limit: rows * columns };
}
