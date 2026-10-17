import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { Miniflare } from 'miniflare';
import { convertV4MiniflareOptions } from './runtime-fixture.mjs';
import { createHash } from 'node:crypto';

async function fixture(t) {
  const directory = await mkdtemp(tmpdir() + '/amoji-first-paint-');
  const template = await readFile('dist/public/index.html', 'utf8');
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{
    name: 'first-paint', modules: true,
    script: 'Date.now = () => 1800000000000;\n' + await readFile('dist/worker.js', 'utf8'),
    compatibilityDate: '2026-09-21', compatibilityFlags: ['nodejs_compat'],
    d1Databases: { DB: 'first-paint' }, r2Buckets: { UPLOADS: 'first-paint' },
    serviceBindings: { ASSETS: async () => new Response(template, { headers: { 'content-type': 'text/html', 'etag': 'static-template' } }) },
    bindings: { APP_ORIGIN: 'http://localhost', LOCAL_TEST: 'true', BETTER_AUTH_SECRET: 'synthetic-test-secret-at-least-32-bytes' },
  }] }));
  t.after(async () => { await mf.dispose(); await rm(directory, { recursive: true, force: true }); });
  execFileSync(process.execPath, ['scripts/catalog-load-fixture.mjs', directory + '/fixture.sql', '--metadata-only', '--count=21']);
  const db = await mf.getD1Database('DB');
  for (const sql of (await readFile(directory + '/fixture.sql', 'utf8')).split(';\n').filter(s => s.trim())) await db.prepare(sql).run();
  return { db, request: (path = '/', init) => mf.dispatchFetch('http://localhost' + path, init) };
}

test('homepage HTTP already contains visible escaped public summaries and non-executable bootstrap, without full manifests', async t => {
  const f = await fixture(t);
  const malicious = '</div><script>alert("name")</script>';
  await f.db.prepare("UPDATE market_public_release SET manifest=json_set(manifest,'$.name',?,'$.description',?,'$.private_only','DO_NOT_DISCLOSE'),author=? WHERE pack_id=?")
    .bind(malicious, 'A & B < C', '</div><img src=x onerror=alert(1)>', '00000000-0000-4000-8000-000000000021').run();
  const response = await f.request();
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/html/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(response.headers.get('etag'), null);
  const html = await response.text();
  assert.equal((html.match(/class="catalog-row"/g) ?? []).length, 20);
  assert.ok(html.includes('&lt;/div&gt;&lt;script&gt;alert(&quot;name&quot;)&lt;/script&gt;'));
  assert.ok(!html.includes(malicious));
  assert.ok(!html.includes('DO_NOT_DISCLOSE'));
  assert.ok(!html.includes('"expressions"'));
  assert.match(html, /id="catalog-bootstrap" hidden/);
  assert.equal((html.match(/<script\b/g) ?? []).length, 1);
  assert.match(html, /href="\/packs\/00000000-0000-4000-8000-000000000021\/releases\/00000000-0000-4000-8000-000000000021"/);
  assert.match(html, /&quot;cursor&quot;:&quot;/);
});

test('first catalog paint has its stylesheet in the HTML with an exact CSP hash', async t => {
 const f=await fixture(t);const response=await f.request();const html=await response.text();
 const css=/<style data-amoji-base>([\s\S]*?)<\/style>/.exec(html)?.[1];
 assert.ok(css,'first paint must not wait for a second stylesheet request');
 assert.match(css,/\.catalog-row/);
 assert.ok(!html.includes('rel="stylesheet"'));
 const hash=createHash('sha256').update(css).digest('base64');
 assert.ok(response.headers.get('content-security-policy').includes(`'sha256-${hash}'`));
 assert.ok(!response.headers.get('content-security-policy').includes("'unsafe-inline'"));
 const assetHeaders=await readFile('dist/public/_headers','utf8');
 assert.ok(assetHeaders.includes(`'sha256-${hash}'`),'static detail pages permit the same bundled stylesheet');
});

test('homepage and catalog API consume the same public allowance; exhaustion never serves stale rows', async t => {
  const f = await fixture(t);
  for (let n = 0; n < 119; n++) assert.equal((await f.request('/v1/packs')).status, 200);
  assert.equal((await f.request()).status, 200);
  const denied = await f.request('/', { headers: { 'x-amoji-edge-ip': '192.0.2.1' } });
  assert.equal(denied.status, 429);
  assert.ok(!(await denied.text()).includes('catalog-row'));
  assert.equal((await f.request('/v1/packs')).status, 429);
});

test('malformed or excessively long public summary fails closed before HTML injection', async t => {
  const f = await fixture(t);
  for (const value of ['x'.repeat(10000), ['not', 'a', 'name']]) {
    await f.db.prepare("UPDATE market_public_release SET manifest=json_set(manifest,'$.name',json(?))").bind(JSON.stringify(value)).run();
    const response = await f.request();
    assert.equal(response.status, 503);
    assert.ok(!(await response.text()).includes('catalog-row'));
  }
});

test('homepage preserves literal replacement metacharacters in public names', async t => {
  const f = await fixture(t);
  const name = "price $& $` $' $$ value";
  await f.db.prepare("UPDATE market_public_release SET manifest=json_set(manifest,'$.name',?)").bind(name).run();
  const response = await f.request();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.equal((html.match(/id="root"/g) ?? []).length, 1);
  assert.ok(html.includes("price $&amp; $` $&#39; $$ value"));
  const encoded = /<div id="catalog-bootstrap" hidden>(.*?)<\/div>/.exec(html)?.[1];
  assert.ok(encoded);
  const decoded = encoded.replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
  assert.equal(JSON.parse(decoded).packs[0].manifest.name, name);
});
