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

test('打包后的动作runtime接入真实recording provider并核对原生回执',async t=>{
 const {fixture}=await import('./helpers/dsh-correlated.js');const f=await fixture(t);f.bridge.dispose();
 const hostPath='../adapters/dsh/runtime/src/dsh/host.js',bridgePath='../adapters/dsh/runtime/src/dsh/collaboration.js',runtimePath='../adapters/dsh/runtime/src/adapter-runtime.js';
 const [{DshAdapter},{DshCollaboration},{ConnectedRuntime}]=await Promise.all([import(hostPath),import(bridgePath),import(runtimePath)]);const bridge=new DshCollaboration(f.host.ctx,new ConnectedRuntime(f.c),'profile');const adapter=new DshAdapter(f.ctx,new ConnectedRuntime(f.c),'profile',bridge);t.after(()=>bridge.dispose());
 await adapter.rpc('amoji/submitWithAction',{sessionId:'session',ref:f.ref,requestId:'packaged-action',actionRef:{action_id:f.action.action_id,action_revision_id:f.action.action_revision_id},releaseRef:{release_id:f.action.release_id}},new AbortController().signal);await f.live.whenIdle();const rows=await adapter.rpc('amoji/history',{sessionId:'session'},new AbortController().signal);assert.equal(rows[0].action.status,'attached');assert.equal(f.host.provider.requests.length,1);assert.ok(JSON.stringify(f.host.provider.requests).includes('EXACT {{literal}} ACTION'));
});
