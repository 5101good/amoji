import { failure, reply, type UploadEnv } from "./upload-shared";
import {
  mediaResponse,
  pageQuery,
  nextCursor,
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
};
const project = (r: PublicRelease) => ({
  pack_id: r.pack_id,
  release_id: r.release_id,
  manifest: JSON.parse(r.manifest),
  archive_sha256: r.archive_sha256,
  manifest_sha256: r.manifest_sha256,
  author: r.author,
  published_at: r.published_at,
});
export async function catalogRoute(request: Request, env: UploadEnv) {
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
            "scenario",
            "locale",
            "style",
            "actions",
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
        ["scenario", "scenarios"],
        ["locale", "locales"],
        ["style", "styles"],
      ]) {
        const value = url.searchParams.get(parameter!);
        if (value) {
          filters.push(
            `EXISTS(SELECT 1 FROM json_each(r.${column}) WHERE value=?)`,
          );
          values.push(value);
        }
      }
      const actions = url.searchParams.get("actions");
      if (actions) {
        if (!["true", "false"].includes(actions)) throw Error("INVALID_QUERY");
        filters.push("r.has_actions=?");
        values.push(actions === "true" ? 1 : 0);
      }
      filters.push("(p.updated_at<? OR (p.updated_at=? AND p.pack_id<?))");
      values.push(
        cursor?.time ?? Number.MAX_SAFE_INTEGER,
        cursor?.time ?? Number.MAX_SAFE_INTEGER,
        cursor?.id ?? "",
        limit + 1,
      );
      const rows = (
        await env.DB.prepare(
          `SELECT r.*,p.updated_at FROM market_public_pack p JOIN market_public_release r ON r.release_id=p.release_id WHERE ${filters.join(" AND ")} ORDER BY p.updated_at DESC,p.pack_id DESC LIMIT ?`,
        )
          .bind(...values)
          .all<PublicRelease>()
      ).results;
      return reply({
        packs: rows.slice(0, limit).map((r) => {
          const p = project(r);
          return {
            ...p,
            manifest: {
              name: p.manifest.name,
              description: p.manifest.description,
              scenario: p.manifest.scenario,
              version: p.manifest.version,
            },
          };
        }),
        cursor: nextCursor(rows, limit, "updated_at", "pack_id"),
      });
    }
    const match =
      /^\/v1\/packs\/([0-9a-f-]{36})(?:\/releases\/([0-9a-f-]{36})(?:\/(archive|media\/([a-f0-9]{64})))?)?$/.exec(
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
    if (r.state !== "published") return failure("RELEASE_REMOVED", 410);
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
