/** The homepage carries only the fields used by its public directory rows. */
export type CatalogPage = {
  packs: Array<{
    pack_id: string;
    release_id: string;
    author: string;
    cover?: { sha256: string };
    expression_count?: number;
    action_count?: number;
    manifest: {
      name: string;
      description: string | null;
      scenario: string[];
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
        m.version < 1 ||
        !Array.isArray(m.scenario) ||
        m.scenario.length > 16
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
        ...(Number.isSafeInteger(row.action_count) && row.action_count! >= 0
          ? { action_count: row.action_count }
          : {}),
        manifest: {
          name: text(m.name, 80),
          description: m.description == null ? null : text(m.description, 4096),
          scenario: m.scenario.map((s) => text(s, 48)),
          version: m.version,
        },
      };
    }),
    cursor: data.cursor === null ? null : text(data.cursor, 512),
  };
}
