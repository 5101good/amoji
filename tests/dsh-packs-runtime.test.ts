import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SharedClient } from '../src/shared-client.js';

// This test consumes generated dsh artifacts. test:dsh builds them first;
// the offline, clean-checkout npm test suite must not depend on those files.
test('实际dsh分发runtime可加载普通基础包并提供完整包公共能力', async t => {
  const modulePath = '../adapters/dsh/runtime/src/shared-service.js';
  const { startSharedService: startPackaged } = await import(modulePath);
  const directory = await mkdtemp(join(tmpdir(), 'amoji-packaged-base-'));
  const service = await startPackaged(directory, new URL('../adapters/dsh/assets/base-library/base.amoji', import.meta.url));
  const client = await SharedClient.connect({ directory, requiredCapabilities: ['packs-v1'] });
  t.after(async () => { await client.close(); await service.close(); await rm(directory, { recursive: true, force: true }); });
  const entries = await client.listEntries(); assert.equal(entries.length, 48);
  const result = await client.importPack(await client.exportPack([{ asset_id: entries[0]!.expression.asset_id, revision_id: entries[0]!.expression.revision_id }], '分发自检'));
  assert.equal(result.added, 0); assert.equal(result.existing, 1);
});
