import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {verifyBackup} from '../scripts/verify-backup.mjs';
test('restore verifies digest, exact publication/removal state and never opens an existing target',async(t)=>{
 const dir=await mkdtemp(tmpdir()+'/amoji-restore-');t.after(()=>rm(dir,{recursive:true,force:true}));
 const sql=`CREATE TABLE market_public_release(release_id TEXT,pack_id TEXT,state TEXT,archive_sha256 TEXT,manifest_sha256 TEXT,row_version INTEGER); INSERT INTO market_public_release VALUES('release','pack','safety_removed','archive','manifest',2); CREATE TABLE market_public_pack(pack_id TEXT,release_id TEXT); CREATE TABLE market_direct_upload(id TEXT,sealed_key TEXT,sha256 TEXT); CREATE TABLE market_direct_upload_reference(upload_id TEXT);`;
 const status={sha256:createHash('sha256').update(sql).digest('hex'),bytes:Buffer.byteLength(sql),snapshot_at:Date.now()-1000};
 await writeFile(dir+'/backup.sql',sql);await writeFile(dir+'/status.json',JSON.stringify(status));
 const summary=await verifyBackup(dir+'/backup.sql',dir+'/status.json',dir+'/restored');
 assert.equal(summary.releases[0].state,'safety_removed');assert.equal(summary.releases[0].row_version,2);assert.deepEqual(summary.pointers,[]);
 await assert.rejects(()=>verifyBackup(dir+'/backup.sql',dir+'/status.json',dir+'/restored'),{code:'EEXIST'});
 await writeFile(dir+'/backup.sql',sql+'-- altered');await assert.rejects(()=>verifyBackup(dir+'/backup.sql',dir+'/status.json',dir+'/other'),/BACKUP_DIGEST_MISMATCH/);
});
