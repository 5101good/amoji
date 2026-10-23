import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./submission-fixture.mjs";
const get = (f, path, cookie = "") =>
  f.mf.dispatchFetch("http://localhost" + path, { headers: { cookie } });
test("admin roles: current authorization, CAS, audit replay and last administrator", async (t) => {
  const f = await fixture(t),
    admin = await f.register("admin@example.test");
  const a = (await (await get(f, "/v1/me", admin)).json()).account;
  const user = (await (await get(f, "/v1/me", f.cookie)).json()).account;
  await f.db
    .prepare("INSERT INTO market_role_bootstrap VALUES('initial',?,?,?,?)")
    .bind(a.id, "test", "isolated fixture", Date.now())
    .run();
  assert.equal((await get(f, "/v1/admin/accounts", f.cookie)).status, 403);
  const list = await get(f, "/v1/admin/accounts", admin);
  assert.equal(list.status, 200);
  const edit = (id, role, c = admin, version = 1, key = crypto.randomUUID()) =>
    f.post(
      `/v1/admin/accounts/${id}/roles`,
      { role, reason: "reviewed change" },
      c,
      key,
      { "if-match": `"${version}"` },
    );
  assert.equal((await edit(user.id, "admin", f.cookie)).status, 403);
  assert.equal((await edit(a.id, "creator")).status, 409);
  const key = crypto.randomUUID();
  assert.equal((await edit(user.id, "admin", admin, 1, key)).status, 200);
  assert.equal((await edit(user.id, "admin", admin, 1, key)).status, 200);
  assert.equal((await edit(user.id, "creator", admin, 1)).status, 412);
  const race = await Promise.all([
    edit(a.id, "creator", admin),
    edit(user.id, "creator", f.cookie, 2),
  ]);
  assert.equal(race.filter((r) => r.status === 200).length, 1);
  const current = await get(
    f,
    "/v1/admin/accounts",
    race[0].status === 200 ? f.cookie : admin,
  );
  assert.equal(current.status, 200);
  assert.equal(
    (await current.json()).accounts.filter(
      (a) => a.role === "admin" && !a.disabled,
    ).length,
    1,
  );
});
import { archive, hash } from "./upload-fixtures.mjs";
async function publish(f, admin) {
  const u = await f.reserve();
  const v = await archive(u, {
    mutate(m) {
      m.name = { "zh-CN": "<img src=x onerror=alert(1)>" };
      m.rights.creator = "Synthetic";
      m.expressions[0].rights.creator = "Synthetic";
    },
  });
  await f.put(await f.authorize(u, v.bytes), v.bytes);
  const complete = await f.post(`/v1/uploads/${u.id}/complete`, {}, f.cookie);
  assert.equal(complete.status, 200);
  const upload = (await complete.json()).upload;
  const submit = await f.post(
    "/v1/submissions",
    { upload_id: u.id, rights_confirmed: true },
    f.cookie,
    crypto.randomUUID(),
    { "if-match": `"${upload.row_version}"` },
  );
  assert.equal(submit.status, 201);
  const s = (await submit.json()).submission;
  assert.equal(
    (
      await f.post(
        `/v1/review/submissions/${s.id}/decision`,
        { decision: "approve", reason: "synthetic reviewed" },
        admin,
        crypto.randomUUID(),
        { "if-match": '"1"' },
      )
    ).status,
    200,
  );
  return { s, u, ...v };
}
async function administrator(f) {
  const cookie = await f.register("moderation@example.test");
  const a = (await (await get(f, "/v1/me", cookie)).json()).account;
  await f.db
    .prepare("INSERT INTO market_role_bootstrap VALUES('initial',?,?,?,?)")
    .bind(a.id, "test", "isolated", Date.now())
    .run();
  return cookie;
}
test("private receipts, audited report resolution and sticky safety removal stop new content requests", async (t) => {
  const f = await fixture(t),
    admin = await administrator(f),
    p = await publish(f, admin),
    base = `/v1/packs/${p.s.pack_id}/releases/${p.s.release_id}`;
  assert.equal((await get(f, "/v1/reports")).status, 404);
  const r = await f.post(
    "/v1/reports",
    {
      pack_id: p.s.pack_id,
      release_id: p.s.release_id,
      reason: "unsafe synthetic content",
    },
    "",
  );
  assert.equal(r.status, 201);
  const receipt = await r.json();
  const receiptPath = `/v1/reports/${receipt.report_id}/receipt`;
  assert.equal((await get(f, receiptPath)).status, 404);
  assert.equal((await get(f, receiptPath, f.cookie)).status, 404);
  const read = () =>
    f.mf.dispatchFetch("http://localhost" + receiptPath, {
      headers: { "x-receipt-token": receipt.receipt_token },
    });
  assert.equal((await read()).status, 200);
  assert.equal((await get(f, "/v1/review/reports", f.cookie)).status, 403);
  const queue = await get(f, "/v1/review/reports", admin);
  assert.equal((await queue.json()).reports.length, 1);
  const remove = (c, type = "safety_removed", version = 1) =>
    f.post(
      `/v1/packs/${p.s.pack_id}/unpublish`,
      { release_id: p.s.release_id, type, reason: "confirmed unsafe" },
      c,
      crypto.randomUUID(),
      { "if-match": `"${version}"` },
    );
  assert.equal((await remove(f.cookie)).status, 403);
  assert.equal((await remove(admin)).status, 200);
  assert.equal((await remove(f.cookie, "unpublished", 2)).status, 409);
  for (const suffix of ["", "/archive", "/media/" + hash(p.image)]) {
    const result = await get(f, base + suffix);
    assert.equal(result.status, 410);
    assert.equal((await result.json()).tombstone.state, "safety_removed");
  }
  const feed = await (await get(f, "/v1/revocations")).json();
  assert.equal(feed.revocations[0].release_id, p.s.release_id);
  assert.equal(feed.revocations[0].state, "safety_removed");
  assert.equal(feed.revocations[0].reason, undefined);
  const expired = btoa(
    JSON.stringify({ seq: 0, at: Date.now() - 31 * 86400000 }),
  );
  assert.equal(
    (await get(f, "/v1/revocations?after=" + encodeURIComponent(expired)))
      .status,
    410,
  );
  const key = crypto.randomUUID();
  const resolve = () =>
    f.post(
      `/v1/review/reports/${receipt.report_id}/resolve`,
      { reason: "Removed for safety" },
      admin,
      key,
      { "if-match": '"1"' },
    );
  assert.equal((await resolve()).status, 200);
  assert.equal((await resolve()).status, 200);
  assert.equal((await (await read()).json()).receipt.state, "resolved");
  for (let i = 0; i < 4; i++)
    assert.equal(
      (
        await f.post(
          "/v1/reports",
          { pack_id: p.s.pack_id, release_id: p.s.release_id, reason: "test" },
          i % 2 ? f.cookie : "",
        )
      ).status,
      201,
    );
  const denied = await f.post(
    "/v1/reports",
    { pack_id: p.s.pack_id, release_id: p.s.release_id, reason: "test" },
    "",
  );
  assert.equal(denied.status, 429);
  assert.equal(denied.headers.get("retry-after"), "3600");
});
test("account deletion revokes sessions and removes public content; scheduled cleanup is reference aware and retry safe", async (t) => {
  const f = await fixture(t),
    admin = await administrator(f),
    p = await publish(f, admin),
    a = (await (await get(f, "/v1/me", f.cookie)).json()).account;
  const policy = await get(f, "/v1/me/deletion-policy", f.cookie);
  assert.equal((await policy.json()).private_data_days, 30);
  const r = await f.post(
    "/v1/me/delete",
    { confirm: true, policy_version: "1" },
    f.cookie,
    crypto.randomUUID(),
    { "if-match": '"1"' },
  );
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal((await get(f, "/v1/me", f.cookie)).status, 401);
  assert.equal((await get(f, `/v1/packs/${p.s.pack_id}`)).status, 410);
  // Advance persisted timestamps as the external clock fixture, without adding a production time override.
  await f.db
    .prepare("UPDATE market_account SET deleted_at=? WHERE id=?")
    .bind(Date.now() - 31 * 86400000, a.id)
    .run();
  for (let i = 0; i < 2; i++)
    assert.equal(
      (await (await f.mf.getWorker()).scheduled({ cron: "*/15 * * * *" }))
        .outcome,
      "ok",
    );
  const user = await f.db
    .prepare(
      "SELECT email FROM auth_user WHERE id=(SELECT auth_user_id FROM market_account WHERE id=?)",
    )
    .bind(a.id)
    .first();
  assert.match(user.email, /@invalid.invalid$/);
  assert.ok(
    await f.bucket.get(
      (
        await f.db
          .prepare("SELECT sealed_key FROM market_direct_upload WHERE id=?")
          .bind(p.u.id)
          .first()
      ).sealed_key,
    ),
    "published attribution source remains referenced",
  );
  assert.equal((await get(f, `/v1/packs/${p.s.pack_id}`)).status, 410);
});
test("retention cleans 24-hour unsubmitted and 90-day withdrawn bytes, keeps backups and independent references, and prunes 30/180-day records", async (t) => {
  const f = await fixture(t);
  const u = await f.reserve(),
    v = await archive(u, {
      mutate(m) {
        m.rights.creator = "Synthetic";
        m.expressions[0].rights.creator = "Synthetic";
      },
    });
  await f.put(await f.authorize(u, v.bytes), v.bytes);
  const upload = (
    await (await f.post(`/v1/uploads/${u.id}/complete`, {}, f.cookie)).json()
  ).upload;
  const s = (
    await (
      await f.post(
        "/v1/submissions",
        { upload_id: u.id, rights_confirmed: true },
        f.cookie,
        crypto.randomUUID(),
        { "if-match": `"${upload.row_version}"` },
      )
    ).json()
  ).submission;
  assert.equal(
    (
      await f.post(
        `/v1/submissions/${s.id}/withdraw`,
        {},
        f.cookie,
        crypto.randomUUID(),
        { "if-match": '"1"' },
      )
    ).status,
    200,
  );
  const old = Date.now() - 91 * 86400000;
  await f.db
    .prepare("UPDATE market_submission SET updated_at=? WHERE id=?")
    .bind(old, s.id)
    .run();
  await f.db
    .prepare("UPDATE market_direct_upload SET expires_at=? WHERE id=?")
    .bind(old, u.id)
    .run();
  await f.db
    .prepare(
      "INSERT INTO market_direct_upload_reference VALUES(?,'independent-protected-reference')",
    )
    .bind(u.id)
    .run();
  await f.bucket.put("backups/retained-snapshot", "backup");
  const keys = await f.db
    .prepare(
      "SELECT object_key,sealed_key FROM market_direct_upload WHERE id=?",
    )
    .bind(u.id)
    .first();
  const scheduled = async () =>
    assert.equal(
      (await (await f.mf.getWorker()).scheduled({ cron: "*/15 * * * *" }))
        .outcome,
      "ok",
    );
  await scheduled();
  assert.ok(await f.bucket.get(keys.sealed_key));
  await f.db
    .prepare(
      "DELETE FROM market_direct_upload_reference WHERE reference_id='independent-protected-reference'",
    )
    .run();
  await scheduled();
  await scheduled();
  assert.equal(await f.bucket.get(keys.sealed_key), null);
  assert.ok(await f.bucket.get("backups/retained-snapshot"));
  const a = await f.reserve();
  await f.bucket.put(
    (
      await f.db
        .prepare("SELECT object_key FROM market_direct_upload WHERE id=?")
        .bind(a.id)
        .first()
    ).object_key,
    "unsubmitted",
  );
  await f.db
    .prepare("UPDATE market_direct_upload SET expires_at=? WHERE id=?")
    .bind(Date.now() - 86400000, a.id)
    .run();
  await f.db
    .prepare(
      "INSERT INTO market_lifecycle_audit VALUES('old','test','test','old','new','reason','request',?)",
    )
    .bind(Date.now() - 181 * 86400000)
    .run();
  await f.db
    .prepare(
      "INSERT INTO market_lifecycle_audit VALUES('recent','test','test','old','new','reason','request',?)",
    )
    .bind(Date.now())
    .run();
  await f.db
    .prepare(
      "INSERT INTO market_lifecycle_operation VALUES('test','test','old','digest',200,'{}',?)",
    )
    .bind(Date.now() - 31 * 86400000)
    .run();
  await scheduled();
  assert.equal(
    (
      await f.db
        .prepare("SELECT cleaned FROM market_direct_upload WHERE id=?")
        .bind(a.id)
        .first()
    ).cleaned,
    1,
  );
  assert.equal(
    await f.db
      .prepare("SELECT 1 FROM market_lifecycle_audit WHERE id='old'")
      .first(),
    null,
  );
  assert.ok(
    await f.db
      .prepare("SELECT 1 FROM market_lifecycle_audit WHERE id='recent'")
      .first(),
  );
  assert.equal(
    await f.db
      .prepare("SELECT 1 FROM market_lifecycle_operation WHERE operation='old'")
      .first(),
    null,
  );
});
