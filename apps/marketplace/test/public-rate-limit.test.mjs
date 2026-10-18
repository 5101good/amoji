import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { Miniflare } from 'miniflare';
import { convertV4MiniflareOptions } from './runtime-fixture.mjs';

// Real Worker, SQLite DO and D1. Only the wall clock is replaced, so bucket
// boundaries and a full runtime restart are deterministic without private APIs.
const activationTime = 1800000000000;
const steadyTime = activationTime + 60000;
async function fixture(t, { activating = false } = {}) {
  const directory = await mkdtemp(tmpdir() + '/amoji-public-rate-');
  const script = await readFile(new URL('../dist/worker.js', import.meta.url), 'utf8');
  let mf;
  async function restart(now = steadyTime, bindings = {}) {
    await mf?.dispose();
    mf = new Miniflare(convertV4MiniflareOptions({
      resourcePersistencePath: directory,
      workers: [{
        name: 'public-rate', modules: true,
        script: `Date.now = () => ${now};\n` + script,
        compatibilityDate: '2026-09-21', compatibilityFlags: ['nodejs_compat'],
        d1Databases: { DB: 'public-rate' }, r2Buckets: { UPLOADS: 'public-rate' },
        bindings: {
          APP_ORIGIN: 'http://localhost', LOCAL_TEST: 'true',
          BETTER_AUTH_SECRET: 'synthetic-test-secret-at-least-32-bytes', ...bindings,
        },
      }],
    }));
  }
  t.after(async () => { await mf?.dispose(); await rm(directory, { recursive: true, force: true }); });
  await restart(activationTime);
  const db = await mf.getD1Database('DB');
  const migrations = new URL('../migrations/', import.meta.url);
  for (const name of (await readdir(migrations)).filter(name => name.endsWith('.sql')).sort()) {
    const sql = await readFile(new URL(name, migrations), 'utf8');
    for (const statement of sql.split(/;\n(?=CREATE|ALTER|DROP|--)/).filter(s => s.trim()))
      await db.prepare(statement).run();
  }
  await mf.dispatchFetch('http://localhost/v1/auth/csrf');
  if (!activating) await restart();
  return {
    db: await mf.getD1Database('DB'), restart,
    database: () => mf.getD1Database('DB'),
    request: (path, init) => mf.dispatchFetch('http://localhost' + path, init),
  };
}
const paths = ['/v1/packs', '/v1/revocations', '/v1/health', '/v1/reports/00000000-0000-4000-8000-000000000001/receipt'];
const statuses = [200, 200, 503, 404]; // Missing backup and nonexistent receipt are normal fixture states.

test('public reads remain available when D1 rate writes fail, while auth/device/report writes still fail closed', async t => {
  const f = await fixture(t);
  await f.db.prepare("CREATE TRIGGER unavailable_rate_write BEFORE INSERT ON auth_rate_limit BEGIN SELECT RAISE(ABORT,'RATE_STORAGE_UNAVAILABLE'); END").run();
  for (let i = 0; i < paths.length; i++) {
    const response = await f.request(paths[i]);
    assert.equal(response.status, statuses[i], paths[i]);
    if (paths[i] === '/v1/health') assert.equal((await response.json()).service, 'amoji-marketplace');
  }
  const csrf = await (await f.request('/v1/auth/csrf')).json();
  for (const [path, data, headers, code] of [
    ['/v1/device-authorizations', { device_name: 'Rate boundary' }, {}, 'DEVICE_UNAVAILABLE'],
    ['/v1/reports', {}, {}, 'UNAVAILABLE'],
    ['/v1/auth/login', {}, { origin: 'http://localhost', 'x-csrf-token': csrf.csrf }, 'UNAVAILABLE'],
  ]) {
    const response = await f.request(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(data) });
    assert.equal(response.status, 503, path);
    assert.equal((await response.json()).error.code, code, path);
  }
});

test('120 public reads share one persistent per-minute allowance across paths and concurrent requests', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 116; i++) assert.equal((await f.request(paths[i % 4])).status, statuses[i % 4]);
  await f.restart();
  const last = await Promise.all(Array.from({ length: 8 }, () => f.request('/v1/packs')));
  assert.deepEqual(last.map(r => r.status).sort(), [200, 200, 200, 200, 429, 429, 429, 429]);
  for (const path of paths) {
    const denied = await f.request(path, { headers: { 'x-amoji-edge-ip': '192.0.2.1', 'x-forwarded-for': '192.0.2.2' } });
    assert.equal(denied.status, 429, path);
    assert.equal((await denied.json()).error.code, 'RATE_LIMITED');
    assert.ok(Number(denied.headers.get('retry-after')) > 0);
  }
  await f.restart();
  assert.equal((await f.request('/v1/packs')).status, 429);
  await f.restart(steadyTime + 60000);
  for (let i = 0; i < paths.length; i++) assert.equal((await f.request(paths[i])).status, statuses[i]);
});

test('activation minute keeps the existing D1 allowance across restarts and changes storage only in the next minute', async t => {
  const f = await fixture(t, { activating: true });
  for (let i = 0; i < 116; i++) assert.equal((await f.request(paths[i % 4])).status, statuses[i % 4]);
  await f.db.prepare("CREATE TRIGGER unavailable_rate_write BEFORE INSERT ON auth_rate_limit BEGIN SELECT RAISE(ABORT,'RATE_STORAGE_UNAVAILABLE'); END").run();
  const unavailable = await f.request('/v1/packs');
  assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.json()).error.code, 'UNAVAILABLE');
  await f.db.prepare('DROP TRIGGER unavailable_rate_write').run();
  await f.restart(activationTime);
  const last = await Promise.all(Array.from({ length: 8 }, () => f.request('/v1/packs')));
  assert.deepEqual(last.map(r => r.status).sort(), [200, 200, 200, 200, 429, 429, 429, 429]);
  await f.restart(activationTime);
  for (const path of paths) assert.equal((await f.request(path)).status, 429);
  await f.restart(steadyTime);
  const db = await f.database();
  await db.prepare("CREATE TRIGGER unavailable_rate_write BEFORE INSERT ON auth_rate_limit BEGIN SELECT RAISE(ABORT,'RATE_STORAGE_UNAVAILABLE'); END").run();
  for (let i = 0; i < paths.length; i++) assert.equal((await f.request(paths[i])).status, statuses[i]);
  await f.restart(steadyTime);
  assert.equal((await f.request('/v1/packs')).status, 200);
});

test('origin and secret checks still precede public access', async t => {
  const f = await fixture(t);
  await f.restart(1800000000000, { APP_ORIGIN: 'http://other.invalid' });
  let response = await f.request('/v1/packs');
  assert.equal(response.status, 403); assert.equal((await response.json()).error.code, 'ORIGIN');
  await f.restart(1800000000000, { BETTER_AUTH_SECRET: '' });
  response = await f.request('/v1/packs');
  assert.equal(response.status, 503); assert.equal((await response.json()).error.code, 'CONFIGURATION');
});
