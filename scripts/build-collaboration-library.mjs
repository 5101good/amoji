import {readFile,writeFile,mkdir,rename,rm} from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import sharp from 'sharp';
import {ZipFile} from 'yazl';
import {withValidatedPack} from '../dist/src/packs.js';
const root=resolve(import.meta.dirname,'..');
const input=resolve(process.argv[2]??`${root}/.local/cooperation-library/source`);
const destination=`${root}/assets/base-library`;
const definitions=JSON.parse(await readFile(`${destination}/definitions.json`,'utf8'));
const legacy=JSON.parse(await readFile(`${root}/tests/fixtures/base-library-v1/manifest.json`,'utf8'));
const uuid=text=>{const b=createHash('sha256').update(text).digest().subarray(0,16);b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;const h=b.toString('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;};
const expressions=[],blobs=new Map(),provenance=[];
for(const definition of definitions.entries){
 const source=await readFile(`${input}/${definition.slug}.png`);
 const original=await sharp(source).metadata();if(!original.hasAlpha)throw Error(`Missing alpha: ${definition.slug}`);
 // Asset packaging only: preserve composition and alpha, resize to a shared display budget.
 const bytes=await sharp(source).resize(512,512,{fit:'contain',background:{r:0,g:0,b:0,alpha:0}}).png({compressionLevel:9}).toBuffer();
 const hash=createHash('sha256').update(bytes).digest('hex');blobs.set(hash,bytes);
 const expression={kind:'amoji.expression',schema_version:'0.1',asset_id:uuid(`amoji-cooperation-v2:${definition.slug}`),created_at:'2026-09-21T00:00:00Z',name:definition.name,semantics:definition.semantics,tags:definition.tags,visual:{primary:{sha256:hash,mime:'image/png',bytes:bytes.length,width:512,height:512},animated:false},rights:{license:'CC0-1.0',creator:'Amoji contributors',source:'Original Codex imagegen character; assets/base-library/provenance.json'}};
 expression.revision_id=uuid(JSON.stringify(expression));expressions.push(expression);
 provenance.push({slug:definition.slug,group:definition.group,asset_id:expression.asset_id,revision_id:expression.revision_id,source_sha256:createHash('sha256').update(source).digest('hex'),pack_blob:`blobs/${hash}`,generator:'Codex built-in imagegen',visual_intent:definition.name,reference:'Original progress mascot generated for this release. No external IM or real-person reference.',processing:'Uniform 512px PNG packaging with alpha preserved; no compositional or semantic image editing.'});
}
const manifest={kind:'amoji.pack',schema_version:'0.1',pack_id:uuid('amoji-cooperation-v2:14'),name:definitions.name,created_at:'2026-09-21T00:00:00Z',expressions,defaults:expressions.map(({asset_id,revision_id})=>({asset_id,revision_id}))};
const temporary=`${destination}/base.amoji.tmp`;
try{
 const zip=new ZipFile();const done=pipeline(zip.outputStream,createWriteStream(temporary));zip.on('error',error=>zip.outputStream.destroy(error));
 zip.addBuffer(Buffer.from(JSON.stringify(manifest)),'manifest.json',{mtime:new Date(manifest.created_at)});
 for(const [hash,bytes]of blobs)zip.addBuffer(bytes,`blobs/${hash}`,{mtime:new Date(manifest.created_at)});zip.end();await done;
 await withValidatedPack(createReadStream(temporary),async()=>{});
 await rename(temporary,`${destination}/base.amoji`);
 await writeFile(`${destination}/manifest.json`,JSON.stringify(manifest,null,2)+'\n');
 await writeFile(`${destination}/builtin-policy.json`,JSON.stringify({pack_id:manifest.pack_id,retired:legacy.defaults},null,2)+'\n');
 await writeFile(`${destination}/provenance.json`,JSON.stringify({license:'CC0-1.0',generated_at:manifest.created_at,collection:'AI collaboration',entries:provenance},null,2)+'\n');
 console.log(JSON.stringify({expressions:expressions.length,blobs:blobs.size,bytes:[...blobs.values()].reduce((n,b)=>n+b.length,0),pack_id:manifest.pack_id}));
}finally{await rm(temporary,{force:true});}
