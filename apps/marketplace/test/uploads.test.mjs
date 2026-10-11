import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import {
  convertV4MiniflareOptions,
  migrateUploads,
} from "./runtime-fixture.mjs";

test("HTTP upload reservation is owner-bound and never proxies image bodies", async () => {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: "upload",
          modules: true,
          script: await readFile(
            new URL("../dist/worker.js", import.meta.url),
            "utf8",
          ),
          compatibilityDate: "2026-09-21",
          compatibilityFlags: ["nodejs_compat"],
          d1Databases: { DB: "uploads" },
          r2Buckets: { UPLOADS: "uploads" },
          bindings: {
            LOCAL_TEST: "true",
            APP_ORIGIN: "http://localhost",
            BETTER_AUTH_SECRET: "local-test-secret-that-is-at-least-32-bytes",
          },
        },
      ],
    }),
  );
  try {
    const db = await mf.getD1Database("DB");
    for (const sql of (
      await readFile(
        new URL("../migrations/0001-auth.sql", import.meta.url),
        "utf8",
      )
    )
      .split(";")
      .filter((s) => s.trim()))
      await db.prepare(sql).run();
    await migrateUploads(db);
    let cookie = "";
    async function post(path, body, extra = {}) {
      const c = await mf.dispatchFetch("http://localhost/v1/auth/csrf", {
        headers: { cookie },
      });
      return mf.dispatchFetch("http://localhost" + path, {
        method: "POST",
        headers: {
          cookie,
          origin: "http://localhost",
          "content-type": "application/json",
          "x-csrf-token": (await c.json()).csrf,
          ...extra,
        },
        body: JSON.stringify(body),
      });
    }
    const registration = await post("/v1/auth/register", {
      email: "u@example.test",
      name: "User",
      password: "safe-password-12345",
    });
    assert.equal(registration.status, 200, await registration.clone().text());
    cookie = registration.headers.getSetCookie()[0].split(";")[0];
    const reserved = await post(
      "/v1/uploads",
      {},
      { "idempotency-key": crypto.randomUUID() },
    );
    assert.equal(reserved.status, 201, await reserved.clone().text());
    const { upload } = await reserved.json();
    assert.equal(upload.state, "reserved");
    assert.match(upload.release_id, /^[a-f0-9-]{36}$/);
    assert.equal(upload.version, 1);
    assert.equal(
      (
        await mf.dispatchFetch("http://localhost/v1/uploads/" + upload.id, {
          headers: { cookie: "" },
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await mf.dispatchFetch(
          "http://localhost/v1/uploads/" + upload.id + "/parts/1",
          { method: "PUT", headers: { cookie }, body: "image" },
        )
      ).status,
      404,
    );
  } finally {
    await mf.dispose();
  }
});
