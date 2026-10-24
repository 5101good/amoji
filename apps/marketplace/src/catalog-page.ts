/** The homepage carries only the fields used by its public directory rows. */
export type CatalogPage = {
  packs: Array<{
    pack_id: string;
    release_id: string;
    author: string;
    cover?: { sha256: string };
    expression_count?: number;
    effect_count?: number;
    manifest: {
      name: Record<string, string>;
      description: Record<string, string>;
      original_locale: string;
      locales: string[];
      acts: string[];
      version: number;
    };
  }>;
  cursor: string | null;
};
const id =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function text(value: unknown, max: number): string {
  if (typeof value !== "string" || [...value].length > max)
    throw Error("INVALID_SUMMARY");
  return value;
}
function texts(value: unknown, max: number): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length > 32)
    throw Error("INVALID_SUMMARY");
  return Object.fromEntries(Object.entries(value).map(([locale, item]) => [text(locale, 48), text(item, max)]));
}
const list = (value: unknown, max: number) => {
  if (!Array.isArray(value) || value.length > 64) throw Error("INVALID_SUMMARY");
  return value.map((item) => text(item, max));
};
export function catalogPage(value: unknown): CatalogPage {
  const data = value as CatalogPage;
  if (!data || !Array.isArray(data.packs) || data.packs.length > 20)
    throw Error("INVALID_SUMMARY");
  return {
    packs: data.packs.map((row) => {
      if (!row || !id.test(row.pack_id) || !id.test(row.release_id))
        throw Error("INVALID_SUMMARY");
      const m = row.manifest;
      if (
        !m ||
        !Number.isSafeInteger(m.version) ||
        m.version < 1
      )
        throw Error("INVALID_SUMMARY");
      return {
        pack_id: row.pack_id,
        release_id: row.release_id,
        author: text(row.author, 1024),
        ...(row.cover && /^[a-f0-9]{64}$/.test(row.cover.sha256)
          ? { cover: { sha256: row.cover.sha256 } }
          : {}),
        ...(Number.isSafeInteger(row.expression_count) &&
        row.expression_count! >= 0
          ? { expression_count: row.expression_count }
          : {}),
        ...(Number.isSafeInteger(row.effect_count) && row.effect_count! >= 0
          ? { effect_count: row.effect_count }
          : {}),
        manifest: {
          name: texts(m.name, 60),
          description: texts(m.description, 4096),
          original_locale: text(m.original_locale, 48),
          locales: list(m.locales, 48),
          acts: list(m.acts, 70),
          version: m.version,
        },
      };
    }),
    cursor: data.cursor === null ? null : text(data.cursor, 512),
  };
}
