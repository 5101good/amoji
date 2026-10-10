import {
  MARKET_LIMITS,
  uuid,
  reply,
  failure,
  view,
  body,
  budget,
  digest,
  type Upload,
  type UploadEnv,
} from "./upload-shared";
import { authorizePut } from "./r2-signature";
const owned = (env: UploadEnv, id: string, owner: string) =>
  env.DB.prepare("SELECT * FROM market_direct_upload WHERE id=? AND owner=?")
    .bind(id, owner)
    .first<Upload>();
/** Expiry wins a SQL CAS before object deletion; references prevent expiry and concurrent new references. */
export async function cleanupUploads(env: UploadEnv, now = Date.now()) {
  if (!env.UPLOADS) return;
  await env.DB.prepare(
    "UPDATE market_direct_upload SET state='expired',row_version=row_version+1 WHERE expires_at<=? AND state!='expired' AND NOT EXISTS(SELECT 1 FROM market_direct_upload_reference WHERE upload_id=market_direct_upload.id)",
  )
    .bind(now)
    .run();
  const rows = await env.DB.prepare(
    "SELECT * FROM market_direct_upload WHERE state IN ('expired','invalid') AND expires_at<=? AND cleaned=0 LIMIT 20",
  )
    .bind(now)
    .all<Upload>();
  for (const row of rows.results) {
    await env.UPLOADS.delete([row.object_key, row.sealed_key]);
    await env.DB.prepare(
      "UPDATE market_direct_upload SET cleaned=1 WHERE id=? AND state IN ('expired','invalid')",
    )
      .bind(row.id)
      .run();
  }
  // Keep operation records at least seven days. Never delete referenced records.
  await env.DB.prepare("DELETE FROM market_runtime_budget WHERE day<?")
    .bind(Math.floor(now / 86400000) - 31)
    .run();
}
export async function uploadRoute(
  request: Request,
  env: UploadEnv,
  owner: string,
): Promise<Response> {
  const path = new URL(request.url).pathname;
  try {
    if (!env.UPLOADS || !env.FREE_RUNTIME || env.UPLOAD_ENABLED !== "true")
      return failure("UPLOAD_UNAVAILABLE", 503);
    if (path === "/v1/uploads" && request.method === "POST") {
      const operation = request.headers.get("idempotency-key") ?? "";
      if (!uuid.test(operation)) return failure("IDEMPOTENCY_KEY", 400);
      const data = await body(request);
      if (
        Object.keys(data).some((k) => k !== "pack_id") ||
        (data.pack_id !== undefined &&
          (typeof data.pack_id !== "string" || !uuid.test(data.pack_id)))
      )
        return failure("INVALID_BODY", 400);
      const requestHash = await digest(
        new TextEncoder().encode(
          JSON.stringify({ pack_id: data.pack_id ?? null }),
        ),
      );
      let row = await env.DB.prepare(
        "SELECT * FROM market_direct_upload WHERE owner=? AND operation=?",
      )
        .bind(owner, operation)
        .first<Upload>();
      if (row)
        return row.request_hash !== requestHash
          ? failure("IDEMPOTENCY_CONFLICT", 409)
          : reply({ upload: view(row) }, 201);
      if (!(await budget(env, "reservations", 128)))
        return failure("UPLOAD_QUOTA", 429);
      const packId = String(data.pack_id ?? crypto.randomUUID()),
        id = crypto.randomUUID(),
        now = Date.now();
      if (data.pack_id) {
        const pack = await env.DB.prepare(
          "SELECT id FROM market_upload_pack WHERE id=? AND owner=?",
        )
          .bind(packId, owner)
          .first();
        if (!pack) return failure("NOT_FOUND", 404);
      }
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO market_upload_pack(id,owner) VALUES(?,?) ON CONFLICT(id) DO NOTHING",
        ).bind(packId, owner),
        env.DB.prepare(
          "INSERT INTO market_direct_upload(id,owner,operation,request_hash,pack_id,release_id,version,object_key,sealed_key,created_at,expires_at) SELECT ?,?,?,?,?,?,coalesce((SELECT max(version)+1 FROM market_direct_upload WHERE pack_id=?),1),?,?,?,? WHERE EXISTS(SELECT 1 FROM market_upload_pack WHERE id=? AND owner=?) AND (SELECT count(*) FROM market_direct_upload WHERE owner=? AND cleaned=0 AND state NOT IN ('valid','expired','invalid') AND expires_at>?)<3 AND (SELECT count(*) FROM market_direct_upload WHERE cleaned=0)<100 ON CONFLICT(owner,operation) DO NOTHING",
        ).bind(
          id,
          owner,
          operation,
          requestHash,
          packId,
          crypto.randomUUID(),
          packId,
          `staging/${owner}/${id}`,
          `sealed/${owner}/${id}`,
          now,
          now + MARKET_LIMITS.lifetime,
          packId,
          owner,
          owner,
          now,
        ),
      ]);
      row = await env.DB.prepare(
        "SELECT * FROM market_direct_upload WHERE owner=? AND operation=?",
      )
        .bind(owner, operation)
        .first<Upload>();
      return row
        ? row.request_hash === requestHash
          ? reply({ upload: view(row) }, 201)
          : failure("IDEMPOTENCY_CONFLICT", 409)
        : failure("UPLOAD_QUOTA", 429);
    }
    const match =
      /^\/v1\/uploads\/([0-9a-f-]{36})(?:\/(authorize|complete))?$/.exec(path);
    if (!match) return failure("NOT_FOUND", 404);
    let row = await owned(env, match[1], owner);
    if (!row) return failure("NOT_FOUND", 404);
    if (!match[2] && request.method === "GET")
      return reply({ upload: view(row) });
    if (request.method !== "POST") return failure("NOT_FOUND", 404);
    if (row.expires_at <= Date.now() || row.state === "expired")
      return failure("UPLOAD_EXPIRED", 410);
    const operation = request.headers.get("idempotency-key") ?? "";
    if (!uuid.test(operation)) return failure("IDEMPOTENCY_KEY", 400);
    const data = await body(request);
    const expectedVersion = row.row_version;
    const replay =
      (match[2] === "authorize" ? row.authorize_key : row.complete_key) ===
      operation;
    if (!replay && request.headers.get("if-match") !== `"${expectedVersion}"`)
      return failure("ROW_VERSION", 412);
    if (match[2] === "authorize") {
      if (
        Object.keys(data).some((k) => !["length", "sha256"].includes(k)) ||
        !Number.isSafeInteger(data.length) ||
        Number(data.length) < 1 ||
        Number(data.length) > MARKET_LIMITS.archive ||
        typeof data.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(data.sha256)
      )
        return failure("INVALID_BODY", 400);
      if (row.state !== "reserved") return failure("UPLOAD_SEALED", 409);
      if (
        row.authorize_key &&
        (row.authorize_key !== operation ||
          row.length !== data.length ||
          row.sha256 !== data.sha256)
      )
        return failure("IDEMPOTENCY_CONFLICT", 409);
      if (!(await budget(env, "signatures", 256)))
        return failure("UPLOAD_QUOTA", 429);
      await env.DB.prepare(
        "UPDATE market_direct_upload SET length=?,sha256=?,authorize_key=?,row_version=row_version+1 WHERE id=? AND row_version=? AND authorize_key IS NULL AND state='reserved' AND complete_key IS NULL AND (SELECT coalesce(sum(length),0) FROM market_direct_upload WHERE cleaned=0)+?<=?",
      )
        .bind(
          data.length,
          data.sha256,
          operation,
          row.id,
          row.row_version,
          data.length,
          MARKET_LIMITS.storage,
        )
        .run();
      row = (await owned(env, row.id, owner))!;
      if (
        row.authorize_key !== operation &&
        row.row_version !== expectedVersion
      )
        return failure("ROW_VERSION", 412);
      if (!row.authorize_key) return failure("UPLOAD_QUOTA", 429);
      if (
        row.authorize_key !== operation ||
        row.length !== data.length ||
        row.sha256 !== data.sha256
      )
        return failure("IDEMPOTENCY_CONFLICT", 409);
      return reply({
        upload: view(row),
        authorization: await authorizePut(env, row),
      });
    }
    if (Object.keys(data).length) return failure("INVALID_BODY", 400);
    if (!row.authorize_key) return failure("UPLOAD_NOT_AUTHORIZED", 409);
    if (row.complete_key && row.complete_key !== operation)
      return failure("IDEMPOTENCY_CONFLICT", 409);
    await env.DB.prepare(
      "UPDATE market_direct_upload SET complete_key=?,row_version=row_version+1 WHERE id=? AND row_version=? AND complete_key IS NULL AND state='reserved' AND expires_at>?",
    )
      .bind(operation, row.id, row.row_version, Date.now())
      .run();
    row = (await owned(env, row.id, owner))!;
    if (row.complete_key !== operation)
      return failure(
        row.row_version !== expectedVersion
          ? "ROW_VERSION"
          : "IDEMPOTENCY_CONFLICT",
        row.row_version !== expectedVersion ? 412 : 409,
      );
    if (!["valid", "invalid"].includes(row.state)) {
      const response = await env.FREE_RUNTIME.getByName(
        "free-runtime-v1",
      ).fetch("https://runtime/validate", {
        method: "POST",
        body: JSON.stringify({ id: row.id }),
      });
      if (!response.ok)
        return failure(
          response.status === 429 ? "RUNTIME_QUOTA" : "VALIDATION_RETRY",
          response.status === 429 ? 429 : 503,
        );
      row = (await owned(env, row.id, owner))!;
    }
    return row.state === "invalid"
      ? reply(
          {
            upload: view(row),
            error: {
              code: row.validation_error,
              message: row.validation_error,
              retryable: false,
            },
          },
          422,
        )
      : reply({ upload: view(row) }, row.state === "valid" ? 200 : 202);
  } catch (e) {
    if (
      e instanceof SyntaxError ||
      (e instanceof Error && e.message === "INVALID_BODY")
    )
      return failure("INVALID_BODY", 400);
    if (e instanceof Error && e.message === "BODY_TOO_LARGE")
      return failure("BODY_TOO_LARGE", 413);
    if (e instanceof Error && e.message === "UPLOAD_EXPIRED")
      return failure("UPLOAD_EXPIRED", 410);
    return failure("UPLOAD_UNAVAILABLE", 503);
  }
}
