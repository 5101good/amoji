import { DurableObject } from "cloudflare:workers";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { validateArchive } from "./market-validator";
import { cleanupUploads } from "./uploads";
import {
  digest,
  readBytes,
  type Upload,
  type UploadEnv,
} from "./upload-shared";
/** One SQLite DO serializes all heavy jobs, including cleanup, within this application. */
export class FreeRuntime extends DurableObject<UploadEnv> {
  constructor(ctx: DurableObjectState, env: UploadEnv) {
    super(ctx, env);
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS budget(day INTEGER NOT NULL,kind TEXT NOT NULL,count INTEGER NOT NULL,PRIMARY KEY(day,kind))",
    );
  }
  private permitted(kind: string, max: number) {
    const day = Math.floor(Date.now() / 86400000);
    this.ctx.storage.sql.exec("DELETE FROM budget WHERE day<?", day - 31);
    const rows = [
      ...this.ctx.storage.sql.exec<{ count: number }>(
        "INSERT INTO budget(day,kind,count) VALUES(?,?,1) ON CONFLICT(day,kind) DO UPDATE SET count=count+1 RETURNING count",
        day,
        kind,
      ),
    ];
    return rows[0].count <= max;
  }
  private tail: Promise<unknown> = Promise.resolve();
  private queued = 0;
  fetch(request: Request): Promise<Response> {
    if (this.queued >= 8)
      return Promise.resolve(new Response(null, { status: 429 }));
    this.queued++;
    const work = this.tail
      .then(() => this.handle(request))
      .finally(() => {
        this.queued--;
      });
    this.tail = work.catch(() => {});
    return work;
  }
  private async handle(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (request.method !== "POST") return new Response(null, { status: 404 });
    try {
      if (path === "/cleanup") {
        await cleanupUploads(this.env);
        return Response.json({ ok: true });
      }
      const data = JSON.parse(
        new TextDecoder().decode(await readBytes(request.body, 4096)),
      );
      if (path === "/password") {
        if (
          typeof data.password !== "string" ||
          data.password.length > 128 ||
          !["hash", "verify"].includes(data.mode)
        )
          return new Response(null, { status: 400 });
        if (!this.permitted("passwords", 2000))
          return new Response(null, { status: 429 });
        const salt =
          data.mode === "hash"
            ? randomBytes(16).toString("hex")
            : String(data.hash ?? "").split(":")[0];
        if (
          !/^[a-f0-9]{32}$/.test(salt) ||
          (data.mode === "verify" &&
            !/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(String(data.hash)))
        )
          return Response.json({ value: false });
        const key = scryptSync(data.password.normalize("NFKC"), salt, 64, {
          N: 16384,
          r: 16,
          p: 1,
          maxmem: 64 * 1024 * 1024,
        });
        const value =
          data.mode === "hash"
            ? `${salt}:${key.toString("hex")}`
            : timingSafeEqual(key, Buffer.from(data.hash.split(":")[1], "hex"));
        return Response.json({ value });
      }
      if (path !== "/validate" || typeof data.id !== "string")
        return new Response(null, { status: 404 });
      const row = await this.env.DB.prepare(
        "SELECT * FROM market_direct_upload WHERE id=?",
      )
        .bind(data.id)
        .first<Upload>();
      if (
        !row ||
        !row.complete_key ||
        !row.length ||
        !row.sha256 ||
        row.expires_at <= Date.now() ||
        !this.env.UPLOADS
      )
        return new Response(null, { status: 409 });
      if (["valid", "invalid"].includes(row.state))
        return Response.json({ ok: true });
      if (!this.permitted("validations", 128))
        return new Response(null, { status: 429 });
      // Recovery first uses the server-only object. A replay can only overwrite staging.
      let object = await this.env.UPLOADS.get(row.sealed_key);
      if (!object) {
        const head = await this.env.UPLOADS.head(row.object_key);
        if (!head) return new Response(null, { status: 409 });
        if (
          head.size !== row.length ||
          head.httpMetadata?.contentType !== "application/zip"
        )
          return this.reject(row, "ARCHIVE_METADATA");
        const source = await this.env.UPLOADS.get(row.object_key, {
          onlyIf: { etagMatches: head.etag },
        });
        if (!source || !("body" in source))
          return new Response(null, { status: 409 });
        const bytes = await readBytes(source.body, row.length);
        if (bytes.length !== row.length || (await digest(bytes)) !== row.sha256)
          return this.reject(row, "ARCHIVE_INTEGRITY");
        await this.env.DB.prepare(
          "UPDATE market_direct_upload SET state='uploaded',row_version=row_version+1 WHERE id=? AND state='reserved'",
        )
          .bind(row.id)
          .run();
        await this.env.UPLOADS.put(row.sealed_key, bytes, {
          onlyIf: { etagDoesNotMatch: "*" },
          httpMetadata: { contentType: "application/zip" },
          customMetadata: { sha256: row.sha256, upload: row.id },
        });
        object = await this.env.UPLOADS.get(row.sealed_key);
      }
      if (!object || object.size !== row.length)
        return new Response(null, { status: 503 });
      const bytes = await readBytes(object.body, row.length);
      if (bytes.length !== row.length || (await digest(bytes)) !== row.sha256)
        return this.reject(row, "SEALED_INTEGRITY");
      await this.env.DB.prepare(
        "UPDATE market_direct_upload SET state='validating',row_version=row_version+1 WHERE id=? AND state IN ('reserved','uploaded','validating')",
      )
        .bind(row.id)
        .run();
      let result;
      try {
        result = validateArchive(bytes, row);
      } catch (error) {
        return this.reject(
          row,
          error instanceof Error && /^[A-Z_]+$/.test(error.message)
            ? error.message
            : "ARCHIVE_INVALID",
        );
      }
      const updated = await this.env.DB.prepare(
        "UPDATE market_direct_upload SET state='valid',row_version=row_version+1,manifest_sha256=?,validation_error=NULL WHERE id=? AND state='validating' AND expires_at>?",
      )
        .bind(result.manifest_sha256, row.id, Date.now())
        .run();
      // Only bounded nonsecret metrics. Date.now is wall time, never represented as CPU.
      console.info(
        JSON.stringify({
          operation: "trusted_validation",
          upload_id: row.id,
          wasm_linear_memory_bytes: result.wasm_linear_memory_bytes,
          entries: result.entries,
        }),
      );
      return Response.json({ ok: updated.meta.changes === 1 });
    } catch {
      return new Response(null, { status: 503 });
    }
  }
  private async reject(row: Upload, code: string) {
    await this.env.DB.prepare(
      "UPDATE market_direct_upload SET state='invalid',row_version=row_version+1,validation_error=? WHERE id=? AND state IN ('reserved','uploaded','validating')",
    )
      .bind(code, row.id)
      .run();
    return Response.json({ ok: true });
  }
}
