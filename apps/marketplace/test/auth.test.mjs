import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
test("HTTP account access requires authentication and rejects cross-origin writes", async () => {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: "auth",
          modules: true,
          script: await readFile(
            new URL("../dist/worker.js", import.meta.url),
            "utf8",
          ),
          compatibilityDate: "2026-09-21",
          compatibilityFlags: ["nodejs_compat"],
          d1Databases: { DB: "test" },
          bindings: {
            APP_ORIGIN: "https://amoji.test",
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
    const r = await mf.dispatchFetch("https://amoji.test/v1/me");
    assert.equal(r.status, 401);
    const bad = await mf.dispatchFetch("https://amoji.test/v1/auth/register", {
      method: "POST",
      headers: {
        origin: "https://evil.test",
        "content-type": "application/json",
      },
      body: "{}",
    });
    assert.equal(bad.status, 403);
  } finally {
    await mf.dispose();
  }
});
test("real workerd signup, password login, secure session and immediate revocation", async () => {
  const options = {
    modules: true,
    script: await readFile(
      new URL("../dist/worker.js", import.meta.url),
      "utf8",
    ),
    compatibilityDate: "2026-09-21",
    compatibilityFlags: ["nodejs_compat"],
    d1Databases: { DB: "auth-shared" },
    bindings: {
      LOCAL_TEST: "true",
      APP_ORIGIN: "http://localhost",
      BETTER_AUTH_SECRET: "local-test-secret-that-is-at-least-32-bytes",
    },
  };
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        { name: "one", ...options },
        { name: "two", ...options },
      ],
    }),
  );
  try {
    const db = await mf.getD1Database("DB", "one");
    for (const sql of (
      await readFile(
        new URL("../migrations/0001-auth.sql", import.meta.url),
        "utf8",
      )
    )
      .split(";")
      .filter((s) => s.trim()))
      await db.prepare(sql).run();
    const one = await mf.getWorker("one"),
      two = await mf.getWorker("two");
    async function post(route, body, cookie = "", worker = one, extra = {}) {
      const c = await worker.fetch("http://localhost/v1/auth/csrf", {
        headers: { cookie },
      });
      const { csrf } = await c.json();
      return worker.fetch(`http://localhost/v1/auth/${route}`, {
        method: "POST",
        headers: {
          cookie,
          origin: "http://localhost",
          "content-type": "application/json",
          "cf-connecting-ip": "192.0.2.1",
          "x-csrf-token": csrf,
          ...extra,
        },
        body: JSON.stringify(body),
        cf: { colo: "TEST" },
      });
    }
    const body = {
      email: "alice@example.test",
      password: "correct horse battery staple",
      name: "Alice",
    };
    assert.equal(
      (await post("register", { ...body, role: "admin" })).status,
      400,
    );
    const start = performance.now();
    const registered = await post("register", body);
    assert.equal(registered.status, 200, await registered.clone().text());
    console.info(
      `workerd signup elapsed_ms=${Math.round(performance.now() - start)} (wall time, not CPU)`,
    );
    const cookies = registered.headers.getSetCookie();
    assert.equal(cookies.length, 1);
    assert.match(cookies[0], /HttpOnly/i);
    assert.match(cookies[0], /Secure/i);
    assert.match(cookies[0], /SameSite=Lax/i);
    assert.match(cookies[0], /Max-Age=43200/i);
    assert.deepEqual(Object.keys(await registered.json()).sort(), [
      "ok",
      "request_id",
    ]);
    const cookie = cookies[0].split(";")[0];
    const me = await two.fetch("http://localhost/v1/me", {
      headers: { cookie },
    });
    assert.equal(me.status, 200);
    const data = await me.json();
    assert.equal(data.account.emailVerified, false);
    assert.equal(data.account.role, "creator");
    assert.equal((await post("register", body)).status, 422);
    assert.equal(
      (
        await post("login", {
          email: body.email,
          password: "wrong password forever",
        })
      ).status,
      401,
    );
    const logged = await post("login", {
      email: body.email,
      password: body.password,
    });
    assert.equal(logged.status, 200);
    const secondCookie = logged.headers.getSetCookie()[0].split(";")[0];
    assert.equal((await post("logout", {}, cookie)).status, 200);
    assert.equal(
      (await two.fetch("http://localhost/v1/me", { headers: { cookie } }))
        .status,
      401,
    );
    await db.prepare("UPDATE market_account SET disabled=1").run();
    assert.equal(
      (
        await two.fetch("http://localhost/v1/me", {
          headers: { cookie: secondCookie },
        })
      ).status,
      403,
    );
    const rows = await db.prepare("SELECT password FROM auth_account").all();
    assert.equal(rows.results.length, 1);
    assert.notEqual(rows.results[0].password, body.password);
    assert.match(rows.results[0].password, /^[a-f0-9]+:[a-f0-9]+$/);
    await db.prepare("DELETE FROM auth_rate_limit").run();
    const limited = [];
    for (let n = 0; n < 22; n++)
      limited.push((await post("login", {}, "", n % 2 ? one : two)).status);
    assert.deepEqual(limited.slice(0, 20), Array(20).fill(400));
    assert.deepEqual(limited.slice(20), [429, 429]);
    await db.prepare("DELETE FROM auth_rate_limit").run();
    assert.equal(
      (await post("register", { ...body, name: "x".repeat(9000) })).status,
      413,
    );
    assert.equal(
      (await post("logout", {}, secondCookie, one, { "x-csrf-token": "bogus" }))
        .status,
      403,
    );
    assert.equal(
      (await one.fetch("http://localhost/api/auth/get-session")).status,
      404,
    ); // No default Better Auth routes are exposed.
    await db.prepare("DELETE FROM auth_rate_limit").run();
    for (let n = 0; n < 11; n++) {
      const emailLimit = await post(
        "login",
        { email: "rate@example.test", password: "wrong password forever" },
        "",
        n % 2 ? one : two,
        { "cf-connecting-ip": `192.0.2.${n + 10}` },
      );
      assert.equal(emailLimit.status, n < 10 ? 401 : 429);
      if (n === 10)
        assert.equal(emailLimit.headers.get("retry-after"), "900",
          "email rate limits advertise retry time");
    }
    await db.prepare("DELETE FROM auth_rate_limit").run();
    await db.prepare(
      "CREATE TRIGGER deny_credential BEFORE INSERT ON auth_account BEGIN SELECT RAISE(ABORT,'fixture credential failure'); END",
    ).run();
    const credentialRetry = { ...body, email: "credential-retry@example.test" };
    assert.equal((await post("register", credentialRetry)).status, 503);
    await db.prepare("DROP TRIGGER deny_credential").run();
    assert.equal((await post("register", credentialRetry)).status, 200,
      "a failed credential insert must not reserve the email");
    assert.equal((await post("login", {
      email: credentialRetry.email, password: credentialRetry.password,
    })).status, 200);
    await db.prepare("DELETE FROM auth_rate_limit").run();
    await db
      .prepare(
        "CREATE TRIGGER deny_account BEFORE INSERT ON market_account BEGIN SELECT RAISE(ABORT,'fixture failure'); END",
      )
      .run();
    assert.equal(
      (await post("register", { ...body, email: "retry@example.test" })).status,
      503,
    );
    await db.prepare("DROP TRIGGER deny_account").run();
    const recovered = await post("login", {
      email: "retry@example.test",
      password: body.password,
    });
    assert.equal(recovered.status, 200);
    const recoveredCookie = recovered.headers.getSetCookie()[0].split(";")[0];
    assert.equal(
      (
        await one.fetch("http://localhost/v1/me", {
          headers: { cookie: recoveredCookie },
        })
      ).status,
      200,
    );
    assert.equal(
      (await db.prepare("SELECT COUNT(*) AS n FROM market_account").first()).n,
      3,
    );
  } finally {
    await mf.dispose();
  }
});
