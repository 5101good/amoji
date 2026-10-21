import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import {
  convertV4MiniflareOptions,
  migrateUploads,
} from "./runtime-fixture.mjs";
import { hash } from "./upload-fixtures.mjs";
export async function fixture(t, serviceBindings = {}) {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: "flow",
          serviceBindings,
          modules: true,
          script: await readFile(
            new URL("../dist/worker.js", import.meta.url),
            "utf8",
          ),
          compatibilityDate: "2026-09-21",
          compatibilityFlags: ["nodejs_compat"],
          d1Databases: { DB: "flow" },
          r2Buckets: { UPLOADS: "flow" },
          bindings: {
            APP_ORIGIN: "http://localhost",
            LOCAL_TEST: "true",
            BETTER_AUTH_SECRET: "synthetic-test-secret-at-least-32-bytes",
          },
        },
      ],
    }),
  );
  t.after(() => mf.dispose());
  const db = await mf.getD1Database("DB");
  for (const sql of (
    await readFile(
      new URL("../migrations/0001-auth.sql", import.meta.url),
      "utf8",
    )
  )
    .split(";")
    .filter((x) => x.trim()))
    await db.prepare(sql).run();
  await migrateUploads(db);
  const migration = await readFile(
    new URL("../migrations/0005-creator-submissions.sql", import.meta.url),
    "utf8",
  );
  for (const statement of migration
    .split(/;\n(?=CREATE)/)
    .filter((s) => s.trim()))
    await db.prepare(statement).run();
  const reviewMigration = await readFile(
    new URL("../migrations/0006-review-publish.sql", import.meta.url),
    "utf8",
  );
  for (const statement of reviewMigration
    .split(/;\n(?=CREATE)/)
    .filter((s) => s.trim()))
    await db.prepare(statement).run();
  for (const name of [
    "0007-device-authorizations.sql",
    "0008-moderation-lifecycle.sql",
    "0009-official-catalog.sql",
  ]) {
    const migration = await readFile(
      new URL("../migrations/" + name, import.meta.url),
      "utf8",
    );
    for (const statement of migration
      .split(/;\n(?=CREATE|ALTER|DROP)/)
      .filter((s) => s.trim()))
      await db.prepare(statement).run();
  }
  async function post(
    path,
    data,
    cookie,
    operation = crypto.randomUUID(),
    extra = {},
  ) {
    const csrf = await (
      await mf.dispatchFetch("http://localhost/v1/auth/csrf", {
        headers: { cookie },
      })
    ).json();
    let rowHeaders = {};
    if (/\/(authorize|complete)$/.test(path)) {
      const current = await (
        await mf.dispatchFetch(
          "http://localhost" + path.replace(/\/(authorize|complete)$/, ""),
          { headers: { cookie } },
        )
      ).json();
      rowHeaders = { "if-match": `"${current.upload?.row_version}"` };
    }
    return mf.dispatchFetch("http://localhost" + path, {
      method: "POST",
      headers: {
        cookie,
        origin: "http://localhost",
        "content-type": "application/json",
        "x-csrf-token": csrf.csrf,
        "idempotency-key": operation,
        ...rowHeaders,
        ...extra,
      },
      body: JSON.stringify(data),
    });
  }
  async function register(email) {
    const r = await post(
      "/v1/auth/register",
      { email, name: "Creator", password: "synthetic-password-12345" },
      "",
    );
    assert.equal(r.status, 200, await r.clone().text());
    return r.headers.getSetCookie()[0].split(";")[0];
  }
  const cookie = await register("one@example.test"),
    bucket = await mf.getR2Bucket("UPLOADS");
  async function reserve(data = {}, key = crypto.randomUUID()) {
    const r = await post("/v1/uploads", data, cookie, key);
    assert.equal(r.status, 201, await r.clone().text());
    return (await r.json()).upload;
  }
  async function authorize(u, bytes, key = crypto.randomUUID()) {
    const r = await post(
      `/v1/uploads/${u.id}/authorize`,
      { length: bytes.length, sha256: hash(bytes) },
      cookie,
      key,
    );
    assert.equal(r.status, 200, await r.clone().text());
    return (await r.json()).authorization;
  }
  async function put(authorization, bytes) {
    const key = new URL(authorization.url).pathname
      .split("/")
      .slice(2)
      .join("/");
    await bucket.put(key, bytes, {
      httpMetadata: { contentType: "application/zip" },
    });
    return key;
  }
  return { mf, db, bucket, post, cookie, register, reserve, authorize, put };
}
