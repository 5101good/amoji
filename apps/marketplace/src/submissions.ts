import { unpack } from "./market-validator";
import {
  body,
  budget,
  digest,
  failure,
  reply,
  uuid,
  type Upload,
  type UploadEnv,
} from "./upload-shared";
type Submission = {
  id: string;
  owner: string;
  upload_id: string;
  pack_id: string;
  release_id: string;
  version: number;
  archive_sha256: string;
  manifest_sha256: string;
  state: string;
  row_version: number;
  reason: string | null;
  created_at: number;
  updated_at: number;
  last_operation: string;
};
type Operation = {
  request_hash: string;
  route: string;
  status: number;
  result: string;
};
const visible = ({ owner, last_operation, ...s }: Submission) => s;
function canonical(value: any): any {
  return Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((k) => [k, canonical(value[k])]),
        )
      : value;
}
const hash = (v: unknown) =>
  digest(new TextEncoder().encode(JSON.stringify(v)));
const ownedUpload = (env: UploadEnv, id: string, owner: string) =>
  env.DB.prepare("SELECT * FROM market_direct_upload WHERE id=? AND owner=?")
    .bind(id, owner)
    .first<Upload>();
async function snapshot(env: UploadEnv, u: Upload) {
  if (u.state !== "valid") throw Error("UPLOAD_NOT_VALID");
  const ref = await env.DB.prepare(
    "SELECT 1 FROM market_direct_upload_reference WHERE upload_id=? LIMIT 1",
  )
    .bind(u.id)
    .first();
  if (u.expires_at <= Date.now() && !ref) throw Error("UPLOAD_EXPIRED");
  // Admission counters are shared in D1, including reads made while submitting.
  if (
    !(await budget(env, `sealed_reads:${u.owner}`, 1024)) ||
    !(await budget(env, "sealed_reads", 4096))
  )
    throw Error("READ_QUOTA");
  const object = await env.UPLOADS?.get(u.sealed_key);
  if (!object) throw Error("CONTENT_UNAVAILABLE");
  const bytes = new Uint8Array(await object.arrayBuffer());
  if ((await digest(bytes)) !== u.sha256) throw Error("CONTENT_INTEGRITY");
  const files = unpack(bytes),
    raw = files.get("manifest.json")!;
  if ((await digest(raw)) !== u.manifest_sha256)
    throw Error("CONTENT_INTEGRITY");
  return { files, manifest: JSON.parse(new TextDecoder().decode(raw)) };
}
/** These supported licenses expressly permit redistribution. Unknown licenses need a future review workflow. */
function publicationRights(m: any) {
  for (const r of [
    m.rights,
    ...m.expressions.map((e: any) => e.rights),
    ...m.actions.map((a: any) => a.rights),
  ]) {
    if (!["CC0-1.0", "CC-BY-4.0", "CC-BY-SA-4.0"].includes(r?.license))
      throw Error("DISTRIBUTION_LICENSE");
    if (typeof r.creator !== "string" || !r.creator.trim())
      throw Error("ATTRIBUTION_REQUIRED");
  }
  if (m.derived_from && !m.rights.source?.trim())
    throw Error("DERIVATION_SOURCE_REQUIRED");
}
export async function submissionRoute(
  request: Request,
  env: UploadEnv,
  owner: string,
): Promise<Response> {
  const url = new URL(request.url),
    path = url.pathname;
  try {
    let match =
      /^\/v1\/uploads\/([0-9a-f-]{36})\/(preview|media\/([a-f0-9]{64}))$/.exec(
        path,
      );
    if (match && request.method === "GET") {
      const u = await ownedUpload(env, match[1], owner);
      if (!u) return failure("NOT_FOUND", 404);
      const { files, manifest } = await snapshot(env, u);
      if (match[2] === "preview")
        return reply({
          manifest,
          upload_id: u.id,
          archive_sha256: u.sha256,
          manifest_sha256: u.manifest_sha256,
          row_version: u.row_version,
        });
      const media = manifest.expressions
        .flatMap((e: any) =>
          [e.visual.primary, e.visual.poster].filter(Boolean),
        )
        .find((m: any) => m.sha256 === match![3]);
      const bytes = files.get("blobs/" + match[3]);
      if (!media || !bytes) return failure("NOT_FOUND", 404);
      return new Response(new Uint8Array(bytes), {
        headers: {
          "content-type": media.mime,
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          "content-security-policy": "default-src 'none'; sandbox",
        },
      });
    }
    if (path === "/v1/me/submissions" && request.method === "GET") {
      const raw = url.searchParams.get("limit"),
        limit = raw === null ? 20 : Number(raw);
      if (!Number.isInteger(limit) || limit < 1 || limit > 50)
        return failure("INVALID_QUERY", 400);
      let cursor: { time: number; id: string } | null = null;
      const token = url.searchParams.get("cursor");
      if (token) {
        try {
          cursor = JSON.parse(atob(token));
          if (
            !cursor ||
            !Number.isSafeInteger(cursor.time) ||
            !uuid.test(cursor.id)
          )
            throw Error();
        } catch {
          return failure("INVALID_CURSOR", 400);
        }
      }
      const rows = await env.DB.prepare(
        "SELECT * FROM market_submission WHERE owner=? AND (created_at<? OR (created_at=? AND id<?)) ORDER BY created_at DESC,id DESC LIMIT ?",
      )
        .bind(
          owner,
          cursor?.time ?? Number.MAX_SAFE_INTEGER,
          cursor?.time ?? Number.MAX_SAFE_INTEGER,
          cursor?.id ?? "",
          limit + 1,
        )
        .all<Submission>();
      const page = rows.results.slice(0, limit),
        last = page.at(-1);
      return reply({
        submissions: page.map(visible),
        cursor:
          rows.results.length > limit && last
            ? btoa(JSON.stringify({ time: last.created_at, id: last.id }))
            : null,
      });
    }
    match = /^\/v1\/me\/submissions\/([0-9a-f-]{36})$/.exec(path);
    if (match && request.method === "GET") {
      const s = await env.DB.prepare(
        "SELECT * FROM market_submission WHERE id=? AND owner=?",
      )
        .bind(match[1], owner)
        .first<Submission>();
      return s ? reply({ submission: visible(s) }) : failure("NOT_FOUND", 404);
    }
    match = /^\/v1\/operations\/([0-9a-f-]{36})$/.exec(path);
    if (match && request.method === "GET") {
      const op = await env.DB.prepare(
        "SELECT * FROM market_submission_operation WHERE owner=? AND operation=?",
      )
        .bind(owner, match[1])
        .first<Operation>();
      return op
        ? reply({ status: op.status, result: JSON.parse(op.result) })
        : failure("NOT_FOUND", 404);
    }
    if (request.method !== "POST") return failure("NOT_FOUND", 404);
    const withdraw = /^\/v1\/submissions\/([0-9a-f-]{36})\/withdraw$/.exec(
      path,
    );
    if (path !== "/v1/submissions" && !withdraw)
      return failure("NOT_FOUND", 404);
    const key = request.headers.get("idempotency-key") ?? "";
    if (!uuid.test(key)) return failure("IDEMPOTENCY_KEY", 400);
    const data = await body(request),
      requestHash = await hash(
        Object.fromEntries(
          Object.entries(data).sort(([a], [b]) => a.localeCompare(b)),
        ),
      );
    const replay = async () => {
      const op = await env.DB.prepare(
        "SELECT * FROM market_submission_operation WHERE owner=? AND operation=?",
      )
        .bind(owner, key)
        .first<Operation>();
      return op
        ? op.route !== path || op.request_hash !== requestHash
          ? failure("IDEMPOTENCY_CONFLICT", 409)
          : reply(JSON.parse(op.result), op.status)
        : null;
    };
    const previous = await replay();
    if (previous) return previous;
    const version = request.headers.get("if-match");
    if (!version || !/^"[1-9][0-9]*"$/.test(version))
      return failure("ROW_VERSION", 412);
    const now = Date.now();
    if (!withdraw) {
      if (
        Object.keys(data).some(
          (k) => !["upload_id", "rights_confirmed"].includes(k),
        ) ||
        typeof data.upload_id !== "string" ||
        !uuid.test(data.upload_id)
      )
        return failure("INVALID_BODY", 400);
      if (data.rights_confirmed !== true)
        return failure("RIGHTS_CONFIRMATION_REQUIRED", 422);
      const u = await ownedUpload(env, data.upload_id, owner);
      if (!u) return failure("NOT_FOUND", 404);
      if (version !== `"${u.row_version}"`) return failure("ROW_VERSION", 412);
      const { manifest } = await snapshot(env, u);
      publicationRights(manifest);
      const s: Submission = {
        id: crypto.randomUUID(),
        owner,
        upload_id: u.id,
        pack_id: u.pack_id,
        release_id: u.release_id,
        version: u.version,
        archive_sha256: u.sha256!,
        manifest_sha256: u.manifest_sha256!,
        state: "pending",
        row_version: 1,
        reason: null,
        created_at: now,
        updated_at: now,
        last_operation: key,
      };
      const identities = await Promise.all(
        [
          ...manifest.expressions.map((e: any) => ({
            kind: "expression",
            id: e.asset_id,
            revision: e.revision_id,
            value: e,
          })),
          ...manifest.actions.map((a: any) => ({
            kind: "action",
            id: a.action_id,
            revision: a.action_revision_id,
            value: a,
          })),
        ].map(async (item) => ({
          ...item,
          digest: await hash(canonical(item.value)),
        })),
      );
      try {
        await env.DB.batch([
          env.DB.prepare(
            `INSERT INTO market_submission(id,owner,upload_id,pack_id,release_id,version,archive_sha256,manifest_sha256,created_at,updated_at,last_operation) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM market_direct_upload WHERE id=? AND row_version=?)`,
          ).bind(
            s.id,
            owner,
            u.id,
            u.pack_id,
            u.release_id,
            u.version,
            u.sha256,
            u.manifest_sha256,
            now,
            now,
            key,
            u.id,
            u.row_version,
          ),
          ...identities.map((i) =>
            env.DB.prepare(
              "INSERT INTO market_content_identity(kind,id,revision,digest) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM market_submission WHERE id=? AND last_operation=?) ON CONFLICT(kind,id,revision) DO UPDATE SET digest=excluded.digest",
            ).bind(i.kind, i.id, i.revision, i.digest, s.id, key),
          ),
          env.DB.prepare(
            "INSERT INTO market_direct_upload_reference(upload_id,reference_id) SELECT upload_id,id FROM market_submission WHERE id=? AND last_operation=?",
          ).bind(s.id, key),
          env.DB.prepare(
            "INSERT INTO market_submission_operation(owner,operation,route,request_hash,status,result,created_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM market_submission WHERE id=? AND last_operation=?)",
          ).bind(
            owner,
            key,
            path,
            requestHash,
            201,
            JSON.stringify({ submission: visible(s) }),
            now,
            s.id,
            key,
          ),
        ]);
      } catch (e) {
        const result = await replay();
        if (result) return result;
        const msg = String(e);
        if (msg.includes("SUBMISSION_QUOTA"))
          return failure("SUBMISSION_QUOTA", 429);
        if (msg.includes("CONTENT_IDENTITY_CONFLICT"))
          return failure("CONTENT_IDENTITY_CONFLICT", 409);
        if (msg.includes("UNIQUE")) return failure("ALREADY_SUBMITTED", 409);
        throw e;
      }
      return (await replay()) ?? failure("ROW_VERSION", 412);
    }
    if (Object.keys(data).length) return failure("INVALID_BODY", 400);
    const s = await env.DB.prepare(
      "SELECT * FROM market_submission WHERE id=? AND owner=?",
    )
      .bind(withdraw[1], owner)
      .first<Submission>();
    if (!s) return failure("NOT_FOUND", 404);
    if (version !== `"${s.row_version}"`) return failure("ROW_VERSION", 412);
    if (s.state !== "pending") return failure("SUBMISSION_STATE", 409);
    const result = {
      submission: visible({
        ...s,
        state: "withdrawn",
        row_version: s.row_version + 1,
        updated_at: now,
        last_operation: key,
      }),
    };
    try {
      await env.DB.batch([
        env.DB.prepare(
          "UPDATE market_submission SET state='withdrawn',row_version=row_version+1,updated_at=?,last_operation=? WHERE id=? AND owner=? AND row_version=? AND state='pending' AND EXISTS(SELECT 1 FROM market_account WHERE id=? AND disabled=0)",
        ).bind(now, key, s.id, owner, s.row_version, owner),
        env.DB.prepare(
          "INSERT INTO market_submission_operation(owner,operation,route,request_hash,status,result,created_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM market_submission WHERE id=? AND last_operation=?)",
        ).bind(
          owner,
          key,
          path,
          requestHash,
          200,
          JSON.stringify(result),
          now,
          s.id,
          key,
        ),
      ]);
    } catch (e) {
      const result = await replay();
      if (result) return result;
      throw e;
    }
    return (await replay()) ?? failure("ROW_VERSION", 412);
  } catch (e) {
    const message = String(e);
    if (message.includes("READ_QUOTA")) return failure("READ_QUOTA", 429);
    for (const code of [
      "DISTRIBUTION_LICENSE",
      "ATTRIBUTION_REQUIRED",
      "DERIVATION_SOURCE_REQUIRED",
    ])
      if (message.includes(code)) return failure(code, 422);
    if (message.includes("UPLOAD_NOT_VALID"))
      return failure("UPLOAD_NOT_VALID", 409);
    if (message.includes("UPLOAD_EXPIRED"))
      return failure("UPLOAD_EXPIRED", 410);
    if (e instanceof SyntaxError || message.includes("INVALID_BODY"))
      return failure("INVALID_BODY", 400);
    return failure("SUBMISSION_UNAVAILABLE", 503);
  }
}
