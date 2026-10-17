import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/dsh-correlated.js';
import {DshAdapter} from '../src/dsh/host.js';
import {ConnectedRuntime} from '../src/adapter-runtime.js';
test('authenticated dsh marketplace RPC resolves host session and rejects caller origins, identity and model write tools',async t=>{
 const f=await fixture(t);const adapter=new DshAdapter(f.ctx,new ConnectedRuntime(f.c),'profile',f.bridge);const signal=new AbortController().signal;
 const local=await adapter.rpc('amoji/marketplace.local',{sessionId:'session',args:{}},signal) as {installs:unknown[]};assert.ok(Array.isArray(local.installs));
 for(const extra of [{origin:'https://evil.test'},{hostInstanceId:'attacker'},{actor:'admin'}])await assert.rejects(adapter.rpc('amoji/marketplace.local',{sessionId:'session',args:{},...extra},signal),/INVALID_ARGUMENT/);
 await assert.rejects(adapter.rpc('amoji/marketplace.search',{sessionId:'session',args:{query:'',origin:'https://evil.test'}},signal),/INVALID_ARGUMENT/);
 await assert.rejects(adapter.rpc('amoji/marketplace.local',{sessionId:'missing',args:{}},signal));
 assert.equal(f.host.provider.requests.length,0);assert.equal(adapter.tool('amoji_search').name,'amoji_search');
});
