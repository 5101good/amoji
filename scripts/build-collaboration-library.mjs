import {readFile,writeFile,rename,rm} from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import sharp from 'sharp';
import {ZipFile} from 'yazl';
import {withValidatedPack} from '../dist/src/packs.js';
const root=resolve(import.meta.dirname,'..');
const input=resolve(process.argv[2]??`${root}/.local/appearance-library/source`);
const destination=`${root}/assets/base-library`;
const readJson=async path=>JSON.parse(await readFile(path,'utf8'));
const definitions=await readJson(`${destination}/definitions.json`);
const legacy=await readJson(`${root}/tests/fixtures/base-library-v1/manifest.json`);
const previous=await readJson(`${root}/tests/fixtures/base-library-v2/manifest.json`);
const samples=await readJson(`${root}/assets/samples/manifest.json`);
const generation=await readJson(`${destination}/generation.json`);
const uuid=text=>{const b=createHash('sha256').update(text).digest().subarray(0,16);b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;const h=b.toString('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;};
const expressions=[],blobs=new Map(),provenance=[];
for(const appearance of ['classic','office'])for(const definition of definitions.entries){
 const source=await readFile(`${input}/${appearance}/${definition.slug}.png`);
 const original=await sharp(source).metadata();const stats=await sharp(source).stats();
 if(!original.hasAlpha||stats.channels[3]?.min!==0||stats.channels[3]?.max!==255)throw Error(`Missing transparent alpha or opaque subject: ${appearance}/${definition.slug}`);
 // Packaging only: preserve the generated composition and alpha; standardize display budget.
 const bytes=await sharp(source).resize(512,512,{fit:'contain',background:{r:0,g:0,b:0,alpha:0}}).png({compressionLevel:9}).toBuffer();
 const hash=createHash('sha256').update(bytes).digest('hex');blobs.set(hash,bytes);
 let visual={primary:{sha256:hash,mime:'image/png',bytes:bytes.length,width:512,height:512},animated:false};
 const originalIndex=appearance==='classic'?{celebrate:0,wry:1,encourage:2}[definition.slug]:undefined;
 // Keep the original encouragement animation and its matching poster intact.
 if(originalIndex===2){visual=samples.expressions[2].visual;for(const blob of [visual.primary,visual.poster])blobs.set(blob.sha256,await readFile(`${root}/assets/samples/blobs/${blob.sha256}`));blobs.delete(hash);}
 const expression={kind:'amoji.expression',schema_version:'0.1',asset_id:uuid(`amoji-appearance-v3:${appearance}:${definition.slug}`),created_at:'2026-09-21T00:00:00Z',name:definition.name,semantics:definition.semantics,tags:[...definition.tags,`amoji:appearance:${appearance}`,`amoji:family:${definition.family??definition.slug}`],visual,rights:{license:'CC0-1.0',creator:'Amoji contributors',source:'Original Codex imagegen character; assets/base-library/provenance.json'}};
 expression.revision_id=uuid(JSON.stringify(expression));expressions.push(expression);
 const prompt=generation.prompts.find(p=>p.theme===appearance&&p.slug===definition.slug);
 if(originalIndex===undefined&&!prompt)throw Error(`Missing prompt provenance: ${appearance}/${definition.slug}`);
 provenance.push({slug:definition.slug,appearance,group:definition.group,asset_id:expression.asset_id,revision_id:expression.revision_id,source_sha256:createHash('sha256').update(source).digest('hex'),pack_blob:`blobs/${visual.primary.sha256}`,generator:'Codex built-in imagegen',visual_intent:definition.name,reference:appearance==='classic'?'Original three cream-white Amoji characters.':'Original paper-white office character generated for this release.',...(originalIndex!==undefined?{reused_sample:samples.expressions[originalIndex].asset_id,prompt_source:'assets/samples/generation.json'}:{prompt_source:'assets/base-library/generation.json'}),processing:originalIndex===2?'Original animation and poster preserved byte-for-byte.':'Uniform 512px PNG packaging with alpha preserved; no compositional or semantic image editing.'});
}
const manifest={kind:'amoji.pack',schema_version:'0.1',pack_id:uuid(`amoji-appearance-v${definitions.version}:${definitions.entries.length}x2`),name:definitions.name,created_at:'2026-09-21T00:00:00Z',expressions,defaults:expressions.map(({asset_id,revision_id})=>({asset_id,revision_id}))};
const temporary=`${destination}/base.amoji.tmp`;
try{
 const zip=new ZipFile();const done=pipeline(zip.outputStream,createWriteStream(temporary));zip.on('error',error=>zip.outputStream.destroy(error));
 zip.addBuffer(Buffer.from(JSON.stringify(manifest)),'manifest.json',{mtime:new Date(manifest.created_at)});
 for(const [hash,bytes]of blobs)zip.addBuffer(bytes,`blobs/${hash}`,{mtime:new Date(manifest.created_at)});zip.end();await done;
 await withValidatedPack(createReadStream(temporary),async()=>{});
 await rename(temporary,`${destination}/base.amoji`);
 await writeFile(`${destination}/manifest.json`,JSON.stringify(manifest,null,2)+'\n');
 await writeFile(`${destination}/builtin-policy.json`,JSON.stringify({pack_id:manifest.pack_id,retired:[...legacy.defaults,...previous.defaults],retired_samples:samples.defaults},null,2)+'\n');
 await writeFile(`${destination}/provenance.json`,JSON.stringify({license:'CC0-1.0',generated_at:manifest.created_at,collection:'AI collaboration / two visual appearances',entries:provenance},null,2)+'\n');
 console.log(JSON.stringify({expressions:expressions.length,blobs:blobs.size,bytes:[...blobs.values()].reduce((n,b)=>n+b.length,0),pack_id:manifest.pack_id}));
}finally{await rm(temporary,{force:true});}
