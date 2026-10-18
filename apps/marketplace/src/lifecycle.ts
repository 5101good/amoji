import {
  body,
  digest,
  failure,
  reply,
  uuid,
  type UploadEnv,
} from "./upload-shared";
import { pageQuery, nextCursor } from "./reviews";
type LifeEnv = UploadEnv & { BETTER_AUTH_SECRET: string };
const roles = ["creator", "reviewer", "moderator", "admin"];
const hash = (s: string) => digest(new TextEncoder().encode(s));
const reason = (v: unknown): v is string =>
  typeof v === "string" &&
  !!v.trim() &&
  new TextEncoder().encode(v).length <= 2048;
const allowed = (data: Record<string, unknown>, keys: string[]) =>
  Object.keys(data).every((k) => keys.includes(k));
export async function lifecycleRoute(
  request: Request,
  env: LifeEnv,
  actor: string | null,
  anonymous: string,
) {
  const path = new URL(request.url).pathname,
    url = new URL(request.url);
  try {
    const account = actor
      ? await env.DB.prepare(
          "SELECT * FROM market_account WHERE id=? AND disabled=0 AND deleted_at IS NULL",
        )
          .bind(actor)
          .first<any>()
      : null;
    const admin = account?.role === "admin",
      moderator = admin || account?.role === "moderator";
    if (path.startsWith("/v1/admin/") && !admin)
      return failure("FORBIDDEN", 403);
    if (path.startsWith("/v1/review/reports") && !moderator)
      return failure("FORBIDDEN", 403);
    if (request.method === "GET") {
      if (path === "/v1/revocations") {
        let seq = 0,
          at = Date.now();
        const after = url.searchParams.get("after");
        if (after) {
          try {
            const c = JSON.parse(atob(after));
            if (
              !Number.isSafeInteger(c.seq) ||
              c.seq < 0 ||
              !Number.isSafeInteger(c.at) ||
              c.at > Date.now()
            )
              throw Error();
            seq = c.seq;
            at = c.at;
          } catch {
            return failure("INVALID_CURSOR", 400);
          }
          if (at < Date.now() - 30 * 86400000)
            return reply(
              {
                error: {
                  code: "CURSOR_EXPIRED",
                  message: "CURSOR_EXPIRED",
                  retryable: false,
                },
                full_reconcile: true,
              },
              410,
            );
        }
        const rows = (
          await env.DB.prepare(
            "SELECT seq,pack_id,release_id,archive_sha256,state,reason_code FROM market_revocation WHERE seq>? ORDER BY seq LIMIT 51",
          )
            .bind(seq)
            .all<any>()
        ).results;
        const page = rows.slice(0, 50);
        return reply({
          revocations: page,
          cursor: btoa(
            JSON.stringify({
              seq: page.at(-1)?.seq ?? seq,
              at: rows.length > 50 ? at : Date.now(),
            }),
          ),
          has_more: rows.length > 50,
          last_checked_at: new Date().toISOString(),
        });
      }
      const receipt = /^\/v1\/reports\/([0-9a-f-]{36})\/receipt$/.exec(path);
      if (receipt) {
        const token = request.headers.get("x-receipt-token") ?? "";
        if (!/^[a-f0-9]{64}$/.test(token)) return failure("NOT_FOUND", 404);
        const row = await env.DB.prepare(
          "SELECT id,state,resolution,updated_at FROM market_report WHERE id=? AND receipt_hash=?",
        )
          .bind(receipt[1], await hash(token))
          .first();
        return row ? reply({ receipt: row }) : failure("NOT_FOUND", 404);
      }
      if (path === "/v1/admin/accounts" || path === "/v1/review/reports") {
        const { limit, cursor } = pageQuery(url);
        const isAdmin = path.includes("/admin/");
        const rows = (
          await env.DB.prepare(
            isAdmin
              ? "SELECT id,display_name,role,disabled,row_version,0 AS created_at FROM market_account WHERE id>? ORDER BY id LIMIT ?"
              : "SELECT id,pack_id,release_id,reason,state,resolution,row_version,created_at,updated_at FROM market_report WHERE (created_at<? OR (created_at=? AND id<?)) ORDER BY created_at DESC,id DESC LIMIT ?",
          )
            .bind(
              ...(isAdmin
                ? [cursor?.id ?? "", limit + 1]
                : [
                    cursor?.time ?? Number.MAX_SAFE_INTEGER,
                    cursor?.time ?? Number.MAX_SAFE_INTEGER,
                    cursor?.id ?? "",
                    limit + 1,
                  ]),
            )
            .all<any>()
        ).results;
        return reply({
          [isAdmin ? "accounts" : "reports"]: rows.slice(0, limit),
          cursor: nextCursor(rows, limit, "created_at", "id"),
        });
      }
      if (path === "/v1/me/deletion-policy" && account)
        return reply({
          policy_version: "1",
          private_data_days: 30,
          retained: [
            "public-license-and-attribution",
            "necessary-audit-up-to-180-days",
          ],
          downloads: "Existing and in-flight copies cannot be recalled.",
          row_version: account.row_version,
        });
      return failure("NOT_FOUND", 404);
    }
    if (request.method !== "POST") return failure("NOT_FOUND", 404);
    const key = request.headers.get("idempotency-key") ?? "";
    if (!uuid.test(key)) return failure("IDEMPOTENCY_KEY", 400);
    const data = await body(request),
      version = request.headers.get("if-match"),
      who = actor ?? anonymous;
    const requestHash = await hash(JSON.stringify([data, version]));
    const replay = async () => {
      const r = await env.DB.prepare(
        "SELECT request_hash,status,result FROM market_lifecycle_operation WHERE actor=? AND route=? AND operation=?",
      )
        .bind(who, path, key)
        .first<any>();
      return r
        ? r.request_hash === requestHash
          ? reply(
              {
                ...JSON.parse(r.result),
                ...(path === "/v1/reports"
                  ? {
                      receipt_token: await hash(
                        env.BETTER_AUTH_SECRET + ":receipt:" + who + ":" + key,
                      ),
                    }
                  : {}),
              },
              r.status,
            )
          : failure("IDEMPOTENCY_CONFLICT", 409)
        : null;
    };
    const old = await replay();
    if (old) return old;
    const now = Date.now(),
      marker = crypto.randomUUID();
    let result: any,
      status = 200,
      guard = "",
      params: any[] = [],
      statements: D1PreparedStatement[] = [],
      previous = "",
      next = "",
      entity = "",
      auditReason = "";
    if (path === "/v1/reports") {
      if (
        !allowed(data, ["pack_id", "release_id", "reason"]) ||
        !uuid.test(String(data.pack_id)) ||
        !uuid.test(String(data.release_id)) ||
        !reason(data.reason)
      )
        return failure("INVALID_REPORT", 422);
      if (
        !(await env.DB.prepare(
          "SELECT 1 FROM market_public_release WHERE pack_id=? AND release_id=?",
        )
          .bind(data.pack_id, data.release_id)
          .first())
      )
        return failure("NOT_FOUND", 404);
      const token = await hash(
          env.BETTER_AUTH_SECRET + ":receipt:" + who + ":" + key,
        ),
        id = crypto.randomUUID();
      statements.push(
        env.DB.prepare(
          "INSERT INTO market_report(id,pack_id,release_id,receipt_hash,reason,created_at,updated_at,last_operation) VALUES(?,?,?,?,?,?,?,?)",
        ).bind(
          id,
          data.pack_id,
          data.release_id,
          await hash(token),
          data.reason,
          now,
          now,
          marker,
        ),
      );
      guard =
        "EXISTS(SELECT 1 FROM market_report WHERE id=? AND last_operation=?)";
      params = [id, marker];
      result = { report_id: id };
      status = 201;
    } else {
      if (!account) return failure("UNAUTHENTICATED", 401);
      const role = /^\/v1\/admin\/accounts\/([0-9a-f-]{36})\/roles$/.exec(path),
        resolve = /^\/v1\/review\/reports\/([0-9a-f-]{36})\/resolve$/.exec(
          path,
        ),
        remove = /^\/v1\/packs\/([0-9a-f-]{36})\/unpublish$/.exec(path);
      if (role) {
        if (
          !allowed(data, ["role", "reason"]) ||
          !roles.includes(String(data.role)) ||
          !reason(data.reason)
        )
          return failure("INVALID_ROLE", 422);
        const target = await env.DB.prepare(
          "SELECT * FROM market_account WHERE id=? AND deleted_at IS NULL",
        )
          .bind(role[1])
          .first<any>();
        if (!target) return failure("NOT_FOUND", 404);
        if (version !== `"${target.row_version}"`)
          return failure("ROW_VERSION", 412);
        statements.push(
          env.DB.prepare(
            "UPDATE market_account SET role=?,row_version=row_version+1,last_operation=? WHERE id=? AND row_version=? AND deleted_at IS NULL AND EXISTS(SELECT 1 FROM market_account WHERE id=? AND role='admin' AND disabled=0 AND deleted_at IS NULL)",
          ).bind(data.role, marker, target.id, target.row_version, actor),
        );
        guard =
          "EXISTS(SELECT 1 FROM market_account WHERE id=? AND last_operation=?)";
        params = [target.id, marker];
        result = {
          account: {
            id: target.id,
            role: data.role,
            row_version: target.row_version + 1,
          },
        };
        entity = target.id;
        previous = target.role;
        next = String(data.role);
        auditReason = data.reason;
      } else if (resolve) {
        if (!allowed(data, ["reason"]) || !reason(data.reason))
          return failure("INVALID_REASON", 422);
        const r = await env.DB.prepare("SELECT * FROM market_report WHERE id=?")
          .bind(resolve[1])
          .first<any>();
        if (!r) return failure("NOT_FOUND", 404);
        if (version !== `"${r.row_version}"`)
          return failure("ROW_VERSION", 412);
        if (r.state !== "open") return failure("REPORT_STATE", 409);
        statements.push(
          env.DB.prepare(
            "UPDATE market_report SET state='resolved',resolution=?,row_version=row_version+1,updated_at=?,last_operation=? WHERE id=? AND row_version=? AND state='open' AND EXISTS(SELECT 1 FROM market_account WHERE id=? AND disabled=0 AND role IN ('admin','moderator'))",
          ).bind(data.reason, now, marker, r.id, r.row_version, actor),
        );
        guard =
          "EXISTS(SELECT 1 FROM market_report WHERE id=? AND last_operation=?)";
        params = [r.id, marker];
        result = {
          receipt: {
            id: r.id,
            state: "resolved",
            resolution: data.reason,
            row_version: r.row_version + 1,
          },
        };
        entity = r.id;
        previous = r.state;
        next = "resolved";
        auditReason = data.reason;
      } else if (remove) {
        if (
          !allowed(data, ["release_id", "type", "reason"]) ||
          !uuid.test(String(data.release_id)) ||
          !["unpublished", "safety_removed"].includes(String(data.type)) ||
          !reason(data.reason)
        )
          return failure("INVALID_REMOVAL", 422);
        const r = await env.DB.prepare(
          "SELECT r.*,p.owner FROM market_public_release r JOIN market_upload_pack p ON p.id=r.pack_id WHERE r.pack_id=? AND r.release_id=?",
        )
          .bind(remove[1], data.release_id)
          .first<any>();
        if (!r) return failure("NOT_FOUND", 404);
        if (
          (r.owner !== actor && !moderator) ||
          (data.type === "safety_removed" && !moderator)
        )
          return failure("FORBIDDEN", 403);
        if (version !== `"${r.row_version}"`)
          return failure("ROW_VERSION", 412);
        if (r.state === "safety_removed") return failure("SAFETY_STICKY", 409);
        statements.push(
          env.DB.prepare(
            "UPDATE market_public_release SET state=?,row_version=row_version+1,removal_reason=?,removed_at=?,last_operation=? WHERE release_id=? AND row_version=? AND state!='safety_removed' AND EXISTS(SELECT 1 FROM market_account a WHERE a.id=? AND a.disabled=0 AND ((a.role IN ('admin','moderator')) OR (?='unpublished' AND EXISTS(SELECT 1 FROM market_upload_pack p WHERE p.id=market_public_release.pack_id AND p.owner=a.id))))",
          ).bind(
            data.type,
            data.reason,
            now,
            marker,
            r.release_id,
            r.row_version,
            actor,
            data.type,
          ),
        );
        guard =
          "EXISTS(SELECT 1 FROM market_public_release WHERE release_id=? AND last_operation=?)";
        params = [r.release_id, marker];
        statements.push(
          env.DB.prepare(
            `INSERT OR IGNORE INTO market_revocation(pack_id,release_id,archive_sha256,state,reason_code,created_at) SELECT ?,?,?,?,?,? WHERE ${guard}`,
          ).bind(
            r.pack_id,
            r.release_id,
            r.archive_sha256,
            data.type,
            data.type === "safety_removed" ? "safety" : "author",
            now,
            ...params,
          ),
        );
        result = {
          release: {
            pack_id: r.pack_id,
            release_id: r.release_id,
            state: data.type,
            row_version: r.row_version + 1,
          },
          existing_copies_recalled: false,
        };
        entity = r.release_id;
        previous = r.state;
        next = String(data.type);
        auditReason = data.reason;
      } else if (/^\/v1\/me\/submissions\/[0-9a-f-]{36}\/delete$/.test(path)) {
        if (!allowed(data, [])) return failure("INVALID_BODY", 400);
        const id = path.split("/")[4];
        const s = await env.DB.prepare(
          "SELECT * FROM market_submission WHERE id=? AND owner=?",
        )
          .bind(id, actor)
          .first<any>();
        if (!s) return failure("NOT_FOUND", 404);
        if (version !== `"${s.row_version}"`)
          return failure("ROW_VERSION", 412);
        if (!["withdrawn", "changes_requested"].includes(s.state))
          return failure("SUBMISSION_STATE", 409);
        statements.push(
          env.DB.prepare(
            "UPDATE market_submission SET row_version=row_version+1,last_operation=?,reason=NULL WHERE id=? AND owner=? AND row_version=? AND state IN ('withdrawn','changes_requested') AND NOT EXISTS(SELECT 1 FROM market_public_release r WHERE r.submission_id=market_submission.id) AND EXISTS(SELECT 1 FROM market_account WHERE id=? AND disabled=0)",
          ).bind(marker, s.id, actor, s.row_version, actor),
        );
        guard =
          "EXISTS(SELECT 1 FROM market_submission WHERE id=? AND last_operation=?)";
        params = [s.id, marker];
        statements.push(
          env.DB.prepare(
            `DELETE FROM market_direct_upload_reference WHERE upload_id=? AND reference_id=? AND ${guard}`,
          ).bind(s.upload_id, s.id, ...params),
        );
        statements.push(
          env.DB.prepare(
            `UPDATE market_direct_upload SET state='expired',expires_at=?,row_version=row_version+1 WHERE id=? AND NOT EXISTS(SELECT 1 FROM market_direct_upload_reference WHERE upload_id=market_direct_upload.id) AND ${guard}`,
          ).bind(now, s.upload_id, ...params),
        );
        result = { deleted: true, submission_id: s.id };
        entity = s.id;
        previous = s.state;
        next = "private-content-deleted";
        auditReason = "author-request";
      } else if (path === "/v1/me/delete") {
        if (
          !allowed(data, ["policy_version", "confirm"]) ||
          data.policy_version !== "1" ||
          data.confirm !== true
        )
          return failure("DELETION_DISCLOSURE_REQUIRED", 422);
        if (version !== `"${account.row_version}"`)
          return failure("ROW_VERSION", 412);
        statements.push(
          env.DB.prepare(
            "UPDATE market_account SET disabled=1,deleted_at=?,row_version=row_version+1,last_operation=? WHERE id=? AND disabled=0 AND row_version=?",
          ).bind(now, marker, actor, account.row_version),
        );
        guard =
          "EXISTS(SELECT 1 FROM market_account WHERE id=? AND last_operation=?)";
        params = [actor, marker];
        statements.push(
          env.DB.prepare(
            `DELETE FROM auth_session WHERE userId=? AND ${guard}`,
          ).bind(account.auth_user_id, ...params),
        );
        statements.push(
          env.DB.prepare(
            `UPDATE market_device_family SET revoked=1 WHERE owner=? AND ${guard}`,
          ).bind(actor, ...params),
        );
        statements.push(
          env.DB.prepare(
            `UPDATE market_submission SET state='withdrawn',row_version=row_version+1,updated_at=? WHERE owner=? AND state='pending' AND ${guard}`,
          ).bind(now, actor, ...params),
        );
        statements.push(
          env.DB.prepare(
            `INSERT OR IGNORE INTO market_revocation(pack_id,release_id,archive_sha256,state,reason_code,created_at) SELECT r.pack_id,r.release_id,r.archive_sha256,'unpublished','account_deleted',? FROM market_public_release r JOIN market_upload_pack p ON p.id=r.pack_id WHERE p.owner=? AND r.state='published' AND ${guard}`,
          ).bind(now, actor, ...params),
        );
        statements.push(
          env.DB.prepare(
            `UPDATE market_public_release SET state='unpublished',row_version=row_version+1,removal_reason='account_deleted',removed_at=? WHERE state='published' AND pack_id IN (SELECT id FROM market_upload_pack WHERE owner=?) AND ${guard}`,
          ).bind(now, actor, ...params),
        );
        result = {
          deleted: true,
          private_data_cleanup_by: new Date(now + 30 * 86400000).toISOString(),
          retained: [
            "public-license-and-attribution",
            "necessary-audit-up-to-180-days",
          ],
        };
        entity = actor!;
        previous = "active";
        next = "deleted";
        auditReason = "policy-v1-confirmed";
      } else return failure("NOT_FOUND", 404);
    }
    if (entity)
      statements.push(
        env.DB.prepare(
          `INSERT INTO market_lifecycle_audit(id,actor,entity,previous_state,next_state,reason,request_id,created_at) SELECT ?,?,?,?,?,?,?,? WHERE ${guard}`,
        ).bind(
          marker,
          who,
          entity,
          previous,
          next,
          auditReason,
          key,
          now,
          ...params,
        ),
      );
    statements.push(
      env.DB.prepare(
        `INSERT INTO market_lifecycle_operation(actor,route,operation,request_hash,status,result,created_at) SELECT ?,?,?,?,?,?,? WHERE ${guard}`,
      ).bind(
        who,
        path,
        key,
        requestHash,
        status,
        JSON.stringify(result),
        now,
        ...params,
      ),
    );
    try {
      await env.DB.batch(statements);
    } catch (e) {
      const again = await replay();
      if (again) return again;
      return failure(
        String(e).includes("LAST_ADMIN")
          ? "LAST_ADMIN"
          : "LIFECYCLE_UNAVAILABLE",
        String(e).includes("LAST_ADMIN") ? 409 : 503,
      );
    }
    return (await replay()) ?? failure("ROW_VERSION", 412);
  } catch (e) {
    return failure(
      String(e).includes("INVALID_QUERY")
        ? "INVALID_QUERY"
        : "LIFECYCLE_UNAVAILABLE",
      String(e).includes("INVALID_QUERY") ? 400 : 503,
    );
  }
}
