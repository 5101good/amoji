import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { unzipSync, zipSync } from 'fflate';
import { fixture } from './submission-fixture.mjs';
import { hash } from './upload-fixtures.mjs';

test('seven official collections pass real Worker validation, independent review and public downloads', async t => {
  const f = await fixture(t);
  const reviewer = await f.register('official-reviewer@example.test');
  await f.db.prepare("UPDATE market_account SET role='reviewer' WHERE auth_user_id=(SELECT id FROM auth_user WHERE email='official-reviewer@example.test')").run();
  const catalog = JSON.parse(await readFile(new URL('../../../assets/official-packs/catalog.json', import.meta.url), 'utf8'));
  for (const entry of catalog.packs) {
    const u = await f.reserve();
    const files = unzipSync(await readFile(new URL(`../../../assets/official-packs/${entry.slug}.amoji`, import.meta.url)));
    const original = JSON.parse(new TextDecoder().decode(files['manifest.json']));
    const manifest = {...original, pack_id: u.pack_id, release_id: u.release_id, version: u.version, derived_from: {pack_id: original.pack_id, release_id: original.release_id}};
    files['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest));
    const bytes = zipSync(files);
    await f.put(await f.authorize(u, bytes), bytes);
    const completed = await f.post(`/v1/uploads/${u.id}/complete`, {}, f.cookie);
    assert.equal(completed.status, 200, `${entry.slug}: ${await completed.clone().text()}`);
    const upload = (await completed.json()).upload;
    const submitted = await f.post('/v1/submissions', {upload_id: u.id, rights_confirmed: true}, f.cookie, crypto.randomUUID(), {'if-match': `"${upload.row_version}"`});
    assert.equal(submitted.status, 201, await submitted.clone().text());
    const s = (await submitted.json()).submission;
    const decided = await f.post(`/v1/review/submissions/${s.id}/decision`, {decision: 'approve', reason: 'Isolated test: exact generated artwork, fixed semantics and CC0 provenance checked.'}, reviewer, crypto.randomUUID(), {'if-match': `"${s.row_version}"`});
    assert.equal(decided.status, 200, await decided.clone().text());
    const path = `http://localhost/v1/packs/${s.pack_id}/releases/${s.release_id}`;
    const detail = await (await f.mf.dispatchFetch(path)).json();
    assert.deepEqual(detail.manifest.expressions, original.expressions);
    const download = await f.mf.dispatchFetch(path + '/archive');
    assert.equal(download.status, 200);
    assert.equal(hash(new Uint8Array(await download.arrayBuffer())), hash(bytes));
    const cover = await f.mf.dispatchFetch(path + '/cover');
    assert.equal(cover.status, 200);
    const first = original.expressions[0].visual.poster ?? original.expressions[0].visual.primary;
    assert.equal(hash(new Uint8Array(await cover.arrayBuffer())), first.sha256);
  }
  const directory = await (await f.mf.dispatchFetch('http://localhost/v1/packs')).json();
  assert.equal(directory.packs.length, 7);
  assert.deepEqual(directory.packs.map(p => p.expression_count).sort((a,b) => a-b), [4,4,4,4,4,24,24]);
  const pixels = await (await f.mf.dispatchFetch('http://localhost/v1/packs?style=pixel&actions=false')).json();
  assert.equal(pixels.packs.length, 1);
  assert.match(pixels.packs[0].manifest.name, /Pixel Pal/);
});
