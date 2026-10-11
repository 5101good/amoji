// Generates a synthetic dataset only. Never execute against a production database.
import { readFile, writeFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';
const target=process.argv[2];if(!target)throw Error('Usage: node scripts/catalog-load-fixture.mjs PRIVATE_OUTPUT.sql');
const zip=unzipSync(await readFile(new URL('../../../assets/scenario-packs/make-it-clear.amoji',import.meta.url)));
const manifest=JSON.parse(new TextDecoder().decode(zip['manifest.json']));
const literal=JSON.stringify(manifest).replaceAll("'","''");
const metadataOnly=process.argv.includes('--metadata-only');
const option=(name,fallback)=>Number(process.argv.find(arg=>arg.startsWith(name+'='))?.split('=')[1]??fallback);
const start=option('--start',1),count=option('--count',10000);
if(!Number.isSafeInteger(start)||!Number.isSafeInteger(count)||start<1||count<1||start+count-1>10000)throw Error('FIXTURE_RANGE');
if(!metadataOnly&&(start!==1||count!==10000))throw Error('FULL_FIXTURE_RANGE');
const seq=`WITH RECURSIVE seq(i) AS (SELECT ${start} UNION ALL SELECT i+1 FROM seq WHERE i<${start+count-1})`;
const id="printf('00000000-0000-4000-8000-%012d',i)";
let sql=`-- ISOLATED PERFORMANCE DATABASE ONLY. Apply normal migrations first.\nINSERT INTO auth_user(id,name,email,emailVerified,createdAt,updatedAt) VALUES('performance-owner','Synthetic','performance@example.invalid',0,0,0);\nINSERT INTO market_account(id,auth_user_id,display_name,role,disabled) VALUES('performance-owner','performance-owner','Synthetic','creator',0);\n${seq} INSERT INTO market_upload_pack(id,owner) SELECT ${id},'performance-owner' FROM seq;\n${seq} INSERT INTO market_direct_upload(id,owner,operation,request_hash,pack_id,release_id,version,length,sha256,object_key,sealed_key,state,created_at,expires_at,manifest_sha256) SELECT ${id},'performance-owner',${id},'synthetic',${id},${id},1,1,'${'a'.repeat(64)}','staging/'||${id},'sealed/'||${id},'valid',i*86400000,(i+1)*86400000,'${'b'.repeat(64)}' FROM seq;\n${seq} INSERT INTO market_submission(id,owner,upload_id,pack_id,release_id,version,archive_sha256,manifest_sha256,state,created_at,updated_at,last_operation) SELECT ${id},'performance-owner',${id},${id},${id},1,'${'a'.repeat(64)}','${'b'.repeat(64)}','published',i*86400000,i*86400000,${id} FROM seq ORDER BY i;\n${seq} INSERT INTO market_public_release(release_id,pack_id,submission_id,manifest,archive_sha256,manifest_sha256,author,name,search_text,scenarios,locales,styles,has_actions,published_at,state) SELECT ${id},${id},${id},json_set('${literal}','$.pack_id',${id},'$.release_id',${id}),'${'a'.repeat(64)}','${'b'.repeat(64)}','Synthetic','Performance pack','performance synthetic scenario','["explanation"]','["zh-CN"]','[]',1,i*86400000,'published' FROM seq;\n${seq} INSERT INTO market_public_pack(pack_id,release_id,updated_at) SELECT ${id},${id},i*86400000 FROM seq;\n`;
if(metadataOnly){
 const migration=await readFile(new URL('../migrations/0006-review-publish.sql',import.meta.url),'utf8');
 const auth=await readFile(new URL('../migrations/0001-auth.sql',import.meta.url),'utf8');
 const lifecycle=await readFile(new URL('../migrations/0008-moderation-lifecycle.sql',import.meta.url),'utf8');
 // Preserve actual read schema and indexes; foreign keys constrain publication writes only.
 // This does not simulate 10000 publication workflows or authorization data.
 const schema=[...migration.split(';').filter(s=>/^CREATE (?:TABLE market_public_|INDEX market_public_order)/.test(s.trim())),...auth.split(';').filter(s=>/^CREATE (?:TABLE auth_rate_limit|INDEX auth_rate_limit_bucket)/.test(s.trim())),...lifecycle.split(';').filter(s=>s.trim().startsWith('ALTER TABLE market_public_release'))].map(s=>s.trim().replace(/ REFERENCES \w+\(\w+\)/g,'')+';').join('\n');
 const inserts=sql.split(';\n').filter(s=>s.includes(' INSERT INTO market_public_')).join(';\n')+';\n';
 sql='-- ISOLATED READ PERFORMANCE ONLY; NOT PUBLICATION WORKFLOW.\n'+(start===1?schema+'\n':'')+inserts;
}
await writeFile(target,sql,{mode:0o600});console.log(`Generated synthetic ${count}-pack ${metadataOnly?'read-metadata':'full-schema'} fixture; production execution prohibited.`);
