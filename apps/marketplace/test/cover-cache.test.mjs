import { test } from "node:test";
import assert from "node:assert/strict";
import { CoverCache } from "../dist/cover-cache.js";

test("cover cache is bounded by bytes and entries, retains recent covers and never caches failures", async () => {
  const cache = new CoverCache();
  for (let i = 0; i < 8; i++)
    await cache.remember(
      String(i),
      new Response(new Uint8Array(1024 * 1024), {
        headers: { "cache-control": "no-store" },
      }),
    );
  assert.ok(cache.get("0"));
  await cache.remember("new", new Response(new Uint8Array(1024 * 1024)));
  assert.equal(cache.get("1"), undefined);
  assert.equal(cache.get("0").headers.get("cache-control"), "no-store");
  await cache.remember(
    "oversized",
    new Response(new Uint8Array(1024 * 1024 + 1)),
  );
  assert.equal(cache.get("oversized"), undefined);
  await cache.remember("denied", new Response("", { status: 403 }));
  assert.equal(cache.get("denied"), undefined);
  const small = new CoverCache();
  for (let i = 0; i < 65; i++)
    await small.remember(String(i), new Response("a"));
  assert.equal(small.get("0"), undefined);
  assert.ok(small.get("64"));
});
