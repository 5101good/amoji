import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir,writeFile,copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {DatabaseSync} from 'node:sqlite';
import {LibraryStore} from '../src/library-store.js';
const seed=new URL('../assets/samples/',import.meta.url);
async function oldLibrary(t:any){const dir=await mkdtemp(join(tmpdir(),'amoji-db4-'));t.after(()=>rm(dir,{recursive:true,force:true}));const db=new DatabaseSync(join(dir,'library.sqlite'));db.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; PRAGMA user_version=4; CREATE TABLE metadata (key TEXT PRIMARY KEY,value TEXT NOT NULL); INSERT INTO metadata VALUES ('initialized','true'); CREATE TABLE sessions(session_key TEXT PRIMARY KEY,data TEXT NOT NULL); INSERT INTO sessions VALUES ('wal-history','unchanged');");return{dir,db};}
test('DB4→5包含未checkpoint WAL备份，恢复旧库只用真实备份，历史与用户数据不变',async t=>{
 const {dir,db}=await oldLibrary(t);const store=await LibraryStore.open(dir,seed);store.close();db.close();
 const backups=await readdir(join(dir,'backups'));assert.equal(backups.length,1);
 const backup=new DatabaseSync(join(dir,'backups',backups[0]!),{readOnly:true});assert.equal(backup.prepare('PRAGMA user_version').get()?.user_version,4);assert.equal(backup.prepare("SELECT data FROM sessions WHERE session_key='wal-history'").get()?.data,'unchanged');backup.close();
 const upgraded=new DatabaseSync(join(dir,'library.sqlite'),{readOnly:true});assert.equal(upgraded.prepare('PRAGMA user_version').get()?.user_version,5);assert.equal(upgraded.prepare("SELECT data FROM sessions WHERE session_key='wal-history'").get()?.data,'unchanged');upgraded.close();
 // Stop all writers, retain the upgraded file, restore the actual consistent pre-upgrade backup.
 await copyFile(join(dir,'library.sqlite'),join(dir,'db5-retained.sqlite'));await copyFile(join(dir,'backups',backups[0]!),join(dir,'library.sqlite'));
 const restored=new DatabaseSync(join(dir,'library.sqlite'),{readOnly:true});assert.equal(restored.prepare('PRAGMA user_version').get()?.user_version,4);assert.equal(restored.prepare("SELECT data FROM sessions WHERE session_key='wal-history'").get()?.data,'unchanged');restored.close();
});
test('备份磁盘路径故障与迁移校验失败都保留DB4、WAL历史，无半迁移表',async t=>{
 for(const fault of ['disk','validation']){const{dir,db}=await oldLibrary(t);if(fault==='disk')await writeFile(join(dir,'backups'),'not-a-directory');else db.exec('CREATE TABLE action_definitions (wrong TEXT)');
 await assert.rejects(LibraryStore.open(dir,seed));assert.equal(db.prepare('PRAGMA user_version').get()?.user_version,4);assert.equal(db.prepare("SELECT data FROM sessions WHERE session_key='wal-history'").get()?.data,'unchanged');assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='pack_releases'").get(),undefined);db.close();}
});
