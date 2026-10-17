// Offline, isolated verification only. Cloud restoration is a separate explicit operation.
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export async function verifyBackup(sqlPath, statusPath, outputDirectory) {
 const sql=await readFile(sqlPath);const status=JSON.parse(await readFile(statusPath,'utf8'));
 const sha256=createHash('sha256').update(sql).digest('hex');
 if(sha256!==status.sha256||sql.length!==status.bytes)throw Error('BACKUP_DIGEST_MISMATCH');
 const started=Date.now();await mkdir(outputDirectory,{recursive:true,mode:0o700});
 const path=resolve(outputDirectory,'restored.sqlite');
 // Never open an existing target or any production DB.
 const {open}=await import('node:fs/promises');const reservation=await open(path,'wx',0o600);await reservation.close();
 const db=new DatabaseSync(path);
 try {
  db.exec(sql.toString('utf8'));
  if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('BACKUP_INTEGRITY');
  if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('BACKUP_FOREIGN_KEYS');
  const releases=db.prepare('SELECT release_id,pack_id,state,archive_sha256,manifest_sha256,row_version FROM market_public_release ORDER BY release_id').all();
  const pointers=db.prepare('SELECT pack_id,release_id FROM market_public_pack ORDER BY pack_id').all();
  const objects=db.prepare('SELECT DISTINCT u.sealed_key,u.sha256 FROM market_direct_upload u JOIN market_direct_upload_reference r ON r.upload_id=u.id ORDER BY u.sealed_key').all();
  const summary={sha256,bytes:sql.length,snapshot_at:status.snapshot_at,rpo_ms:started-status.snapshot_at,rto_ms:Date.now()-started,releases,pointers,objects};
  await writeFile(resolve(outputDirectory,'restore-summary.json'),JSON.stringify(summary,null,2)+'\n',{mode:0o600});return summary;
 } finally {db.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [sql,status,out]=process.argv.slice(2);if(!sql||!status||!out)throw Error('Usage: node verify-backup.mjs SQL_FILE PRIVATE_STATUS_JSON NEW_PRIVATE_DIRECTORY');
 const s=await verifyBackup(sql,status,out);console.log(JSON.stringify({sha256:s.sha256,bytes:s.bytes,releases:s.releases.length,pointers:s.pointers.length,objects:s.objects.length,rpo_ms:s.rpo_ms,rto_ms:s.rto_ms,cloud_restore:'NOT_RUN',object_digest_verification:'NOT_RUN'}));
}
