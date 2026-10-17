import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {convertV4MiniflareOptions} from './runtime-fixture.mjs';

test('backup request options work in workerd and redirects fail closed',async t=>{
 const built=await build({entryPoints:['src/backup.ts'],bundle:true,platform:'neutral',format:'esm',external:['node:*'],write:false});
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{
  name:'backup-native',modules:true,compatibilityDate:'2026-09-21',compatibilityFlags:['nodejs_compat'],
  script:built.outputFiles[0].text+`
  export default {async fetch(request){
   const objects=new Map(),redirects=[];
   const env={BACKUP_ACCOUNT_ID:'a'.repeat(32),BACKUP_DATABASE_ID:'11111111-1111-4111-8111-111111111111',D1_BACKUP_API_TOKEN:'synthetic-only',UPLOADS:{
    async get(k){return objects.has(k)?{json:async()=>JSON.parse(objects.get(k))}:null;},
    async put(k,b){objects.set(k,typeof b==='string'?b:await new Response(b).text());},
    async list(){return {objects:[],truncated:false};},async delete(k){objects.delete(k);}
   }};
   await runBackup(env,Date.now(),async(url,init)=>{
    const native=new Request(url,init);redirects.push(native.redirect);
    if(new URL(request.url).pathname==='/redirect')return new Response(null,{status:302,headers:{location:'https://attacker.invalid/'}});
    if(String(url).startsWith('https://api.cloudflare.com/'))return Response.json({success:true,result:{status:'complete',result:{signed_url:'https://1ad59b064bfa3690063414a9906129e4.r2.cloudflarestorage.com/db.sql'}}});
    if(new URL(request.url).pathname==='/download-redirect')return new Response(null,{status:302,headers:{location:'https://attacker.invalid/'}});
    const sql='CREATE TABLE example(id TEXT);';return new Response(sql,{headers:{'content-length':String(sql.length)}});
   });
   return Response.json({health:await backupHealth(env),redirects,status:JSON.parse(objects.get('backups/status.json'))});
  }};`
 }]}));
 t.after(()=>mf.dispose());
 const success=await(await mf.dispatchFetch('http://localhost/')).json();
 assert.equal(success.health.status,'ok');assert.deepEqual(success.redirects,['manual','manual']);
 const denied=await(await mf.dispatchFetch('http://localhost/redirect')).json();
 assert.equal(denied.health.status,'failed');assert.equal(denied.status.failure_code,'BACKUP_EXPORT');assert.deepEqual(denied.redirects,['manual']);
 const downloadDenied=await(await mf.dispatchFetch('http://localhost/download-redirect')).json();
 assert.equal(downloadDenied.health.status,'failed');assert.equal(downloadDenied.status.failure_code,'BACKUP_DOWNLOAD');assert.deepEqual(downloadDenied.redirects,['manual','manual']);
});
