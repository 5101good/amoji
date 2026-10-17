import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './submission-fixture.mjs';
test('health shares persistent public 120/minute limit and does not bypass trusted Origin',async(t)=>{
 const f=await fixture(t);
 for(let i=0;i<120;i++)assert.equal((await f.mf.dispatchFetch('http://localhost/v1/health')).status,503);
 const blocked=await f.mf.dispatchFetch('http://localhost/v1/health');assert.equal(blocked.status,429);assert.ok(blocked.headers.get('retry-after'));
 assert.equal((await f.mf.dispatchFetch('http://localhost/v1/packs')).status,429);
 assert.equal((await f.mf.dispatchFetch('http://untrusted.invalid/v1/health')).status,403);
});
