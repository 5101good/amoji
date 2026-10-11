import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
await build({entryPoints:['src/backup.ts'],outfile:'dist/backup-test.mjs',platform:'node',format:'esm',bundle:true});
const { runBackup, backupHealth } = await import('../dist/backup-test.mjs');
function fixture() {
  const objects=new Map(); const calls=[];
  const bucket={async get(key){const v=objects.get(key);return v?{json:async()=>JSON.parse(v),text:async()=>v}:null;},async put(key,body){objects.set(key,typeof body==='string'?body:new TextDecoder().decode(body));},async list(){return {objects:[],truncated:false};},async delete(key){objects.delete(key);}};
  const env={UPLOADS:bucket,BACKUP_ACCOUNT_ID:'a'.repeat(32),BACKUP_DATABASE_ID:'11111111-1111-4111-8111-111111111111',D1_BACKUP_API_TOKEN:'synthetic-only'};
  const now=Date.parse('2026-10-11T03:00:00Z');
  const network=async(url,init)=>{calls.push({url,init});return String(url).startsWith('https://api.cloudflare.com/')?Response.json({success:true,result:{status:'complete',result:{filename:'db.sql',signed_url:'https://1ad59b064bfa3690063414a9906129e4.r2.cloudflarestorage.com/db.sql?signature=synthetic'}}}):new Response('CREATE TABLE example(id TEXT);');};
  return {objects,calls,env,now,network};
}
test('daily export saves SQL and digest privately; repeat cron does not export again',async()=>{
 const f=fixture(); await runBackup(f.env,f.now,f.network);
 const status=JSON.parse(f.objects.get('backups/status.json'));const sql=f.objects.get(status.key);
 assert.equal(sql,'CREATE TABLE example(id TEXT);');assert.equal(status.sha256,createHash('sha256').update(sql).digest('hex'));
 assert.deepEqual(await backupHealth(f.env,f.now),{status:'ok',last_success_at:f.now});
 await runBackup(f.env,f.now+900000,f.network);assert.equal(f.calls.length,2);
 assert.equal((await backupHealth(f.env,f.now+86400001)).status,'stale');
});
test('polling preserves bookmark, failed export preserves previous good backup and redacts failures',async()=>{
 const f=fixture();await runBackup(f.env,f.now,f.network);
 const old=JSON.parse(f.objects.get('backups/status.json'));
 const poll=async()=>Response.json({success:true,result:{status:'active',at_bookmark:'opaque-bookmark'}});
 await runBackup(f.env,f.now+86400000,poll);assert.equal(JSON.parse(f.objects.get('backups/pending.json')).bookmark,'opaque-bookmark');
 let request;await runBackup(f.env,f.now+86490000,async(_u,init)=>{request=JSON.parse(init.body);throw Error('secret-value');});
 assert.equal(request.current_bookmark,'opaque-bookmark');assert.equal(JSON.parse(f.objects.get('backups/status.json')).key,old.key);
 assert.ok(!f.objects.get('backups/status.json').includes('secret-value'));
});
test('untrusted export URL or oversize SQL never becomes a successful backup',async()=>{
 for(const url of ['https://attacker.example/db.sql','http://export.d1.cloudflare.com/db.sql','https://export.d1.cloudflare.com.attacker.example/db.sql']){
  const f=fixture();let calls=0;await runBackup(f.env,f.now,async()=>{calls++;return Response.json({success:true,result:{status:'complete',result:{signed_url:url}}});});
  assert.equal(calls,1);assert.equal((await backupHealth(f.env,f.now)).status,'failed');
 }
 const f=fixture();await runBackup(f.env,f.now,async(url,init)=>String(url).startsWith('https://api.cloudflare.com/')?f.network(url,init):new Response('small',{headers:{'content-length':String(32*1024*1024+1)}}));
 assert.equal((await backupHealth(f.env,f.now)).status,'failed');
});
