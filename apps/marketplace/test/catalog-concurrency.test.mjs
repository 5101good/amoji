import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './submission-fixture.mjs';
test('twenty concurrent anonymous metadata readers do not consume the eight heavy-job slots',async(t)=>{
 const f=await fixture(t);
 const results=await Promise.all(Array.from({length:20},()=>f.mf.dispatchFetch('http://localhost/v1/packs')));
 assert.deepEqual(results.map(r=>r.status),Array(20).fill(200));
});
