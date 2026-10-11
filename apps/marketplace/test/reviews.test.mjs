import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./submission-fixture.mjs";
import { archive, hash } from "./upload-fixtures.mjs";
const get = (f, path, cookie = "") =>
  f.mf.dispatchFetch("http://localhost" + path, { headers: { cookie } });
async function submitted(f, pack_id) {
  const u = await f.reserve(pack_id ? { pack_id } : {});
  const v = await archive(u, {
    mutate(m) {
      m.name = "中文协作";
      m.styles = ["线条"];
      m.rights.creator = "Synthetic";
      m.expressions[0].rights.creator = "Synthetic";
    },
  });
  await f.put(await f.authorize(u, v.bytes), v.bytes);
  const complete = await f.post(`/v1/uploads/${u.id}/complete`, {}, f.cookie);
  assert.equal(complete.status, 200, await complete.clone().text());
  const upload = (await complete.json()).upload;
  const r = await f.post(
    "/v1/submissions",
    { upload_id: u.id, rights_confirmed: true },
    f.cookie,
    crypto.randomUUID(),
    { "if-match": `"${upload.row_version}"` },
  );
  assert.equal(r.status, 201, await r.clone().text());
  return { ...v, s: (await r.json()).submission };
}
test("four actors: revision, digest-bound approval, public discovery and retained exact releases", async (t) => {
  const f = await fixture(t);
  const reviewer = await f.register("reviewer@example.test"),
    other = await f.register("other@example.test");
  await f.db
    .prepare(
      "UPDATE market_account SET role='reviewer' WHERE auth_user_id=(SELECT id FROM auth_user WHERE email='reviewer@example.test')",
    )
    .run();
  const a = await submitted(f),
    path = `/v1/review/submissions/${a.s.id}`;
  for (const c of [f.cookie, other, ""])
    assert.ok([401, 403].includes((await get(f, path, c)).status));
  const detail = await get(f, path, reviewer);
  assert.equal(detail.status, 200, await detail.clone().text());
  assert.deepEqual((await detail.json()).manifest, a.manifest);
  const publicPath = `/v1/packs/${a.s.pack_id}/releases/${a.s.release_id}`;
  for (const suffix of ["", "/archive", `/media/${hash(a.image)}`])
    assert.equal((await get(f, publicPath + suffix)).status, 404);
  const decision = (
    s,
    value,
    key = crypto.randomUUID(),
    cookie = reviewer,
    version = '"1"',
  ) =>
    f.post(`/v1/review/submissions/${s.id}/decision`, value, cookie, key, {
      "if-match": version,
    });
  assert.equal(
    (await decision(a.s, { decision: "changes_requested", reason: "" })).status,
    422,
  );
  assert.equal(
    (
      await decision(a.s, {
        decision: "changes_requested",
        reason: "请完善说明",
      })
    ).status,
    200,
  );
  const b = await submitted(f, a.s.pack_id),
    key = crypto.randomUUID(),
    payload = { decision: "approve", reason: "图文与许可已核对" };
  assert.equal((await decision(b.s, payload, key, other)).status, 403);
  assert.equal(
    (await decision(b.s, payload, key, reviewer, '"9"')).status,
    412,
  );
  const approved = await decision(b.s, payload, key);
  assert.equal(approved.status, 200, await approved.clone().text());
  assert.equal((await decision(b.s, payload, key)).status, 200);
  assert.equal(
    (await decision(b.s, { ...payload, reason: "different" }, key)).status,
    409,
  );
  assert.equal((await get(f, `/v1/operations/${key}`, reviewer)).status, 200);
  const p = `/v1/packs/${b.s.pack_id}/releases/${b.s.release_id}`;
  const download = await get(f, p + "/archive");
  assert.equal(download.status, 200);
  assert.equal(
    hash(new Uint8Array(await download.arrayBuffer())),
    b.s.archive_sha256,
  );
  assert.equal(download.headers.get("etag"), `"${b.s.archive_sha256}"`);
  assert.equal(download.headers.get("content-length"), String(b.bytes.length));
  assert.equal((await get(f, p + `/media/${hash(b.image)}`)).status, 200);
  const list = await get(
    f,
    "/v1/packs?q=中文&scenario=协作&locale=zh-CN&style=线条&actions=false",
  );
  assert.equal(list.status, 200);
  assert.equal((await list.json()).packs.length, 1);
  const c = await submitted(f, b.s.pack_id);
  assert.equal((await get(f, `/v1/packs/${b.s.pack_id}`)).status, 200);
  const review = await (
    await get(f, `/v1/review/submissions/${c.s.id}`, reviewer)
  ).json();
  assert.equal(review.previous.release_id, b.s.release_id);
  assert.equal((await decision(c.s, payload)).status, 200);
  assert.equal((await get(f, p + "/archive")).status, 200);
  assert.equal((await get(f, "/v1/packs?limit=51")).status, 400);
  assert.equal((await get(f, "/v1/packs?q=不存在")).status, 200);
});
test("review HTTP: self-review, CAS race, transaction rollback, bootstrap and sanitized failures", async (t) => {
  const f = await fixture(t),
    reviewer = await f.register("reviewer@example.test");
  const account = await (await get(f, "/v1/me", reviewer)).json();
  await f.db
    .prepare("INSERT INTO market_role_bootstrap VALUES('initial',?,?,?,?)")
    .bind(
      account.account.id,
      "synthetic test operator",
      "isolated test reviewer",
      Date.now(),
    )
    .run();
  await assert.rejects(
    f.db
      .prepare("INSERT INTO market_role_bootstrap VALUES('initial',?,?,?,?)")
      .bind(account.account.id, "operator", "duplicate", Date.now())
      .run(),
  );
  const a = await submitted(f),
    path = `/v1/review/submissions/${a.s.id}/decision`,
    payload = { decision: "approve", reason: "checked" };
  const decide = (key = crypto.randomUUID(), c = reviewer) =>
    f.post(path, payload, c, key, { "if-match": '"1"' });
  await f.db
    .prepare(
      "CREATE TRIGGER test_audit_fault BEFORE INSERT ON market_review_audit BEGIN SELECT RAISE(ABORT,'secret SQL /internal/path'); END",
    )
    .run();
  const failed = await decide();
  assert.equal(failed.status, 503);
  assert.doesNotMatch(await failed.text(), /secret|SQL|internal/);
  assert.equal(
    (
      await get(f, `/v1/me/submissions/${a.s.id}`, f.cookie).then((r) =>
        r.json(),
      )
    ).submission.state,
    "pending",
  );
  assert.equal((await get(f, `/v1/packs/${a.s.pack_id}`)).status, 404);
  await f.db.prepare("DROP TRIGGER test_audit_fault").run();
  const results = await Promise.all([
    decide(),
    f.post(
      `/v1/submissions/${a.s.id}/withdraw`,
      {},
      f.cookie,
      crypto.randomUUID(),
      { "if-match": '"1"' },
    ),
  ]);
  assert.equal(results.filter((r) => r.status === 200).length, 1);
  assert.ok([409, 412].includes(results.find((r) => r.status !== 200).status));
  const state = (
    await (await get(f, `/v1/me/submissions/${a.s.id}`, f.cookie)).json()
  ).submission.state;
  assert.equal(
    (await get(f, `/v1/packs/${a.s.pack_id}`)).status,
    state === "published" ? 200 : 404,
  );
  const b = await submitted(f);
  await f.db
    .prepare(
      "UPDATE market_account SET role='reviewer' WHERE id=(SELECT owner FROM market_submission WHERE id=?)",
    )
    .bind(b.s.id)
    .run();
  assert.equal(
    (
      await f.post(
        `/v1/review/submissions/${b.s.id}/decision`,
        payload,
        f.cookie,
        crypto.randomUUID(),
        { "if-match": '"1"' },
      )
    ).status,
    403,
  );
  if (state === "published") {
    await f.db
      .prepare(
        "UPDATE market_public_release SET state='unpublished' WHERE release_id=?",
      )
      .bind(a.s.release_id)
      .run();
    for (const suffix of ["", "/archive", `/media/${hash(a.image)}`])
      assert.equal(
        (
          await get(
            f,
            `/v1/packs/${a.s.pack_id}/releases/${a.s.release_id}` + suffix,
          )
        ).status,
        410,
      );
  }
});
test("anonymous reads enforce the shared 120 per minute IP budget", async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 120; i++)
    assert.equal((await get(f, "/v1/packs")).status, 200);
  const denied = await get(f, "/v1/packs");
  assert.equal(denied.status, 429);
  assert.ok(denied.headers.get("retry-after"));
});
