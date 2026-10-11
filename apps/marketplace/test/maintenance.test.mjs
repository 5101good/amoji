import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
await build({entryPoints:['src/maintenance.ts'],outfile:'dist/maintenance-test.mjs',platform:'node',format:'esm',bundle:true});
const {scheduledMaintenance}=await import('../dist/maintenance-test.mjs');
test('cleanup rejection or transport failure never prevents the independently scheduled backup',async()=>{
 for(const throws of [false,true]){
  const calls=[];const env={FREE_RUNTIME:{getByName(name){return{async fetch(){calls.push(name);if(name==='free-runtime-v1'){if(throws)throw Error('private transport detail');return new Response(null,{status:429});}return new Response(null,{status:200});}};}}};
  await assert.rejects(()=>scheduledMaintenance(env));assert.deepEqual(calls.sort(),['backup-v1','free-runtime-v1']);
 }
});
