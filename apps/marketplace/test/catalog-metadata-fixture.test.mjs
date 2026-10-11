import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
test('bounded metadata fixture preserves production read columns and every index, with complete manifests',async(t)=>{
 const full=new DatabaseSync(':memory:'), metadata=new DatabaseSync(':memory:');t.after(()=>{full.close();metadata.close();});
 for(const name of (await readdir('migrations')).filter(n=>n.endsWith('.sql')).sort())full.exec(await readFile('migrations/'+name,'utf8'));
 const dir=await mkdtemp(tmpdir()+'/amoji-meta-');t.after(()=>rm(dir,{recursive:true,force:true}));
 for(const start of [1,101]){
  execFileSync(process.execPath,['scripts/catalog-load-fixture.mjs',dir+'/fixture.sql','--metadata-only','--start='+start,'--count=100']);metadata.exec(await readFile(dir+'/fixture.sql','utf8'));
 }
 for(const table of ['market_public_release','market_public_pack','auth_rate_limit']){
  assert.deepEqual(metadata.prepare(`PRAGMA table_info(${table})`).all(),full.prepare(`PRAGMA table_info(${table})`).all());
  const indexes=db=>db.prepare(`PRAGMA index_list(${table})`).all().map(row=>({...row,columns:db.prepare(`PRAGMA index_xinfo(${row.name})`).all()}));
  assert.deepEqual(indexes(metadata),indexes(full));
 }
 assert.equal(metadata.prepare('SELECT count(*) n FROM market_public_pack').get().n,200);
 const row=metadata.prepare('SELECT manifest FROM market_public_release LIMIT 1').get();assert.ok(Buffer.byteLength(row.manifest)>13000);assert.ok(JSON.parse(row.manifest).expressions.length>0);
 assert.equal(metadata.prepare('PRAGMA foreign_key_list(market_public_release)').all().length,0);
});
