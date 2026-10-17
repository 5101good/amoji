import { DatabaseSync, backup } from 'node:sqlite';
import { mkdir, chmod, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DATABASE_VERSION, fail } from './shared-contract.js';
const schema = `
CREATE TABLE IF NOT EXISTS scenario_drafts (draft_id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS action_definitions (action_id TEXT NOT NULL, action_revision_id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(action_id,action_revision_id));
CREATE TABLE IF NOT EXISTS pack_releases (release_id TEXT PRIMARY KEY, pack_id TEXT NOT NULL, version INTEGER NOT NULL, manifest TEXT NOT NULL, UNIQUE(pack_id,version));
CREATE TABLE IF NOT EXISTS local_installs (release_id TEXT PRIMARY KEY, origin TEXT NOT NULL, digest TEXT NOT NULL, state TEXT NOT NULL, refs TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS collection_refs (asset_id TEXT NOT NULL, revision_id TEXT NOT NULL, origin TEXT NOT NULL, PRIMARY KEY(asset_id,revision_id));
CREATE TABLE IF NOT EXISTS action_intents (operation_id TEXT PRIMARY KEY, session_key TEXT NOT NULL, request_id TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(session_key,request_id));
CREATE TABLE IF NOT EXISTS rule_activations (session_key TEXT NOT NULL, conflict_group TEXT NOT NULL, generation INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(session_key,conflict_group));
CREATE TABLE IF NOT EXISTS action_receipts (receipt_id TEXT PRIMARY KEY, session_key TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS revocations (origin TEXT NOT NULL, release_id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(origin,release_id));`;
/** Called only by the service's single writer. A reserved SQLite lock also excludes other writers.
 * Backup reads committed pages through SQLite (including WAL), never copies the main file alone. */
export async function migrateLibrary(db:DatabaseSync,directory:string,version:number,legacySchema:string):Promise<void> {
 db.exec('BEGIN IMMEDIATE');
 try {
  if(version>0 && version<DATABASE_VERSION){
   const folder=join(directory,'backups');await mkdir(folder,{recursive:true,mode:0o700});
   const destination=join(folder,`library-v${version}-${randomUUID()}.sqlite`);
   const reader=new DatabaseSync(join(directory,'library.sqlite'),{readOnly:true});
   try {await backup(reader,destination);await chmod(destination,0o600);
    const check=new DatabaseSync(destination);
    check.exec('PRAGMA journal_mode=DELETE');
    try {if(check.prepare('PRAGMA integrity_check').get()?.integrity_check!=='ok'||check.prepare('PRAGMA user_version').get()?.user_version!==version)fail('MIGRATION_FAILED','升级前备份校验失败');}finally{check.close();}
   } catch(error){await rm(destination,{force:true});throw error;}finally{reader.close();}
  }
  db.exec(legacySchema);db.exec(schema);
  // Preparing required columns detects a pre-existing incompatible object before committing version.
  for(const [table,columns] of Object.entries({scenario_drafts:'draft_id,data',action_definitions:'action_id,action_revision_id,data',pack_releases:'release_id,pack_id,version,manifest',local_installs:'release_id,origin,digest,state,refs',collection_refs:'asset_id,revision_id,origin',action_intents:'operation_id,session_key,request_id,data',rule_activations:'session_key,conflict_group,generation,data',action_receipts:'receipt_id,session_key,data',revocations:'origin,release_id,data'}))db.prepare(`SELECT ${columns} FROM ${table} LIMIT 0`).all();
  if(db.prepare('PRAGMA integrity_check').get()?.integrity_check!=='ok')fail('MIGRATION_FAILED','数据库校验失败');
  db.exec(`PRAGMA user_version=${DATABASE_VERSION}; COMMIT`);
 }catch(error){db.exec('ROLLBACK');throw error;}
}
