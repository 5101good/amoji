// The quick strip above the composer: this session's recent sends first,
// then the library's opening expressions, each shown once.
export const BAND_LIMIT = 5;
export function bandItems(s) {
  const known = [...(s.bandItems || []), ...(s.galleryBuffer?.items || [])];
  const byId = new Map(known.map(item => [item.expression.asset_id, item]));
  const seen = new Set();
  const out = [];
  for (const id of [...(s.recent || []), ...known.map(item => item.expression.asset_id)]) {
    const item = byId.get(id);
    if (!item?.preview || item.archived || seen.has(id)) continue;
    seen.add(id);
    out.push(item);
    if (out.length === BAND_LIMIT) break;
  }
  return out;
}
