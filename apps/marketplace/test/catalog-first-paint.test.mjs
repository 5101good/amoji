import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { Miniflare } from "miniflare";
import { convertV4MiniflareOptions } from "./runtime-fixture.mjs";

async function fixture(t, assetsUnavailable = false) {
  const directory = await mkdtemp(tmpdir() + "/amoji-first-paint-");
  const template = await readFile("dist/public/index.html", "utf8");
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: "first-paint",
          modules: true,
          script:
            "Date.now = () => 1800000000000;\n" +
            (await readFile("dist/worker.js", "utf8")),
          compatibilityDate: "2026-09-21",
          compatibilityFlags: ["nodejs_compat"],
          d1Databases: { DB: "first-paint" },
          r2Buckets: { UPLOADS: "first-paint" },
          serviceBindings: {
            ASSETS: async () => {
              if (assetsUnavailable)
                return new Response("Asset service unavailable", { status: 503 });
              return new Response(template, {
                headers: {
                  "content-type": "text/html",
                  etag: "static-template",
                },
              });
            },
          },
          bindings: {
            APP_ORIGIN: "http://localhost",
            LOCAL_TEST: "true",
            BETTER_AUTH_SECRET: "synthetic-test-secret-at-least-32-bytes",
          },
        },
      ],
    }),
  );
  t.after(async () => {
    await mf.dispose();
    await rm(directory, { recursive: true, force: true });
  });
  execFileSync(process.execPath, [
    "scripts/catalog-load-fixture.mjs",
    directory + "/fixture.sql",
    "--metadata-only",
    "--count=21",
  ]);
  const db = await mf.getD1Database("DB");
  for (const sql of (await readFile(directory + "/fixture.sql", "utf8"))
    .split(";\n")
    .filter((s) => s.trim()))
    await db.prepare(sql).run();
  return {
    db,
    request: (path = "/", init) =>
      mf.dispatchFetch("http://localhost" + path, init),
  };
}

test("homepage HTTP already contains visible escaped public summaries and non-executable bootstrap, without full manifests", async (t) => {
  const f = await fixture(t);
  const malicious = '</div><script>alert("name")</script>';
  await f.db
    .prepare(
      "UPDATE market_public_release SET manifest=json_set(manifest,'$.name',json(?),'$.description',json(?),'$.private_only','DO_NOT_DISCLOSE'),author=? WHERE pack_id=?",
    )
    .bind(
      JSON.stringify({ "zh-CN": malicious, en: malicious }),
      JSON.stringify({ "zh-CN": "A & B < C", en: "A & B < C" }),
      "</div><img src=x onerror=alert(1)>",
      "00000000-0000-4000-8000-000000000021",
    )
    .run();
  const response = await f.request();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(
    response.headers.get("content-security-policy"),
    /script-src 'self'/,
  );
  assert.equal(response.headers.get("etag"), null);
  const html = await response.text();
  assert.equal((html.match(/class="catalog-row"/g) ?? []).length, 20);
  assert.ok(
    html.includes(
      "&lt;/div&gt;&lt;script&gt;alert(&quot;name&quot;)&lt;/script&gt;",
    ),
  );
  assert.ok(!html.includes(malicious));
  assert.ok(!html.includes("DO_NOT_DISCLOSE"));
  assert.ok(!html.includes('"expressions"'));
  assert.match(html, /id="catalog-bootstrap" hidden/);
  assert.equal((html.match(/<script\b/g) ?? []).length, 1);
  assert.match(
    html,
    /href="\/packs\/00000000-0000-4000-8000-000000000021\/releases\/00000000-0000-4000-8000-000000000021"/,
  );
  assert.match(html, /&quot;cursor&quot;:&quot;/);
});

test("first catalog paint remains available without a static-template round trip", async (t) => {
  const f = await fixture(t, true);
  const response = await f.request();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.equal((html.match(/class="catalog-row"/g) ?? []).length, 20);
  assert.match(html, /<style data-amoji-base>/);
  // Other routes still use the asset binding; only the build's homepage is embedded.
  assert.equal((await f.request("/app.js")).status, 503);
});

test("official priority is shared by SSR, filters and every cursor page without dropping newer community packs", async (t) => {
  const f = await fixture(t);
  const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  for (const [n, priority] of [[1, 3], [2, 2], [3, 1], [4, 1]]) {
    await f.db.prepare("UPDATE market_public_pack SET priority=?,updated_at=0 WHERE pack_id=?")
      .bind(priority, id(n)).run();
  }
  // A name and author copied by a community creator cannot pin the collection.
  await f.db.prepare("UPDATE market_public_release SET author='Amoji',manifest=json_set(manifest,'$.name',json('{\"zh-CN\":\"经典\",\"en\":\"Classic\"}')) WHERE pack_id=?").bind(id(21)).run();
  const first = await (await f.request("/v1/packs")).json();
  assert.deepEqual(first.packs.slice(0, 5).map(p => p.pack_id), [1, 2, 4, 3, 21].map(id));
  const html = await (await f.request("/")).text();
  // Each card links its image and heading to the same release.
  const rowIds = [...new Set([...html.matchAll(/href="\/packs\/([^/]+)\/releases\//g)].map(m => m[1]))];
  assert.deepEqual(rowIds.slice(0, 5), [1, 2, 4, 3, 21].map(id));
  const seen = [];
  let cursor = null;
  do {
    const r = await f.request("/v1/packs?limit=3" + (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""));
    assert.equal(r.status, 200);
    const page = await r.json();
    seen.push(...page.packs.map(p => p.pack_id));
    cursor = page.cursor;
  } while (cursor);
  assert.deepEqual(seen, [1, 2, 4, 3, ...Array.from({length:17}, (_, i) => 21 - i)].map(id));
  const filtered = await (await f.request("/v1/packs?q=performance&act=core:ack&effects=true")).json();
  assert.deepEqual(filtered.packs.slice(0, 5).map(p => p.pack_id), [1, 2, 4, 3, 21].map(id));
  await f.db.prepare("UPDATE market_public_release SET state='unpublished' WHERE pack_id=?").bind(id(1)).run();
  assert.equal((await (await f.request("/v1/packs")).json()).packs[0].pack_id, id(2));
  for (const priority of [-1, 4, "3", null]) {
    const token = btoa(JSON.stringify({priority, time: 0, id: id(1)}));
    assert.equal((await f.request("/v1/packs?cursor=" + encodeURIComponent(token))).status, 400);
  }
});

test("workspace entries preserve their loading shell and locale without the asset service", async (t) => {
  const f = await fixture(t, true);
  for (const path of ["/?view=review", "/?authorization=fixture"]) {
    const response = await f.request(path, {
      headers: { cookie: "amoji-market-language=en" },
    });
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /lang="en"/);
    assert.match(html, /class="loading-state">Loading workspace…/);
    assert.doesNotMatch(html, /class="market-hero"/);
    assert.match(html, /<style data-amoji-base>/);
  }
});

test("first catalog paint has its stylesheet in the HTML with an exact CSP hash", async (t) => {
  const f = await fixture(t);
  const response = await f.request();
  const html = await response.text();
  const css = /<style data-amoji-base>([\s\S]*?)<\/style>/.exec(html)?.[1];
  assert.ok(css, "first paint must not wait for a second stylesheet request");
  assert.match(css, /\.catalog-row/);
  assert.ok(!html.includes('rel="stylesheet"'));
  const hash = createHash("sha256").update(css).digest("base64");
  const csp = response.headers.get("content-security-policy");
  assert.ok(csp.includes(`'sha256-${hash}'`));
  assert.ok(!csp.includes("'unsafe-inline'"));
  const assetHeaders = await readFile("dist/public/_headers", "utf8");
  assert.ok(
    assetHeaders.includes(`'sha256-${hash}'`),
    "static detail pages permit the same bundled stylesheet",
  );
});

test("homepage and catalog API consume the same public allowance; exhaustion never serves stale rows", async (t) => {
  const f = await fixture(t);
  for (let n = 0; n < 119; n++)
    assert.equal((await f.request("/v1/packs")).status, 200);
  assert.equal((await f.request()).status, 200);
  const denied = await f.request("/", {
    headers: { "x-amoji-edge-ip": "192.0.2.1" },
  });
  assert.equal(denied.status, 429);
  const html = await denied.text();
  assert.match(denied.headers.get("content-type"), /text\/html/);
  assert.doesNotMatch(html, /<article\b[^>]*\bclass="[^"]*\bcatalog-row\b/);
  assert.ok(!html.includes("catalog-bootstrap"));
  assert.ok(html.includes("暂时无法获取内容"));
  assert.ok(html.includes("/app.js"));
  assert.equal((await f.request("/v1/packs")).status, 429);
});

test("malformed or excessively long public summary fails closed before HTML injection", async (t) => {
  const f = await fixture(t);
  for (const value of ["a plain string is not a localized name", { "zh-CN": "x".repeat(10000) }, ["not", "a", "name"]]) {
    await f.db
      .prepare(
        "UPDATE market_public_release SET manifest=json_set(manifest,'$.name',json(?))",
      )
      .bind(JSON.stringify(value))
      .run();
    const response = await f.request();
    assert.equal(response.status, 503);
    assert.doesNotMatch(
      await response.text(),
      /<article\b[^>]*\bclass="[^"]*\bcatalog-row\b/,
    );
  }
});

test("homepage preserves literal replacement metacharacters in public names", async (t) => {
  const f = await fixture(t);
  const name = "price $& $` $' $$ value";
  await f.db
    .prepare(
      "UPDATE market_public_release SET manifest=json_set(manifest,'$.name',json(?))",
    )
    .bind(JSON.stringify({ "zh-CN": name, en: name }))
    .run();
  const response = await f.request();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.equal((html.match(/id="root"/g) ?? []).length, 1);
  assert.ok(html.includes("price $&amp; $` $&#39; $$ value"));
  const encoded = /<div id="catalog-bootstrap" hidden>(.*?)<\/div>/.exec(
    html,
  )?.[1];
  assert.ok(encoded);
  const decoded = encoded
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
  assert.equal(JSON.parse(decoded).packs[0].manifest.name["zh-CN"], name);
});

test("filtered homepage SSR matches the requested directory without exposing full manifests", async (t) => {
  const f = await fixture(t);
  await f.db
    .prepare(
      "UPDATE market_public_release SET search_text='unique-search-marker' WHERE pack_id=?",
    )
    .bind("00000000-0000-4000-8000-000000000021")
    .run();
  const response = await f.request("/?q=unique-search-marker");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.equal((html.match(/class="catalog-row"/g) ?? []).length, 1);
  assert.ok(html.includes('value="unique-search-marker"'));
  assert.ok(!html.includes('"expressions"'));
  const api = await (
    await f.request("/v1/packs?q=unique-search-marker")
  ).json();
  const pack = api.packs[0];
  assert.match(pack.cover.sha256, /^[a-f0-9]{64}$/);
  assert.ok(pack.expression_count > 0);
  assert.equal(typeof pack.effect_count, "number");
  assert.ok(pack.manifest.acts.length > 0 && pack.manifest.locales.includes("zh-CN"));
});

test("a saved English interface is rendered before JavaScript without rewriting pack content", async (t) => {
  const f = await fixture(t);
  const response = await f.request("/", {
    headers: { cookie: "amoji-market-language=en" },
  });
  const html = await response.text();
  assert.match(html, /lang="en"/);
  assert.ok(html.includes("A new language."));
  const api = await (await f.request("/v1/packs")).json();
  assert.ok(html.includes(api.packs[0].manifest.name.en), "English pack names come from the pack, not a translation");
  assert.ok(html.includes("Find your expression"));
  assert.ok(html.includes("catalog-bootstrap"));
});
