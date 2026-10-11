import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./submission-fixture.mjs";
import { archive, hash } from "./upload-fixtures.mjs";
async function valid(f, mutate = () => {}, pack_id) {
  const u = await f.reserve(pack_id ? { pack_id } : {});
  const data = await archive(u, {
    mutate: (m) => {
      m.rights.creator = "Synthetic creator";
      m.expressions[0].rights.creator = "Synthetic creator";
      mutate(m);
    },
  });
  await f.put(await f.authorize(u, data.bytes), data.bytes);
  const r = await f.post(`/v1/uploads/${u.id}/complete`, {}, f.cookie);
  assert.equal(r.status, 200, await r.clone().text());
  return { ...data, upload: (await r.json()).upload };
}
const get = (f, path, cookie = f.cookie) =>
  f.mf.dispatchFetch("http://localhost" + path, { headers: { cookie } });
test("creator HTTP: complete exact preview, private media, immutable submission and withdrawal retries", async (t) => {
  const f = await fixture(t),
    v = await valid(f);
  const path = `/v1/uploads/${v.upload.id}/preview`;
  const p = await get(f, path);
  assert.equal(p.status, 200, await p.clone().text());
  assert.deepEqual((await p.json()).manifest, v.manifest);
  const imagePath = `/v1/uploads/${v.upload.id}/media/${hash(v.image)}`;
  const image = await get(f, imagePath);
  assert.equal(image.headers.get("content-type"), "image/png");
  assert.equal(hash(new Uint8Array(await image.arrayBuffer())), hash(v.image));
  const other = await f.register("other@example.test");
  for (const cookie of [other, ""]) {
    assert.ok([401, 404].includes((await get(f, path, cookie)).status));
    assert.ok([401, 404].includes((await get(f, imagePath, cookie)).status));
  }
  const key = crypto.randomUUID(),
    data = { upload_id: v.upload.id, rights_confirmed: true },
    headers = { "if-match": `"${v.upload.row_version}"` };
  const r = await f.post("/v1/submissions", data, f.cookie, key, headers);
  assert.equal(r.status, 201, await r.clone().text());
  const s = (await r.json()).submission;
  assert.equal(s.state, "pending");
  assert.equal(s.archive_sha256, hash(v.bytes));
  const replay = await f.post("/v1/submissions", data, f.cookie, key, headers);
  assert.equal(replay.status, 201);
  assert.deepEqual((await replay.json()).submission, s);
  assert.equal(
    (
      await f.post(
        "/v1/submissions",
        { ...data, rights_confirmed: false },
        f.cookie,
        key,
        headers,
      )
    ).status,
    409,
  );
  assert.equal((await get(f, `/v1/me/submissions/${s.id}`, other)).status, 404);
  const operation = await get(f, `/v1/operations/${key}`);
  assert.equal((await operation.json()).result.submission.id, s.id);
  assert.equal(
    (
      await f.post(
        `/v1/submissions/${s.id}/withdraw`,
        {},
        f.cookie,
        crypto.randomUUID(),
        { "if-match": '"0"' },
      )
    ).status,
    412,
  );
  const withdrawKey = crypto.randomUUID();
  const w = await f.post(
    `/v1/submissions/${s.id}/withdraw`,
    {},
    f.cookie,
    withdrawKey,
    { "if-match": '"1"' },
  );
  assert.equal(w.status, 200, await w.clone().text());
  assert.equal((await w.json()).submission.state, "withdrawn");
  assert.equal(
    (
      await f.post(
        `/v1/submissions/${s.id}/withdraw`,
        {},
        f.cookie,
        withdrawKey,
        { "if-match": '"1"' },
      )
    ).status,
    200,
  );
  const revision = await valid(f, () => {}, v.upload.pack_id);
  assert.equal(revision.upload.version, 2);
  assert.notEqual(revision.upload.release_id, s.release_id);
});
test("creator HTTP: invalid state, missing distribution rights, attribution and stale writes are refused", async (t) => {
  const f = await fixture(t),
    u = await f.reserve();
  assert.equal(
    (
      await f.post(
        "/v1/submissions",
        { upload_id: u.id, rights_confirmed: true },
        f.cookie,
        crypto.randomUUID(),
        { "if-match": '"1"' },
      )
    ).status,
    409,
  );
  for (const mutate of [
    (m) => (m.rights.license = "All rights reserved"),
    (m) => delete m.expressions[0].rights.creator,
    (m) => {
      m.rights.license = "CC-BY-4.0";
      m.rights.creator = "";
    },
  ]) {
    const v = await valid(f, mutate).catch((e) => {
      if (e.message.includes("422")) return null;
      throw e;
    });
    if (!v) continue;
    const r = await f.post(
      "/v1/submissions",
      { upload_id: v.upload.id, rights_confirmed: true },
      f.cookie,
      crypto.randomUUID(),
      { "if-match": `"${v.upload.row_version}"` },
    );
    assert.equal(r.status, 422, await r.clone().text());
  }
  const v = await valid(f);
  assert.equal(
    (
      await f.post(
        "/v1/submissions",
        { upload_id: v.upload.id, rights_confirmed: true },
        f.cookie,
        crypto.randomUUID(),
        { "if-match": '"0"' },
      )
    ).status,
    412,
  );
  assert.equal((await get(f, "/v1/me/submissions")).status, 200);
});
test("creator HTTP: ten-pending and daily quotas, concurrent operations, seven-day replay and expiry", async (t) => {
  const f = await fixture(t);
  let first, last, key, data, headers;
  for (let i = 0; i < 10; i++) {
    const v = await valid(f);
    key = crypto.randomUUID();
    data = { upload_id: v.upload.id, rights_confirmed: true };
    headers = { "if-match": `"${v.upload.row_version}"` };
    const results = await Promise.all([
      f.post("/v1/submissions", data, f.cookie, key, headers),
      f.post("/v1/submissions", data, f.cookie, key, headers),
    ]);
    for (const r of results)
      assert.equal(r.status, 201, await r.clone().text());
    last = (await results[0].json()).submission;
    first ??= last;
  }
  const list = await get(f, "/v1/me/submissions?limit=5");
  const page = await list.json();
  assert.equal(page.submissions.length, 5);
  assert.ok(page.cursor);
  assert.equal(
    (
      await (
        await get(
          f,
          "/v1/me/submissions?cursor=" + encodeURIComponent(page.cursor),
        )
      ).json()
    ).submissions.length,
    5,
  );
  // Advance the independent request-rate bucket to exercise the business quota without a 15-minute test delay.
  await f.db
    .prepare(
      "UPDATE auth_rate_limit SET bucket=bucket-1 WHERE key LIKE 'upload:%' OR key LIKE 'submission:%'",
    )
    .run();
  const eleventh = await valid(f);
  const post = () =>
    f.post(
      "/v1/submissions",
      { upload_id: eleventh.upload.id, rights_confirmed: true },
      f.cookie,
      crypto.randomUUID(),
      { "if-match": `"${eleventh.upload.row_version}"` },
    );
  assert.equal((await post()).status, 429);
  const race = await Promise.all(
    [1, 2].map(() =>
      f.post(
        `/v1/submissions/${first.id}/withdraw`,
        {},
        f.cookie,
        crypto.randomUUID(),
        { "if-match": '"1"' },
      ),
    ),
  );
  assert.deepEqual(race.map((r) => r.status).sort(), [200, 412]);
  assert.equal(
    (await post()).status,
    429,
    "withdrawal does not reset daily quota",
  );
  // A retained operation older than seven days replays the original result, without another queue entry.
  await f.db
    .prepare(
      "UPDATE market_submission_operation SET created_at=? WHERE operation=?",
    )
    .bind(Date.now() - 8 * 86400000, key)
    .run();
  const replay = await f.post("/v1/submissions", data, f.cookie, key, headers);
  assert.equal(replay.status, 201);
  assert.equal((await replay.json()).submission.id, last.id);
  const expired = await valid(f);
  await f.db
    .prepare("UPDATE market_direct_upload SET expires_at=0 WHERE id=?")
    .bind(expired.upload.id)
    .run();
  assert.equal(
    (await get(f, `/v1/uploads/${expired.upload.id}/preview`)).status,
    410,
  );
  assert.equal(
    (
      await f.post(
        "/v1/submissions",
        { upload_id: expired.upload.id, rights_confirmed: true },
        f.cookie,
        crypto.randomUUID(),
        { "if-match": `"${expired.upload.row_version}"` },
      )
    ).status,
    410,
  );
  const logout = await f.post("/v1/auth/logout", {}, f.cookie);
  assert.equal(logout.status, 200);
  assert.equal((await get(f, `/v1/me/submissions/${last.id}`)).status, 401);
});
test("creator HTTP: an exact expression identity cannot publish different content in another release", async (t) => {
  const f = await fixture(t),
    a = await valid(f);
  const submitted = await f.post(
    "/v1/submissions",
    { upload_id: a.upload.id, rights_confirmed: true },
    f.cookie,
    crypto.randomUUID(),
    { "if-match": `"${a.upload.row_version}"` },
  );
  assert.equal(submitted.status, 201);
  const b = await valid(f, (m) => {
    m.expressions = [structuredClone(a.manifest.expressions[0])];
    m.expressions[0].semantics.meaning = "Changed under the same identity";
    m.defaults = [
      {
        asset_id: m.expressions[0].asset_id,
        revision_id: m.expressions[0].revision_id,
      },
    ];
  });
  const conflict = await f.post(
    "/v1/submissions",
    { upload_id: b.upload.id, rights_confirmed: true },
    f.cookie,
    crypto.randomUUID(),
    { "if-match": `"${b.upload.row_version}"` },
  );
  assert.equal(conflict.status, 409, await conflict.clone().text());
  assert.equal(
    (await (await get(f, "/v1/me/submissions")).json()).submissions.length,
    1,
  );
});
