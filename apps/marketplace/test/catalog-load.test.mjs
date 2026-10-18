import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {fixture} from './submission-fixture.mjs';
test('10000-package catalog returns first-page metadata at 20 concurrent readers',async(t)=>{
 const f=await fixture(t);const dir=await mkdtemp(tmpdir()+'/amoji-load-');t.after(()=>rm(dir,{recursive:true,force:true}));
 execFileSync(process.execPath,['scripts/catalog-load-fixture.mjs',dir+'/fixture.sql']);
 for(const statement of (await readFile(dir+'/fixture.sql','utf8')).split(';\n').filter(s=>s.trim()))await f.db.prepare(statement).run();
 assert.equal((await f.db.prepare('SELECT count(*) AS n FROM market_public_pack').first()).n,10000);
 const times=[];
 for(let round=0;round<5;round++)await Promise.all(Array.from({length:20},async()=>{
  const response=await f.mf.dispatchFetch('http://localhost/v1/packs?q=performance');assert.equal(response.status,200);const data=await response.json();assert.equal(data.packs.length,20);assert.ok(data.cursor);assert.equal(data.packs[0].pack_id,'00000000-0000-4000-8000-000000010000');
  times.push(Number(/amoji;dur=([0-9.]+)/.exec(response.headers.get('server-timing'))[1]));
 }));
 const p95=times.sort((a,b)=>a-b)[94];t.diagnostic(JSON.stringify({environment:'local workerd/D1',packs:10000,concurrency:20,samples:times.length,server_p95_ms:p95,cloud_verified:false}));
 // Cloud latency is accepted only against the separately deployed isolated fixture.
});
