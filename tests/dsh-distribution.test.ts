import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
test('实际分发清单包含当前Sharp原生包及libvips版本，不把隐藏exports误判未安装',async()=>{
 const record=JSON.parse(await readFile(new URL('../adapters/dsh/THIRD_PARTY.json',import.meta.url),'utf8'));
 assert.equal(record.runtimeDependenciesEmbedded,false);
 assert.equal(record.clientSha256,createHash('sha256').update(await readFile(new URL('../adapters/dsh/client.js',import.meta.url))).digest('hex'));
 if(process.platform==='darwin'&&process.arch==='arm64'){
  const native=record.packages.find((p:any)=>p.name==='@img/sharp-libvips-darwin-arm64');assert.ok(native,'当前实际动态库必须出现在清单');
  assert.equal(native.license,'LGPL-3.0-or-later');assert.equal(native.nativeComponents.vips,sharp.versions.vips);
  assert.ok(record.packages.find((p:any)=>p.name==='@img/sharp-darwin-arm64'));
  assert.ok(native.licenses.some((p:string)=>p.endsWith('README.md')));
 }
});
