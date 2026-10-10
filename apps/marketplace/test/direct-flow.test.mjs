import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import {
  convertV4MiniflareOptions,
  migrateUploads,
} from "./runtime-fixture.mjs";
import { archive, hash } from "./upload-fixtures.mjs";

async function fixture(t) {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: "flow",
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
  async function post(path, data, cookie, operation = crypto.randomUUID()) {
    const csrf = await (
      await mf.dispatchFetch("http://localhost/v1/auth/csrf", {
        headers: { cookie },
      })
    ).json();
    return mf.dispatchFetch("http://localhost" + path, {
      method: "POST",
      headers: {
        cookie,
        origin: "http://localhost",
        "content-type": "application/json",
        "x-csrf-token": csrf.csrf,
        "idempotency-key": operation,
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
test("HTTP direct authorization, immutable validation, replay isolation, idempotency and owner boundaries", async (t) => {
  const f = await fixture(t),
    key = crypto.randomUUID(),
    u = await f.reserve({}, key);
  assert.deepEqual(await f.reserve({}, key), u);
  const { bytes } = await archive(u),
    a = await f.authorize(u, bytes);
  const url = new URL(a.url);
  assert.equal(url.hostname, "a".repeat(32) + ".r2.cloudflarestorage.com");
  assert.equal(url.searchParams.get("X-Amz-Expires"), "300");
  assert.equal(a.method, "PUT");
  assert.match(url.pathname, /\/staging\//);
  const stage = await f.put(a, bytes),
    complete = crypto.randomUUID();
  const result = await f.post(
    `/v1/uploads/${u.id}/complete`,
    {},
    f.cookie,
    complete,
  );
  assert.equal(result.status, 200, await result.clone().text());
  const v = (await result.json()).upload;
  assert.equal(v.state, "valid");
  assert.match(v.manifest_sha256, /^[a-f0-9]{64}$/);
  await f.bucket.put(stage, "replayed changed bytes", {
    httpMetadata: { contentType: "application/zip" },
  });
  const retry = await f.post(
    `/v1/uploads/${u.id}/complete`,
    {},
    f.cookie,
    complete,
  );
  assert.equal(retry.status, 200);
  assert.deepEqual((await retry.json()).upload, v);
  const sealed = (await f.bucket.list({ prefix: "sealed/" })).objects;
  assert.equal(sealed.length, 1);
  assert.equal(
    hash(
      new Uint8Array(await (await f.bucket.get(sealed[0].key)).arrayBuffer()),
    ),
    hash(bytes),
  );
  assert.equal(
    (await f.post(`/v1/uploads/${u.id}/complete`, {}, f.cookie)).status,
    409,
  );
  const other = await f.register("two@example.test");
  assert.equal(
    (
      await f.mf.dispatchFetch("http://localhost/v1/uploads/" + u.id, {
        headers: { cookie: other },
      })
    ).status,
    404,
  );
  assert.equal(
    (await f.post(`/v1/uploads/${u.id}/complete`, {}, other)).status,
    404,
  );
  assert.equal(
    (await f.post("/v1/uploads", { pack_id: u.pack_id }, other)).status,
    404,
  );
  assert.equal(
    (
      await f.post(
        `/v1/uploads/${u.id}/authorize`,
        { length: bytes.length, sha256: hash(bytes) },
        f.cookie,
      )
    ).status,
    409,
  );
  const update = await f.reserve({ pack_id: u.pack_id });
  assert.equal(update.version, 2);
});
test("HTTP trusted validation rejects tamper, illegal action and unreferenced/path data", async (t) => {
  const f = await fixture(t);
  for (const options of [
    {
      mutate: (m) => (m.expressions[0].visual.primary.sha256 = "0".repeat(64)),
    },
    { mutate: (m) => (m.pack_id = crypto.randomUUID()) },
    { extra: { "unexpected.txt": new Uint8Array([1]) } },
  ]) {
    const u = await f.reserve(),
      { bytes } = await archive(u, options),
      a = await f.authorize(u, bytes);
    await f.put(a, bytes);
    const r = await f.post(`/v1/uploads/${u.id}/complete`, {}, f.cookie);
    assert.equal(r.status, 422, await r.clone().text());
    assert.equal((await r.json()).upload.state, "invalid");
  }
});
test("HTTP missing PUT resumes, concurrent complete agrees, quotas and expiry reject", async (t) => {
  const f = await fixture(t),
    u = await f.reserve(),
    { bytes } = await archive(u),
    a = await f.authorize(u, bytes),
    key = crypto.randomUUID();
  assert.equal(
    (await f.post(`/v1/uploads/${u.id}/complete`, {}, f.cookie, key)).status,
    503,
  );
  await f.put(a, bytes);
  const outcomes = await Promise.all([
    f.post(`/v1/uploads/${u.id}/complete`, {}, f.cookie, key),
    f.post(`/v1/uploads/${u.id}/complete`, {}, f.cookie, key),
  ]);
  for (const r of outcomes) {
    assert.equal(r.status, 200, await r.clone().text());
    assert.equal((await r.json()).upload.state, "valid");
  }
  for (let i = 0; i < 3; i++) await f.reserve();
  assert.equal((await f.post("/v1/uploads", {}, f.cookie)).status, 429);
});
test("HTTP Better Auth legacy hashes and NFKC remain compatible through the SQLite DO", async (t) => {
  const f = await fixture(t);
  const { hashPassword, verifyPassword } = await import("better-auth/crypto");
  const account = await f.db
    .prepare("SELECT password FROM auth_account")
    .first();
  assert.equal(
    await verifyPassword({
      hash: account.password,
      password: "synthetic-password-12345",
    }),
    true,
  );
  const legacy = await hashPassword("Å-safe-password-12345");
  await f.db.prepare("UPDATE auth_account SET password=?").bind(legacy).run();
  const result = await f.post(
    "/v1/auth/login",
    { email: "one@example.test", password: "Å-safe-password-12345" },
    "",
  );
  assert.equal(result.status, 200, await result.clone().text());
  assert.equal(
    (
      await f.post(
        "/v1/auth/login",
        { email: "one@example.test", password: "incorrect-password-12345" },
        "",
      )
    ).status,
    401,
  );
});
test("HTTP decoder rejects a GIF with bytes after its trailer", async (t) => {
  const f = await fixture(t),
    u = await f.reserve();
  // Independent two-frame 1x1 GIF; both frames are fully encoded, followed by bytes hidden after the trailer.
  const header = Buffer.from("47494638396101000100800000000000ffffff", "hex");
  const frame = Buffer.from(
    "21f90400010000002c0000000001000100000202440100",
    "hex",
  );
  const gif = Buffer.concat([
    header,
    frame,
    frame,
    Buffer.from([0x3b, 0x00, 0x3b]),
  ]);
  const { bytes } = await archive(u, {
    image: gif,
    mime: "image/gif",
    width: 1,
    height: 1,
    animated: true,
    duration: 20,
  });
  const a = await f.authorize(u, bytes);
  await f.put(a, bytes);
  const r = await f.post(`/v1/uploads/${u.id}/complete`, {}, f.cookie);
  assert.equal(r.status, 422, await r.clone().text());
  assert.equal((await r.json()).upload.validation_error, "MEDIA_INVALID");
});
test("HTTP strict ZIP compressed stream CRC and actual media formats are validated", async (t) => {
  const f = await fixture(t);
  const sharp = (await import("sharp")).default;
  for (const [format, mime] of [
    ["png", "image/png"],
    ["jpeg", "image/jpeg"],
    ["webp", "image/webp"],
  ]) {
    const image = await sharp({
      create: { width: 32, height: 24, channels: 3, background: "#4080ff" },
    })
      [format]()
      .toBuffer();
    const u = await f.reserve(),
      { bytes } = await archive(u, {
        image,
        mime,
        width: 32,
        height: 24,
        compression: 6,
      }),
      a = await f.authorize(u, bytes);
    await f.put(a, bytes);
    const r = await f.post(`/v1/uploads/${u.id}/complete`, {}, f.cookie);
    assert.equal(r.status, 200, await r.clone().text());
    assert.equal((await r.json()).upload.state, "valid");
  }
  const u = await f.reserve(),
    { bytes } = await archive(u);
  bytes[14] ^= 1;
  const a = await f.authorize(u, bytes);
  await f.put(a, bytes);
  const r = await f.post(`/v1/uploads/${u.id}/complete`, {}, f.cookie);
  assert.equal(r.status, 422);
  assert.equal((await r.json()).upload.validation_error, "ZIP_LOCAL");
});
test("HTTP actual digest mismatch, declaration over limits and server-owned roles are rejected", async (t) => {
  const f = await fixture(t),
    u = await f.reserve(),
    { bytes } = await archive(u),
    a = await f.authorize(u, bytes);
  bytes[bytes.length - 1] ^= 1;
  await f.put(a, bytes);
  const r = await f.post(`/v1/uploads/${u.id}/complete`, {}, f.cookie);
  assert.equal(r.status, 422);
  assert.equal((await r.json()).upload.validation_error, "ARCHIVE_INTEGRITY");
  const v = await f.reserve();
  assert.equal(
    (
      await f.post(
        `/v1/uploads/${v.id}/authorize`,
        { length: 10485761, sha256: "a".repeat(64) },
        f.cookie,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await f.post(
        "/v1/uploads",
        { state: "valid", owner: "another" },
        f.cookie,
      )
    ).status,
    400,
  );
});
test("HTTP animated GIF exact duration and frame budget are trusted, not uploader claims", async (t) => {
  const f = await fixture(t),
    header = Buffer.from("47494638396101000100800000000000ffffff", "hex"),
    frame = Buffer.from(
      "21f90400010000002c0000000001000100000202440100",
      "hex",
    );
  for (const [frames, duration, expected] of [
    [2, 20, 200],
    [60, 600, 200],
    [61, 610, 422],
    [2, 999, 422],
  ]) {
    const u = await f.reserve(),
      image = Buffer.concat([
        header,
        ...Array(frames).fill(frame),
        Buffer.from([0x3b]),
      ]),
      { bytes } = await archive(u, {
        image,
        mime: "image/gif",
        width: 1,
        height: 1,
        animated: true,
        duration,
      }),
      a = await f.authorize(u, bytes);
    await f.put(a, bytes);
    const r = await f.post(`/v1/uploads/${u.id}/complete`, {}, f.cookie);
    assert.equal(r.status, expected, await r.clone().text());
  }
});
test("HTTP market limits reject oversized manifests, expansion, entries, media and dimensions", async (t) => {
  const f = await fixture(t),
    { zipSync } = await import("fflate"),
    sharp = (await import("sharp")).default;
  const tooWide = await sharp({
    create: { width: 1025, height: 1, channels: 3, background: "#fff" },
  })
    .png()
    .toBuffer();
  const cases = [
    async (u) =>
      (await archive(u, { image: tooWide, width: 1025, height: 1 })).bytes,
    async () => zipSync({ "manifest.json": new Uint8Array(524289) }),
    async () =>
      zipSync(
        Object.fromEntries(
          Array.from({ length: 257 }, (_, i) => [
            "blobs/" + i.toString(16).padStart(64, "0"),
            new Uint8Array(0),
          ]),
        ),
      ),
    async () =>
      zipSync({
        "manifest.json": new Uint8Array([123, 125]),
        ["blobs/" + "a".repeat(64)]: new Uint8Array(1048577),
      }),
    async () =>
      zipSync({
        "manifest.json": new Uint8Array([123, 125]),
        ...Object.fromEntries(
          Array.from({ length: 16 }, (_, i) => [
            "blobs/" + i.toString(16).padStart(64, "0"),
            new Uint8Array(1048576),
          ]),
        ),
      }),
  ];
  for (const create of cases) {
    const u = await f.reserve(),
      bytes = await create(u),
      a = await f.authorize(u, bytes);
    await f.put(a, bytes);
    const r = await f.post(`/v1/uploads/${u.id}/complete`, {}, f.cookie);
    assert.equal(r.status, 422, await r.clone().text());
  }
});
test("HTTP expiry and scheduled garbage collection retain referenced immutable content", async (t) => {
  const f = await fixture(t),
    u = await f.reserve(),
    { bytes } = await archive(u),
    a = await f.authorize(u, bytes);
  await f.put(a, bytes);
  const completed = await f.post(`/v1/uploads/${u.id}/complete`, {}, f.cookie);
  assert.equal(completed.status, 200);
  // Seed external database state to model elapsed retention and a published reference.
  await f.db
    .prepare(
      "INSERT INTO market_direct_upload_reference(upload_id,reference_id) VALUES(?,?)",
    )
    .bind(u.id, "published-fixture")
    .run();
  await f.db
    .prepare("UPDATE market_direct_upload SET expires_at=0 WHERE id=?")
    .bind(u.id)
    .run();
  const v = await f.reserve(),
    vArchive = await archive(v),
    va = await f.authorize(v, vArchive.bytes);
  await f.put(va, vArchive.bytes);
  await f.db
    .prepare("UPDATE market_direct_upload SET expires_at=0 WHERE id=?")
    .bind(v.id)
    .run();
  assert.equal(
    (await f.post(`/v1/uploads/${v.id}/complete`, {}, f.cookie)).status,
    410,
  );
  const scheduled = await (
    await f.mf.getWorker()
  ).scheduled({ cron: "*/15 * * * *" });
  assert.equal(scheduled.outcome, "ok");
  const visible = await (
    await f.mf.dispatchFetch("http://localhost/v1/uploads/" + u.id, {
      headers: { cookie: f.cookie },
    })
  ).json();
  assert.equal(visible.upload.state, "valid");
  const expired = await (
    await f.mf.dispatchFetch("http://localhost/v1/uploads/" + v.id, {
      headers: { cookie: f.cookie },
    })
  ).json();
  assert.equal(expired.upload.state, "expired");
  const keys = (await f.bucket.list()).objects.map((o) => o.key);
  assert.equal(
    keys.some((k) => k.endsWith(v.id)),
    false,
  );
  assert.equal(
    keys.some((k) => k.startsWith("sealed/") && k.endsWith(u.id)),
    true,
  );
  assert.equal(
    (await (await f.mf.getWorker()).scheduled({ cron: "*/15 * * * *" }))
      .outcome,
    "ok",
  );
});
test("HTTP animation pixel and duration budgets and animated WebP are fully decoded", async (t) => {
  const f = await fixture(t),
    sharp = (await import("sharp")).default;
  for (const [width, frames, delay, expected, webp] of [
    [1024, 7, 1, 200, false],
    [1024, 8, 1, 422, false],
    [2, 2, 500, 200, false],
    [2, 2, 501, 422, false],
    [2, 2, 10, 200, true],
  ]) {
    const header = Buffer.from("47494638396101000100800000000000ffffff", "hex");
    header.writeUInt16LE(width, 6);
    header.writeUInt16LE(width, 8);
    const frame = Buffer.from(
      "21f90400010000002c0000000001000100000202440100",
      "hex",
    );
    frame.writeUInt16LE(delay, 4);
    const alternate = Buffer.from(frame);
    alternate[20] = 0x4c;
    let image = Buffer.concat([
      header,
      ...Array.from({ length: frames }, (_, i) => (i % 2 ? alternate : frame)),
      Buffer.from([0x3b]),
    ]);
    if (webp)
      image = await sharp(image, { animated: true })
        .webp({ lossless: true })
        .toBuffer();
    const u = await f.reserve(),
      { bytes } = await archive(u, {
        image,
        mime: webp ? "image/webp" : "image/gif",
        width,
        height: width,
        animated: true,
        duration: frames * delay * 10,
      }),
      a = await f.authorize(u, bytes);
    await f.put(a, bytes);
    const r = await f.post(`/v1/uploads/${u.id}/complete`, {}, f.cookie);
    assert.equal(r.status, expected, await r.clone().text());
  }
});
