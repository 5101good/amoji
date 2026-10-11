import { runBackup } from "./backup";
import { cleanupLifecycle } from "./retention";
import marketApi from "./market-api";
import type { Env } from "./worker";
import { DurableObject } from "cloudflare:workers";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { validateArchive } from "./market-validator";
import { cleanupUploads } from "./uploads";
import { digest, failure, readBytes, type Upload } from "./upload-shared";
/** One SQLite DO serializes all heavy jobs, including cleanup, within this application. */
export class FreeRuntime extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
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
  private reading = 0;
  private metadataReading = 0;
  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    // Metadata does not run archive decoding/password hashing. Its atomic D1
    // rate limit still applies, while slow mutations retain the bounded queue.
    if (request.method === "GET" && /^\/v1\/packs(?:\/[0-9a-f-]{36}(?:\/releases\/[0-9a-f-]{36})?)?$/.test(path)) {
      if (this.metadataReading >= 64) return failure("RUNTIME_BUSY", 429);
      this.metadataReading++;
      try { return await this.handle(request); } finally { this.metadataReading--; }
    }
    if (new URL(request.url).pathname.startsWith("/v1/") && request.body) {
      if (this.reading >= 8) return failure("RUNTIME_BUSY", 429);
      this.reading++;
      try {
        request = new Request(request, {
          body: await this.controlBody(request.body),
        });
      } catch (error) {
        return failure(
          error instanceof Error && error.message === "BODY_TIMEOUT"
            ? "BODY_TIMEOUT"
            : "BODY_TOO_LARGE",
          error instanceof Error && error.message === "BODY_TIMEOUT"
            ? 408
            : 413,
        );
      } finally {
        this.reading--;
      }
    }
    if (this.queued >= 8) return failure("RUNTIME_BUSY", 429);
    this.queued++;
    const work = this.tail
      .then(() => this.handle(request))
      .finally(() => {
        this.queued--;
      });
    this.tail = work.catch(() => {});
    return work;
  }
  private async controlBody(stream: ReadableStream<Uint8Array>) {
    const reader = stream.getReader();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      const chunks: Uint8Array[] = [];
      let length = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > 8192) throw Error("BODY_TOO_LARGE");
        chunks.push(value);
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      return bytes;
    };
    try {
      return await Promise.race([
        read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(Error("BODY_TIMEOUT")), 5000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  private async handle(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path.startsWith("/v1/")) {
      // Already inside the serialized queue: private compute calls dispatch inline,
      // avoiding a recursive RPC to the object currently awaiting its response.
      const runtime = {
        getByName: () => ({
          fetch: (input: RequestInfo, init?: RequestInit) =>
            this.handle(new Request(input, init)),
        }),
      } as unknown as DurableObjectNamespace;
      return marketApi.fetch(request, { ...this.env, FREE_RUNTIME: runtime });
    }
    if (request.method !== "POST") return new Response(null, { status: 404 });
    try {
      if (path === "/backup") {
        await runBackup(this.env);
        return Response.json({ ok: true });
      }
      if (path === "/cleanup") {
        await cleanupLifecycle(this.env);
        await cleanupUploads(this.env);
        await this.env.DB.prepare(
          "DELETE FROM auth_rate_limit WHERE (key NOT LIKE 'public:%' AND key NOT LIKE 'device:%' AND key NOT LIKE 'report:%' AND bucket < ?) OR (key LIKE 'public:%' AND bucket < ?) OR ((key LIKE 'device:%' OR key LIKE 'report:%') AND bucket < ?)",
        )
          .bind(
            Math.floor(Date.now() / 900000) - 1,
            Math.floor(Date.now() / 60000) - 2,
            Math.floor(Date.now() / 3600000) - 1,
          )
          .run();
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
