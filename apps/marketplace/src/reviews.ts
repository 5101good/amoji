import { snapshot, visible, type Submission } from "./submissions";
import {
  body,
  digest,
  failure,
  reply,
  uuid,
  type Upload,
  type UploadEnv,
} from "./upload-shared";
export function pageQuery(url: URL) {
  const limit = Number(url.searchParams.get("limit") ?? 20);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50)
    throw Error("INVALID_QUERY");
  let cursor: { time: number; id: string } | null = null;
  const raw = url.searchParams.get("cursor");
  if (raw) {
    try {
      cursor = JSON.parse(atob(raw));
      if (
        !cursor ||
        !Number.isSafeInteger(cursor.time) ||
        !uuid.test(cursor.id)
      )
        throw Error();
    } catch {
      throw Error("INVALID_QUERY");
    }
  }
  return { limit, cursor };
}
export const nextCursor = (
  rows: any[],
  limit: number,
  time: string,
  id: string,
) =>
  rows.length > limit
    ? btoa(
        JSON.stringify({
          time: rows[limit - 1][time],
          id: rows[limit - 1][id],
        }),
      )
    : null;
export async function submissionSnapshot(env: UploadEnv, s: Submission) {
  const u = await env.DB.prepare(
    "SELECT * FROM market_direct_upload WHERE id=? AND owner=? AND state='valid' AND sha256=? AND manifest_sha256=?",
  )
    .bind(s.upload_id, s.owner, s.archive_sha256, s.manifest_sha256)
    .first<Upload>();
  if (!u) throw Error("CONTENT_INTEGRITY");
  return snapshot(env, u);
}
export async function reviewRoute(
  request: Request,
  env: UploadEnv,
  actor: string,
) {
  try {
    const role = await env.DB.prepare(
      "SELECT role FROM market_account WHERE id=? AND disabled=0 AND role IN ('admin','reviewer')",
    )
      .bind(actor)
      .first();
    if (!role) return failure("FORBIDDEN", 403);
    const url = new URL(request.url),
      path = url.pathname;
    if (path === "/v1/review/submissions" && request.method === "GET") {
      const { limit, cursor } = pageQuery(url);
      const rows = (
        await env.DB.prepare(
          "SELECT * FROM market_submission WHERE state='pending' AND (created_at<? OR (created_at=? AND id<?)) ORDER BY created_at DESC,id DESC LIMIT ?",
        )
          .bind(
            cursor?.time ?? Number.MAX_SAFE_INTEGER,
            cursor?.time ?? Number.MAX_SAFE_INTEGER,
            cursor?.id ?? "",
            limit + 1,
          )
          .all<Submission>()
      ).results;
      return reply({
        submissions: rows.slice(0, limit).map(visible),
        cursor: nextCursor(rows, limit, "created_at", "id"),
      });
    }
    const match =
      /^\/v1\/review\/submissions\/([0-9a-f-]{36})(?:\/(decision|media\/([a-f0-9]{64})))?$/.exec(
        path,
      );
    if (!match) return failure("NOT_FOUND", 404);
    const s = await env.DB.prepare("SELECT * FROM market_submission WHERE id=?")
      .bind(match[1])
      .first<Submission>();
    if (!s) return failure("NOT_FOUND", 404);
    if (request.method === "GET" && match[2] !== "decision") {
      const { manifest, files } = await submissionSnapshot(env, s);
      if (match[3]) return mediaResponse(manifest, files, match[3]);
      const previous = await env.DB.prepare(
        "SELECT r.release_id,r.manifest,r.archive_sha256 FROM market_public_pack p JOIN market_public_release r ON r.release_id=p.release_id WHERE p.pack_id=? AND r.state='published'",
      )
        .bind(s.pack_id)
        .first<{
          release_id: string;
          manifest: string;
          archive_sha256: string;
        }>();
      return reply({
        submission: visible(s),
        manifest,
        previous: previous
          ? { ...previous, manifest: JSON.parse(previous.manifest) }
          : null,
      });
    }
    if (request.method !== "POST" || match[2] !== "decision")
      return failure("NOT_FOUND", 404);
    if (s.owner === actor) return failure("SELF_REVIEW", 403);
    const key = request.headers.get("idempotency-key") ?? "";
    if (!uuid.test(key)) return failure("IDEMPOTENCY_KEY", 400);
    const data = await body(request);
    if (
      Object.keys(data).some((k) => !["decision", "reason"].includes(k)) ||
      !["approve", "changes_requested"].includes(data.decision as string) ||
      typeof data.reason !== "string" ||
      !data.reason.trim() ||
      new TextEncoder().encode(data.reason).length > 4096
    )
      return failure("REVIEW_REASON", 422);
    const version = request.headers.get("if-match");
    const requestHash = await digest(
      new TextEncoder().encode(
        JSON.stringify([data.decision, data.reason, version]),
      ),
    );
    const replay = async () => {
      const op = await env.DB.prepare(
        "SELECT route,request_hash,status,result FROM market_submission_operation WHERE owner=? AND operation=?",
      )
        .bind(actor, key)
        .first<{
          route: string;
          request_hash: string;
          status: number;
          result: string;
        }>();
      return op
        ? op.route !== path || op.request_hash !== requestHash
          ? failure("IDEMPOTENCY_CONFLICT", 409)
          : reply(JSON.parse(op.result), op.status)
        : null;
    };
    const old = await replay();
    if (old) return old;
    if (version !== `"${s.row_version}"`) return failure("ROW_VERSION", 412);
    if (s.state !== "pending") return failure("SUBMISSION_STATE", 409);
    const { manifest } = await submissionSnapshot(env, s),
      now = Date.now(),
      marker = crypto.randomUUID(),
      state = data.decision === "approve" ? "published" : "changes_requested";
    const result = {
      submission: visible({
        ...s,
        state,
        reason: data.reason as string,
        row_version: s.row_version + 1,
        updated_at: now,
      }),
    };
    const success =
      "EXISTS(SELECT 1 FROM market_submission WHERE id=? AND last_operation=?)";
    const statements = [
      env.DB.prepare(
        "UPDATE market_submission SET state=?,reason=?,row_version=row_version+1,updated_at=?,last_operation=? WHERE id=? AND owner!=? AND state='pending' AND row_version=? AND EXISTS(SELECT 1 FROM market_account WHERE id=? AND disabled=0 AND role IN ('admin','reviewer')) AND EXISTS(SELECT 1 FROM market_account WHERE id=market_submission.owner AND disabled=0) AND EXISTS(SELECT 1 FROM market_direct_upload u JOIN market_upload_pack p ON p.id=u.pack_id WHERE u.id=market_submission.upload_id AND u.owner=market_submission.owner AND p.owner=market_submission.owner AND u.state='valid' AND u.sha256=market_submission.archive_sha256 AND u.manifest_sha256=market_submission.manifest_sha256)",
      ).bind(
        state,
        data.reason,
        now,
        marker,
        s.id,
        actor,
        s.row_version,
        actor,
      ),
    ];
    if (state === "published") {
      const author = await env.DB.prepare(
        "SELECT display_name FROM market_account WHERE id=?",
      )
        .bind(s.owner)
        .first<{ display_name: string }>();
      // Every language is searchable; acts and locales are exact-match filters.
      const text = (map: Record<string, string>) => Object.values(map);
      const search = [
        ...text(manifest.name),
        ...text(manifest.description),
        ...manifest.expressions.flatMap((e: any) => [
          e.realizes,
          ...text(e.name),
          ...Object.values(e.semantics).flatMap((x: any) => [x.meaning, x.fallback]),
          ...Object.values(e.tags ?? {}).flat(),
        ]),
      ]
        .join(" ")
        .normalize("NFKC")
        .toLowerCase();
      statements.push(
        env.DB.prepare(
          `INSERT INTO market_public_release(release_id,pack_id,submission_id,manifest,archive_sha256,manifest_sha256,author,name,search_text,acts,locales,has_effects,published_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${success}`,
        ).bind(
          s.release_id,
          s.pack_id,
          s.id,
          JSON.stringify(manifest),
          s.archive_sha256,
          s.manifest_sha256,
          author!.display_name,
          manifest.name[manifest.original_locale],
          search,
          JSON.stringify([...new Set(manifest.expressions.map((e: any) => e.realizes))]),
          JSON.stringify(manifest.locales),
          manifest.effects?.length ? 1 : 0,
          now,
          s.id,
          marker,
        ),
      );
      statements.push(
        env.DB.prepare(
          `INSERT INTO market_public_pack(pack_id,release_id,updated_at,priority) SELECT ?,?,?,EXISTS(SELECT 1 FROM market_official_creator WHERE account_id=?) WHERE ${success} ON CONFLICT(pack_id) DO UPDATE SET release_id=excluded.release_id,updated_at=excluded.updated_at,priority=CASE WHEN excluded.priority=1 THEN max(market_public_pack.priority,1) ELSE 0 END`,
        ).bind(s.pack_id, s.release_id, now, s.owner, s.id, marker),
      );
    }
    statements.push(
      env.DB.prepare(
        `INSERT INTO market_review_audit(id,actor,submission_id,release_id,archive_sha256,previous_state,next_state,reason,request_id,created_at) SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${success}`,
      ).bind(
        marker,
        actor,
        s.id,
        s.release_id,
        s.archive_sha256,
        "pending",
        state,
        data.reason,
        key,
        now,
        s.id,
        marker,
      ),
    );
    statements.push(
      env.DB.prepare(
        `INSERT INTO market_submission_operation(owner,operation,route,request_hash,status,result,created_at) SELECT ?,?,?,?,?,?,? WHERE ${success}`,
      ).bind(
        actor,
        key,
        path,
        requestHash,
        200,
        JSON.stringify(result),
        now,
        s.id,
        marker,
      ),
    );
    try {
      await env.DB.batch(statements);
    } catch {
      const op = await replay();
      if (op) return op;
      return failure("REVIEW_UNAVAILABLE", 503);
    }
    return (await replay()) ?? failure("ROW_VERSION", 412);
  } catch (e) {
    return failure(
      String(e).includes("INVALID_QUERY")
        ? "INVALID_QUERY"
        : String(e).includes("READ_QUOTA")
          ? "READ_QUOTA"
          : "REVIEW_UNAVAILABLE",
      String(e).includes("INVALID_QUERY")
        ? 400
        : String(e).includes("READ_QUOTA")
          ? 429
          : 503,
    );
  }
}
export function mediaResponse(
  manifest: any,
  files: Map<string, Uint8Array>,
  hash: string,
) {
  const media = manifest.expressions
      .flatMap((e: any) => [e.visual.primary, e.visual.poster].filter(Boolean))
      .find((m: any) => m.sha256 === hash),
    bytes = files.get("blobs/" + hash);
  if (!media || !bytes) return failure("NOT_FOUND", 404);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": media.mime,
      "content-length": String(bytes.length),
      etag: `"${hash}"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
    },
  });
}
