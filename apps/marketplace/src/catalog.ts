import type { CoverCache } from "./cover-cache";
import { failure, reply, type UploadEnv } from "./upload-shared";
import {
  mediaResponse,
  pageQuery,
  submissionSnapshot,
} from "./reviews";
import type { Submission } from "./submissions";
type PublicRelease = {
  release_id: string;
  pack_id: string;
  submission_id: string;
  manifest: string;
  archive_sha256: string;
  manifest_sha256: string;
  author: string;
  published_at: number;
  state: string;
  updated_at: number;
  row_version: number;
  cover_sha256?: string;
  expression_count?: number;
  effect_count?: number;
  priority: number;
};
const project = (r: PublicRelease) => ({
  pack_id: r.pack_id,
  release_id: r.release_id,
  manifest: JSON.parse(r.manifest),
  archive_sha256: r.archive_sha256,
  manifest_sha256: r.manifest_sha256,
  author: r.author,
  published_at: r.published_at,
  row_version: r.row_version,
});
export async function catalogRoute(
  request: Request,
  env: UploadEnv,
  covers?: CoverCache,
  queueCover?: (job: () => Promise<Response>) => Promise<Response>,
) {
  try {
    if (request.method !== "GET") return failure("NOT_FOUND", 404);
    const url = new URL(request.url);
    if (url.pathname === "/v1/packs") {
      const { limit, cursor } = pageQuery(url),
        values: unknown[] = [],
        filters = ["r.state='published'"];
      for (const [key, value] of url.searchParams) {
        if (
          ![
            "q",
            "act",
            "locale",
            "effects",
            "cursor",
            "limit",
          ].includes(key) ||
          value.length > (key === "cursor" ? 512 : 256)
        )
          throw Error("INVALID_QUERY");
      }
      const q = url.searchParams.get("q");
      if (q) {
        filters.push("instr(r.search_text,?)>0");
        values.push(q.normalize("NFKC").toLowerCase());
      }
      for (const [parameter, column] of [
        ["act", "acts"],
        ["locale", "locales"],
      ]) {
        const value = url.searchParams.get(parameter!);
        if (value) {
          filters.push(
            `EXISTS(SELECT 1 FROM json_each(r.${column}) WHERE value=?)`,
          );
          values.push(value);
        }
      }
      const effects = url.searchParams.get("effects");
      if (effects) {
        if (!["true", "false"].includes(effects)) throw Error("INVALID_QUERY");
        filters.push("r.has_effects=?");
        values.push(effects === "true" ? 1 : 0);
      }
      if (cursor) {
        const priority = (cursor as typeof cursor & { priority?: number }).priority;
        if (!Number.isInteger(priority) || priority! < 0 || priority! > 3)
          throw Error("INVALID_QUERY");
        filters.push("(p.priority,p.updated_at,p.pack_id)<(?,?,?)");
        values.push(priority, cursor.time, cursor.id);
      }
      values.push(limit + 1);
      const rows = (
        await env.DB.prepare(
          `SELECT coalesce(json_extract(r.manifest,'$.expressions[0].visual.poster.sha256'),json_extract(r.manifest,'$.expressions[0].visual.primary.sha256')) AS cover_sha256,json_array_length(r.manifest,'$.expressions') AS expression_count,coalesce(json_array_length(r.manifest,'$.effects'),0) AS effect_count,r.release_id,r.pack_id,r.archive_sha256,r.manifest_sha256,r.author,r.published_at,r.row_version,p.updated_at,p.priority,json_object('name',json_extract(r.manifest,'$.name'),'description',json_extract(r.manifest,'$.description'),'original_locale',json_extract(r.manifest,'$.original_locale'),'locales',json_extract(r.manifest,'$.locales'),'acts',json(r.acts),'version',json_extract(r.manifest,'$.version')) AS manifest FROM market_public_pack p JOIN market_public_release r ON r.release_id=p.release_id WHERE ${filters.join(" AND ")} ORDER BY p.priority DESC,p.updated_at DESC,p.pack_id DESC LIMIT ?`,
        )
          .bind(...values)
          .all<PublicRelease>()
      ).results;
      return reply({
        packs: rows.slice(0, limit).map((r) => {
          const p = project(r);
          return {
            ...p,
            ...(r.cover_sha256 ? { cover: { sha256: r.cover_sha256 } } : {}),
            expression_count: r.expression_count ?? 0,
            effect_count: r.effect_count ?? 0,
            manifest: {
              name: p.manifest.name,
              description: p.manifest.description,
              original_locale: p.manifest.original_locale,
              locales: p.manifest.locales,
              acts: p.manifest.acts,
              version: p.manifest.version,
            },
          };
        }),
        cursor: rows.length > limit ? btoa(JSON.stringify({
          priority: rows[limit - 1]!.priority,
          time: rows[limit - 1]!.updated_at,
          id: rows[limit - 1]!.pack_id,
        })) : null,
      });
    }
    const match =
      /^\/v1\/packs\/([0-9a-f-]{36})(?:\/releases\/([0-9a-f-]{36})(?:\/(archive|cover|media\/([a-f0-9]{64})))?)?$/.exec(
        url.pathname,
      );
    if (!match) return failure("NOT_FOUND", 404);
    const r = await (
      match[2]
        ? env.DB.prepare(
            "SELECT * FROM market_public_release WHERE pack_id=? AND release_id=?",
          ).bind(match[1], match[2])
        : env.DB.prepare(
            "SELECT r.* FROM market_public_pack p JOIN market_public_release r ON r.release_id=p.release_id WHERE p.pack_id=?",
          ).bind(match[1])
    ).first<PublicRelease>();
    if (!r) return failure("NOT_FOUND", 404);
    if (r.state !== "published")
      return reply(
        {
          error: {
            code: "RELEASE_REMOVED",
            message: "RELEASE_REMOVED",
            retryable: false,
          },
          tombstone: {
            pack_id: r.pack_id,
            release_id: r.release_id,
            archive_sha256: r.archive_sha256,
            state: r.state,
            row_version: r.row_version,
          },
        },
        410,
      );
    if (!match[3])
      return reply({
        ...project(r),
        share_url: `${url.origin}/packs/${r.pack_id}/releases/${r.release_id}`,
        dsh_search: r.pack_id,
      });
    const s = await env.DB.prepare(
      "SELECT * FROM market_submission WHERE id=? AND state='published'",
    )
      .bind(r.submission_id)
      .first<Submission>();
    if (!s) return failure("NOT_FOUND", 404);
    // The live release and submission checks above also apply to warm covers.
    // Cache identity includes both sealed digests, so it cannot cross revisions.
    const coverKey = `${r.archive_sha256}:${r.manifest_sha256}`;
    if (match[3] === "cover") {
      const cached = covers?.get(coverKey);
      if (cached) return cached;
      const load = async () => {
        // A cold cover waits for the shared heavy queue: recheck visibility once
        // admitted. A warm cover only needs the live metadata checks above.
        const current = await env.DB.prepare(
          "SELECT state FROM market_public_release WHERE release_id=?",
        )
          .bind(r.release_id)
          .first<{ state: string }>();
        if (!current || current.state !== "published")
          return failure("RELEASE_REMOVED", 410);
        const hit = covers?.get(coverKey);
        if (hit) return hit;
        const { manifest, files } = await submissionSnapshot(env, s);
        const expression = manifest.expressions[0];
        const hash = (expression?.visual.poster ?? expression?.visual.primary)
          ?.sha256;
        if (!hash) return failure("NOT_FOUND", 404);
        const response = mediaResponse(manifest, files, hash);
        return covers ? covers.remember(coverKey, response) : response;
      };
      return await (queueCover ? queueCover(load) : load());
    }
    const { bytes, manifest, files } = await submissionSnapshot(env, s);
    if (match[4]) return mediaResponse(manifest, files, match[4]);
    return new Response(new Blob([new Uint8Array(bytes)]).stream(), {
      headers: {
        "content-type": "application/zip",
        "content-length": String(bytes.length),
        etag: `"${r.archive_sha256}"`,
        digest: `sha-256=${btoa(String.fromCharCode(...Uint8Array.from(r.archive_sha256.match(/../g)!, (x) => parseInt(x, 16))))}`,
        "x-content-sha256": r.archive_sha256,
        "content-disposition": `attachment; filename="${r.pack_id}-${r.release_id}.amoji"`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (e) {
    const query = String(e).includes("INVALID_QUERY"),
      quota = String(e).includes("READ_QUOTA");
    return failure(
      query ? "INVALID_QUERY" : quota ? "READ_QUOTA" : "CATALOG_UNAVAILABLE",
      query ? 400 : quota ? 429 : 503,
    );
  }
}
