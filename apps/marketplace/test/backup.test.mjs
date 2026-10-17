import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
await build({entryPoints:['src/backup.ts'],outfile:'dist/backup-test.mjs',platform:'node',format:'esm',bundle:true});
globalThis.FixedLengthStream=class extends TransformStream { constructor(expected) { let size=0;super({transform(chunk,controller){size+=chunk.length;controller.enqueue(chunk);},flush(){assert.equal(size,expected);}}); } };
const { runBackup, backupHealth } = await import('../dist/backup-test.mjs');
function fixture() {
  const objects=new Map(); const calls=[];
  const bucket={async get(key){const v=objects.get(key);return v?{json:async()=>JSON.parse(v),text:async()=>v}:null;},async put(key,body){objects.set(key,typeof body==='string'?body:body instanceof ReadableStream?await new Response(body).text():new TextDecoder().decode(body));},async list(){return {objects:[],truncated:false};},async delete(key){objects.delete(key);}};
  const env={UPLOADS:bucket,BACKUP_ACCOUNT_ID:'a'.repeat(32),BACKUP_DATABASE_ID:'11111111-1111-4111-8111-111111111111',D1_BACKUP_API_TOKEN:'synthetic-only'};
  const now=Date.parse('2026-10-11T03:00:00Z');
  const network=async(url,init)=>{calls.push({url,init});return String(url).startsWith('https://api.cloudflare.com/')?Response.json({success:true,result:{status:'complete',result:{filename:'db.sql',signed_url:'https://1ad59b064bfa3690063414a9906129e4.r2.cloudflarestorage.com/db.sql?signature=synthetic'}}}):new Response('CREATE TABLE example(id TEXT);',{headers:{'content-length':String(Buffer.byteLength('CREATE TABLE example(id TEXT);'))}});};
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
test('one maintenance run continuously polls D1 until a usable private snapshot is saved',async()=>{
 const f=fixture();let polls=0;
 await runBackup(f.env,f.now,async(url,init)=>{
  if(String(url).startsWith('https://api.cloudflare.com/')){
   const request=JSON.parse(init.body);
   if(polls++===0){assert.equal(request.current_bookmark,undefined);return Response.json({success:true,result:{success:true,at_bookmark:'same-export'}});}
   assert.equal(request.current_bookmark,'same-export');
   if(polls<3)return Response.json({success:true,result:{success:true,at_bookmark:'same-export'}});
  }
  return f.network(url,init);
 });
 assert.deepEqual(await backupHealth(f.env,f.now),{status:'ok',last_success_at:f.now});
 const status=JSON.parse(f.objects.get('backups/status.json'));
 assert.equal(f.objects.get(status.key),'CREATE TABLE example(id TEXT);');
});
test('a stalled export is bounded, preserves the good snapshot, and restarts without an expired bookmark',async()=>{
 const f=fixture();await runBackup(f.env,f.now,f.network);
 const old=JSON.parse(f.objects.get('backups/status.json'));
 let polls=0;
 const poll=async()=>{polls++;return Response.json({success:true,result:{status:'active',at_bookmark:'opaque-bookmark'}});};
 await runBackup(f.env,f.now+86400000,poll);
 assert.ok(polls>1&&polls<=24,'export must stop within its free-plan request budget');
 assert.equal(JSON.parse(f.objects.get('backups/status.json')).key,old.key);
 assert.equal((await backupHealth(f.env,f.now+86400000)).status,'failed');
 // An old deployment may have persisted a bookmark before this fix.
 f.objects.set('backups/pending.json',JSON.stringify({started_at:f.now,bookmark:'expired-bookmark'}));
 let request;await runBackup(f.env,f.now+86490000,async(_u,init)=>{request=JSON.parse(init.body);throw Error('secret-value');});
 assert.equal(request.current_bookmark,undefined);assert.equal(JSON.parse(f.objects.get('backups/status.json')).key,old.key);
 assert.ok(!f.objects.get('backups/status.json').includes('secret-value'));
 await runBackup(f.env,f.now+87300000,f.network);
 assert.equal((await backupHealth(f.env,f.now+87300000)).status,'ok');
 assert.equal(f.objects.has('backups/pending.json'),false);
});
test('untrusted export URL or oversize SQL never becomes a successful backup',async()=>{
 for(const url of ['https://attacker.example/db.sql','http://export.d1.cloudflare.com/db.sql','https://export.d1.cloudflare.com.attacker.example/db.sql']){
  const f=fixture();let calls=0;await runBackup(f.env,f.now,async()=>{calls++;return Response.json({success:true,result:{status:'complete',result:{signed_url:url}}});});
  assert.equal(calls,1);assert.equal((await backupHealth(f.env,f.now)).status,'failed');
 }
 const f=fixture();await runBackup(f.env,f.now,async(url,init)=>String(url).startsWith('https://api.cloudflare.com/')?f.network(url,init):new Response('small',{headers:{'content-length':String(256*1024*1024+1)}}));
 assert.equal((await backupHealth(f.env,f.now)).status,'failed');
});
test('export failure still expires private SQL, including the last successful object after retention',async()=>{
 const f=fixture();await runBackup(f.env,f.now,f.network);const old=JSON.parse(f.objects.get('backups/status.json'));
 f.env.UPLOADS.list=async()=>({objects:[{key:old.key,uploaded:new Date(f.now)}],truncated:false});
 await runBackup(f.env,f.now+31*86400000,async()=>new Response(null,{status:403}));
 assert.equal(f.objects.has(old.key),false);assert.equal((await backupHealth(f.env,f.now+31*86400000)).status,'failed');
 assert.ok(!JSON.parse(f.objects.get('backups/status.json')).key);
});

test('streams a 140 MiB export without requiring an in-memory SQL buffer',async()=>{
 const f=fixture();const chunk=new Uint8Array(1024*1024).fill(65);const expected=createHash('sha256');for(let i=0;i<140;i++)expected.update(chunk);
 const originalPut=f.env.UPLOADS.put;let stored=0;
 f.env.UPLOADS.put=async(key,body)=>{if(body instanceof ReadableStream){const reader=body.getReader();while(true){const {value,done}=await reader.read();if(done)break;stored+=value.length;}}else await originalPut(key,body);};
 await runBackup(f.env,f.now,async(url,init)=>String(url).startsWith('https://api.cloudflare.com/')?f.network(url,init):new Response(new ReadableStream({start(controller){for(let i=0;i<140;i++)controller.enqueue(chunk);controller.close();}}),{headers:{'content-length':String(140*1024*1024)}}));
 assert.equal(stored,140*1024*1024);assert.equal(JSON.parse(f.objects.get('backups/status.json')).sha256,expected.digest('hex'));
});
test('2 GiB shared backup budget retires oldest SQL while retaining the last good snapshot',async()=>{
 const f=fixture();await runBackup(f.env,f.now,f.network);const last=JSON.parse(f.objects.get('backups/status.json'));
 f.objects.set('backups/d1/older.sql','private old SQL');
 f.env.UPLOADS.list=async()=>({objects:[{key:'backups/d1/older.sql',uploaded:new Date(f.now-86400000),size:1536*1024*1024},{key:last.key,uploaded:new Date(f.now),size:1024*1024*1024}],truncated:false});
 await runBackup(f.env,f.now+43200000,f.network);
 assert.equal(f.objects.has('backups/d1/older.sql'),false);assert.equal(f.objects.has(last.key),true);assert.equal((await backupHealth(f.env,f.now+43200000)).status,'ok');
});
test('successful export still exposes retention failure until cleanup recovers',async()=>{
 const f=fixture();await runBackup(f.env,f.now,f.network);
 const expired='backups/d1/expired.sql';f.objects.set(expired,'private SQL');
 f.env.UPLOADS.list=async()=>({objects:[{key:expired,uploaded:new Date(f.now-31*86400000),size:11}],truncated:false});
 const remove=f.env.UPLOADS.delete;f.env.UPLOADS.delete=async()=>{throw Error('synthetic failure');};
 await runBackup(f.env,f.now+13*3600000,f.network);
 assert.equal((await backupHealth(f.env,f.now+13*3600000)).status,'failed');
 f.env.UPLOADS.delete=remove;await runBackup(f.env,f.now+14*3600000,f.network);
 assert.equal((await backupHealth(f.env,f.now+14*3600000)).status,'ok');
});
