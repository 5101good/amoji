import { test } from "node:test";
import assert from "node:assert/strict";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readFile } from "node:fs/promises";
test("D1 batch rollback, CAS guard, exact idempotency and concurrent review transition", async () => {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: await readFile(
        new URL("../dist/transaction-probe.js", import.meta.url),
        "utf8",
      ),
      compatibilityDate: "2026-09-21",
      d1Databases: { DB: "probe" },
    }),
  );
  try {
    const db = await mf.getD1Database("DB");
    for (const s of (
      await readFile(new URL("./review-fixture.sql", import.meta.url), "utf8")
    )
      .split(";")
      .filter((x) => x.trim()))
      await db.prepare(s).run();
    const send = (id, key, action, version = 0, fail = false) =>
      mf.dispatchFetch("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          id,
          key,
          action,
          version,
          fail,
          actor: "reviewer",
        }),
      });
    assert.equal((await send("rollback", "a", "approve", 0, true)).status, 500);
    assert.equal(
      (
        await db
          .prepare("SELECT state FROM fixture_submission WHERE id='rollback'")
          .first()
      ).state,
      "pending",
    );
    assert.equal((await send("stale", "b", "approve", 9)).status, 412);
    assert.equal(
      (await db.prepare("SELECT COUNT(*) AS n FROM fixture_audit").first()).n,
      0,
    );
    assert.equal((await send("retry", "c", "approve")).status, 200);
    assert.equal((await send("retry", "c", "approve")).status, 200);
    assert.equal((await send("retry", "c", "withdraw")).status, 409);
    const race = await Promise.all([
      send("race", "d", "approve"),
      send("race", "e", "withdraw"),
    ]);
    assert.deepEqual(race.map((r) => r.status).sort(), [200, 412]);
    assert.equal(
      (await db.prepare("SELECT COUNT(*) AS n FROM fixture_audit").first()).n,
      2,
    );
  } finally {
    await mf.dispose();
  }
});
