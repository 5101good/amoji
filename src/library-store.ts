import { compiledRule, type RuleChoice, type RuleSnapshot, type RuleChange } from './conversation-rules.js';
import { collaborationEnvelope } from './conversation-envelope.js';
import { actionSelection, type ActionSelection, type ActionChoice, type ActionIntent } from './collaboration.js';
import { createReadStream } from 'node:fs';
import { withValidatedPack, exportPack, exportManifest, validatePackManifest, type ScenarioPack, type PackInput, type ValidatedPack, type ImportResult } from './packs.js';
import { migrateLibrary } from './library-migration.js';
import type { ScenarioDraft } from './scenario-drafts.js';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile, rename, access, rm } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SampleCatalog, type BlobRef, type Expression, type ExpressionRef } from './sample-catalog.js';
import type { Candidate, SampleMessage } from './sample-runtime.js';
import { DATABASE_VERSION, fail, sessionKey, type BindingContext } from './shared-contract.js';
import { DEFAULT_SETTINGS, preferences, styleOrder, preferencePolicy, type LibraryEntry, type PersonalSettings } from './library-management.js';
import { expressionAppearance, expressionFamily } from './expression-appearance.js';
import { buildSearchResult, searchExpressions } from './search.js';
import { prepareUploadedMedia, MEDIA_LIMITS, validateExpressionMedia } from './media.js';

import { draftFields, validateDraftFields, validateExpressionDefinition, type Draft } from './drafts.js';

interface Session { bindingId: string; messages: SampleMessage[]; emittedTurns: string[]; received: Array<[string, string]>; observedTurns?: string[]; lastEmission?: { ordinal: number; assetId: string } }
interface Selection { context: BindingContext; ref: ExpressionRef; expires: number; messageId?: string }

/** Only the lock-owning service opens this writer. Adapters use SharedClient. */
export class LibraryStore {
  private constructor(private readonly db: DatabaseSync, readonly directory: string) {}

  static async open(directory: string, seed: URL): Promise<LibraryStore> {
    await mkdir(join(directory, 'blobs'), { recursive: true, mode: 0o700 });
    const database = join(directory, 'library.sqlite');
    const db = new DatabaseSync(database);
    const store = new LibraryStore(db, directory);
    try {
      const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
      if (version > DATABASE_VERSION) fail('DATABASE_INCOMPATIBLE', '数据库版本过新，请升级服务；不会降级');
      await chmod(database, 0o600);
      db.exec('PRAGMA journal_mode=WAL');
      await migrateLibrary(db,directory,version,`CREATE TABLE IF NOT EXISTS revisions (asset_id TEXT, revision_id TEXT, data TEXT NOT NULL, PRIMARY KEY(asset_id,revision_id));
        CREATE TABLE IF NOT EXISTS library_entries (asset_id TEXT PRIMARY KEY, revision_id TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions (session_key TEXT PRIMARY KEY, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS selections (token TEXT PRIMARY KEY, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS drafts (draft_id TEXT PRIMARY KEY, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS entry_state (asset_id TEXT PRIMARY KEY, version INTEGER NOT NULL, archived INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS imported_packs (digest TEXT PRIMARY KEY, pack_id TEXT NOT NULL, manifest TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS expression_origins (asset_id TEXT PRIMARY KEY, origin TEXT NOT NULL);`);
      await store.initialize(seed);
      store.pruneSelections();
      return store;
    } catch (error) { db.close(); throw error; }
  }

  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  private async initialize(seed: URL): Promise<void> {
    const alreadyInitialized = this.db.prepare("SELECT value FROM metadata WHERE key='initialized'").get();
    // Startup seeds are ordinary validated definitions; they never replace current versions.
    const builtinPack = seed.pathname.endsWith('.amoji');
    const catalog = builtinPack ? { all: (): Expression[] => [] } : await SampleCatalog.load(seed);
    const definitions = catalog.all();
    const sources = new Map(definitions.map(e => [`${e.asset_id}:${e.revision_id}`, seed]));
    const legacySessions: Array<{ session_key: string; data: string }> = [];
    let legacyDefaults: Expression[] = [];
    if (!alreadyInitialized) {
      const legacyFile = join(this.directory, 'messages.sqlite');
      if (await exists(legacyFile)) {
        const legacy = new DatabaseSync(legacyFile, { readOnly: true });
        try {
          if ((legacy.prepare('PRAGMA user_version').get() as { user_version: number }).user_version > 1) fail('DATABASE_INCOMPATIBLE', '旧消息数据库版本过新，保留原文件');
          const legacyRoot = pathToFileURL(`${join(this.directory, 'samples')}/`);
          if (await exists(join(this.directory, 'samples/manifest.json'))) legacyDefaults = (await SampleCatalog.load(legacyRoot)).all();
          const hasDefinitions = legacy.prepare("SELECT name FROM sqlite_master WHERE name='revision_definitions'").get();
          const oldDefinitions = hasDefinitions ? (legacy.prepare('SELECT data FROM revision_definitions').all() as Array<{data: string}>).map(row => JSON.parse(row.data) as Expression) : legacyDefaults;
          legacySessions.push(...legacy.prepare('SELECT session_key,data FROM session_snapshots').all() as Array<{ session_key: string; data: string }>);
          for (const row of legacySessions) {
            const state = JSON.parse(row.data) as Session;
            oldDefinitions.push(...state.messages.map(message => message.revision));
          }
          for (const expression of oldDefinitions) {
            definitions.push(expression);
            sources.set(`${expression.asset_id}:${expression.revision_id}`, legacyRoot);
          }
        } finally { legacy.close(); }
      }
    }
    // Detect conflicts before any metadata or default changes. Existing blobs are immutable.
    const checked = new Map<string, Expression>();
    for (const expression of definitions) {
      const key = `${expression.asset_id}:${expression.revision_id}`;
      const prior = checked.get(key) ?? this.getRevision(expression);
      if (prior && !isDeepStrictEqual(prior, expression)) fail('REVISION_CONFLICT', '同一版本不能改变已确认定义');
      checked.set(key, expression);
    }
    const validated = new Map<string, Buffer>();
    for (const expression of checked.values()) {
      const source = sources.get(`${expression.asset_id}:${expression.revision_id}`);
      await validateExpressionMedia(expression, async blob => {
        const destination = join(this.directory, 'blobs', blob.sha256);
        const bytes = await exists(destination)
          ? await readFile(destination)
          : await readFile(new URL(`blobs/${blob.sha256}`, source!));
        validated.set(blob.sha256, bytes);
        return bytes;
      });
    }
    for (const expression of checked.values()) {
      for (const blob of [expression.visual.primary, expression.visual.poster].filter((b): b is BlobRef => !!b)) {
        const destination = join(this.directory, 'blobs', blob.sha256);
        if (await exists(destination)) continue;
        const temporary = `${destination}.${randomUUID()}.tmp`;
        await writeFile(temporary, validated.get(blob.sha256)!, { mode: 0o600 });
        await rename(temporary, destination);
      }
    }
    this.transaction(() => {
      for (const expression of checked.values()) this.db.prepare('INSERT OR IGNORE INTO revisions VALUES (?,?,?)').run(expression.asset_id, expression.revision_id, JSON.stringify(expression));
      for (const expression of [...legacyDefaults, ...catalog.all()]) this.db.prepare('INSERT OR IGNORE INTO library_entries VALUES (?,?)').run(expression.asset_id, expression.revision_id);
      for (const expression of catalog.all()) this.db.prepare("INSERT OR IGNORE INTO expression_origins VALUES (?,'builtin')").run(expression.asset_id);
      this.db.exec("INSERT OR IGNORE INTO expression_origins SELECT asset_id,'imported' FROM library_entries; INSERT OR IGNORE INTO entry_state SELECT asset_id,1,0 FROM library_entries;");
      for (const row of legacySessions) {
        if (!row.session_key.startsWith('codex:')) fail('LEGACY_STATE_INVALID', '无法识别旧会话身份');
        const key = sessionKey({ host: 'codex', sessionId: row.session_key.slice(6), turnId: 'migration' });
        this.db.prepare('INSERT OR IGNORE INTO sessions VALUES (?,?)').run(key, row.data);
      }
      this.db.prepare("INSERT OR IGNORE INTO metadata VALUES ('initialized','1')").run();
    });
    if (builtinPack) {
      await withValidatedPack(createReadStream(seed), async pack => {
        const marker = `builtin-pack:${pack.manifest.pack_id}`;
        if (this.db.prepare('SELECT value FROM metadata WHERE key=?').get(marker)) return;
        let policy: {pack_id: string; retired: ExpressionRef[]; retired_samples?: ExpressionRef[]} | undefined;
        try {
          const raw = JSON.parse(await readFile(new URL('builtin-policy.json', seed), 'utf8'));
          const sampleRefs = new Set([
            '10000000-0000-4000-8000-000000000001:30000000-0000-4000-8000-000000000001',
            '10000000-0000-4000-8000-000000000002:30000000-0000-4000-8000-000000000002',
            '10000000-0000-4000-8000-000000000003:30000000-0000-4000-8000-000000000003',
          ]);
          const validRefs = (refs: unknown): refs is ExpressionRef[] => Array.isArray(refs) && refs.length <= 200 && refs.every((ref: ExpressionRef) => ref && typeof ref.asset_id === 'string' && typeof ref.revision_id === 'string');
          if (!raw || raw.pack_id !== pack.manifest.pack_id || !validRefs(raw.retired) || (raw.retired_samples !== undefined && (!validRefs(raw.retired_samples) || !raw.retired_samples.every((ref: ExpressionRef) => sampleRefs.has(`${ref.asset_id}:${ref.revision_id}`))))) {
            fail('BUILTIN_POLICY_INVALID', '内置表情升级声明与内容包不匹配');
          }
          policy = raw;
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        await this.importValidatedPack(pack, 'builtin');
        this.transaction(() => {
          // Archive only shipped, exact old defaults. Personal copies and imported
          // collections have their own ownership; immutable revisions/blobs stay.
          for (const ref of policy?.retired ?? []) {
            const current = this.db.prepare(`SELECT e.revision_id,o.origin,s.archived FROM library_entries e
              JOIN expression_origins o ON e.asset_id=o.asset_id JOIN entry_state s ON e.asset_id=s.asset_id WHERE e.asset_id=?`).get(ref.asset_id);
            if (current?.origin === 'builtin' && current.revision_id === ref.revision_id && current.archived === 0) {
              this.db.prepare('UPDATE entry_state SET archived=1,version=version+1 WHERE asset_id=?').run(ref.asset_id);
            }
          }
          for (const ref of policy?.retired_samples ?? []) {
            const current = this.db.prepare(`SELECT e.revision_id,s.archived FROM library_entries e
              JOIN entry_state s ON e.asset_id=s.asset_id WHERE e.asset_id=?`).get(ref.asset_id);
            if (current?.revision_id === ref.revision_id && current.archived === 0) this.db.prepare('UPDATE entry_state SET archived=1,version=version+1 WHERE asset_id=?').run(ref.asset_id);
          }
          this.db.prepare('INSERT INTO metadata VALUES (?,?)').run(marker, '1');
        });
      });
    }
  }

  async importPack(input: PackInput): Promise<ImportResult> {
    const hash=createHash('sha256');
    async function* observed(){if(input instanceof Uint8Array){hash.update(input);yield input;}else for await(const chunk of input){hash.update(chunk);yield chunk;}}
    return withValidatedPack(observed(),pack=>{const digest=hash.digest('hex');if(this.unsafePack(pack.manifest,digest))fail('SAFETY_REMOVED','已知安全下架内容不能重导入动作');return this.importValidatedPack(pack,'imported');});
  }
  private async importValidatedPack(pack: ValidatedPack, origin: 'imported' | 'builtin', acquisition?: { defaults?:ExpressionRef[]; beforeCommit():Promise<void>; commit():void }): Promise<ImportResult> {
    // Stage only fully validated content. No metadata becomes visible until every blob is written.
    for (const e of pack.manifest.expressions) {
      const prior = this.getRevision(e);
      if (prior && !isDeepStrictEqual(prior, e)) fail('REVISION_CONFLICT', '同一版本不能改变已确认定义');
    }
    const staged = new Set<string>();
    for (const e of pack.manifest.expressions) for (const blob of [e.visual.primary, e.visual.poster]) {
      if (!blob || staged.has(blob.sha256)) continue;
      staged.add(blob.sha256);
      const destination = join(this.directory, 'blobs', blob.sha256);
      if (await exists(destination)) { await this.verifyBlob(blob); continue; }
      const temporary = `${destination}.${randomUUID()}.tmp`;
      try { await writeFile(temporary, await pack.readBlob(blob), { flag: 'wx', mode: 0o600 }); await rename(temporary, destination); }
      finally { await rm(temporary, { force: true }); }
    }
    await acquisition?.beforeCommit();
    return this.transaction(() => {
      if(this.unsafePack(pack.manifest))fail('SAFETY_REMOVED','已知安全下架动作不可安装');
      if(pack.manifest.schema_version==='0.2')this.persistScenarioPack(pack.manifest);
      let added = 0;
      for (const e of pack.manifest.expressions) {
        const prior = this.getRevision(e);
        if (prior && !isDeepStrictEqual(prior, e)) fail('REVISION_CONFLICT', '同一版本不能改变已确认定义');
        if (!prior) { this.db.prepare('INSERT INTO revisions VALUES (?,?,?)').run(e.asset_id, e.revision_id, JSON.stringify(e)); added++; }
      }
      for (const ref of acquisition?.defaults ?? pack.manifest.defaults) {
        if(!acquisition)this.marketWrite(`owned:${ref.asset_id}`,false);
        const present = this.db.prepare('SELECT asset_id FROM library_entries WHERE asset_id=?').get(ref.asset_id);
        if (present) continue; // Import is never an implicit current-version switch.
        if(acquisition)this.marketWrite(`owned:${ref.asset_id}`,true);
        this.db.prepare('INSERT INTO library_entries VALUES (?,?)').run(ref.asset_id, ref.revision_id);
        this.db.prepare('INSERT INTO expression_origins VALUES (?,?)').run(ref.asset_id, origin);
        this.db.prepare('INSERT INTO entry_state VALUES (?,1,0)').run(ref.asset_id);
      }
      const manifest = JSON.stringify(pack.manifest);
      if (!acquisition) this.db.prepare('INSERT OR IGNORE INTO imported_packs VALUES (?,?,?)').run(createHash('sha256').update(manifest).digest('hex'), pack.manifest.pack_id, manifest);
      acquisition?.commit();
      return { pack_id: pack.manifest.pack_id, added, existing: pack.manifest.expressions.length - added, defaults: pack.manifest.defaults, ...(pack.manifest.schema_version==='0.2'?{actions:pack.manifest.actions.map(a=>({ref:{action_id:a.action_id,action_revision_id:a.action_revision_id},enabled:false as const,reason:'当前宿主尚未提供已验证的动作运行能力 / Action runtime is not yet supported by this host'}))}:{}) };
    });
  }
  private unsafePack(pack:import('./packs.js').Pack,digest?:string):boolean {
    const rows=this.db.prepare('SELECT release_id,data FROM revocations').all() as {release_id:string;data:string}[];
    return rows.some(row=>{const r=JSON.parse(row.data);return r.state==='safety_removed'&&((digest&&r.archive_sha256===digest)||(pack.schema_version==='0.2'&&(row.release_id===pack.release_id||pack.actions.some(a=>(r.actions??[]).some((b:any)=>a.action_id===b.action_id&&a.action_revision_id===b.action_revision_id)))));});
  }
  applyRevocations(origin:string,entries:Array<{pack_id:string;release_id:string;archive_sha256:string;state:string;reason_code:string}>,cursor:string,checked:string):void {
    this.transaction(()=>{
      for(const entry of entries){
        if(entry.state!=='safety_removed')continue;
        const pack=this.listScenarioPacks().find(p=>p.release_id===entry.release_id);
        const old=this.db.prepare('SELECT data FROM revocations WHERE origin=? AND release_id=?').get(origin,entry.release_id) as {data:string}|undefined;
        const data={...entry,actions:pack?.actions.map(a=>({action_id:a.action_id,action_revision_id:a.action_revision_id}))??(old?JSON.parse(old.data).actions:[])};
        this.db.prepare('INSERT INTO revocations VALUES(?,?,?) ON CONFLICT(origin,release_id) DO UPDATE SET data=excluded.data').run(origin,entry.release_id,JSON.stringify(data));
      }
      const unsafe=new Set(this.listScenarioPacks().filter(p=>this.unsafePack(p)).map(p=>p.release_id));
      for(const row of this.db.prepare("SELECT session_key,data FROM rule_activations WHERE conflict_group='@session'").all() as {session_key:string;data:string}[]){
        const state:RuleSnapshot=JSON.parse(row.data);let changed=false;
        for(const rule of state.rules)if(rule.enabled&&unsafe.has(rule.source.release_id)){rule.enabled=false;rule.status='disabled';rule.reason='safety_removed';changed=true;}
        if(changed){state.generation++;for(const rule of state.rules)rule.generation=state.generation;this.db.prepare("UPDATE rule_activations SET generation=?,data=? WHERE session_key=? AND conflict_group='@session'").run(state.generation,JSON.stringify(state),row.session_key);}
      }
      for(const row of this.db.prepare('SELECT session_key,data FROM sessions').all() as {session_key:string;data:string}[]){
        const session:Session=JSON.parse(row.data);let changed=false;
        for(const message of session.messages){const intent=message.action_intent;if(intent&&unsafe.has(intent.source.release_id)){intent.status='failed';intent.receipt={status:'failed',reason:'safety_removed'};this.db.prepare('UPDATE action_intents SET data=? WHERE operation_id=?').run(JSON.stringify(intent),intent.operation_id);changed=true;}}
        if(changed)this.db.prepare('UPDATE sessions SET data=? WHERE session_key=?').run(JSON.stringify(session),row.session_key);
      }
      this.marketWrite('revocation:'+origin,{cursor,last_checked_at:checked,stale:false});
    });
  }
  marketRead<T>(key:string):T|undefined { const row=this.db.prepare('SELECT value FROM metadata WHERE key=?').get(`market:${key}`) as {value:string}|undefined; return row?JSON.parse(row.value):undefined; }
  marketWrite(key:string,value:unknown):void { this.db.prepare('INSERT INTO metadata VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(`market:${key}`,JSON.stringify(value)); }
  marketInstalls():Array<{release_id:string;origin:string;digest:string;state:string;refs:ExpressionRef[]}> {return (this.db.prepare('SELECT * FROM local_installs').all() as Array<any>).map(r=>({...r,refs:JSON.parse(r.refs)}));}
  marketCollections():Array<{ref:ExpressionRef;source:unknown}> {return (this.db.prepare('SELECT * FROM collection_refs').all() as Array<{asset_id:string;revision_id:string;origin:string}>).map(r=>({ref:{asset_id:r.asset_id,revision_id:r.revision_id},source:JSON.parse(r.origin)}));}
  async marketCommit(pack:ValidatedPack,source:{origin:string;digest:string;operation_id:string;ref?:ExpressionRef},beforeCommit:()=>Promise<void>):Promise<void> {
    if(pack.manifest.schema_version!=='0.2')fail('INVALID_SCHEMA','市场需要场景包');
    const manifest=pack.manifest;
    if(source.ref&&!manifest.expressions.some(e=>e.asset_id===source.ref!.asset_id&&e.revision_id===source.ref!.revision_id))fail('REVISION_NOT_FOUND','收藏版本不在包内');
    const selected=source.ref?[source.ref]:manifest.defaults;
    const previouslyLocal=!!this.db.prepare('SELECT 1 FROM pack_releases WHERE release_id=?').get(manifest.release_id)&&!this.marketRead(`release-source:${manifest.release_id}`);
    await this.importValidatedPack(pack,'imported',{defaults:selected,
      beforeCommit,
      commit:()=>{
        if(!previouslyLocal)this.marketWrite(`release-source:${manifest.release_id}`,source.origin);
        if(source.ref)this.db.prepare("UPDATE local_installs SET state='collected',origin=? WHERE release_id=? AND state='removed'").run(source.origin,manifest.release_id);
        // Only acquisition-owned entries can disappear with their last reference.
        if(source.ref)this.db.prepare('INSERT INTO collection_refs VALUES (?,?,?) ON CONFLICT(asset_id,revision_id) DO UPDATE SET origin=excluded.origin').run(source.ref.asset_id,source.ref.revision_id,JSON.stringify({origin:source.origin,release_id:manifest.release_id,pack_id:manifest.pack_id,rights:manifest.rights}));
        else {
          for(const old of this.marketInstalls())if(old.state==='installed'&&this.getScenarioPack(old.release_id).pack_id===manifest.pack_id&&old.release_id!==manifest.release_id)this.removeScenarioPackRecords(old.release_id);
          this.db.prepare('INSERT INTO local_installs VALUES (?,?,?,?,?) ON CONFLICT(release_id) DO UPDATE SET state=excluded.state,refs=excluded.refs').run(manifest.release_id,source.origin,source.digest,'installed',JSON.stringify(selected));
          for(const ref of selected)if(this.marketRead(`owned:${ref.asset_id}`)){this.db.prepare('UPDATE library_entries SET revision_id=? WHERE asset_id=?').run(ref.revision_id,ref.asset_id);this.db.prepare('UPDATE entry_state SET version=version+1 WHERE asset_id=?').run(ref.asset_id);}
        }
        this.marketPrune();
        const op=this.marketRead<Record<string,unknown>>(`operation:${source.operation_id}`)!;
        this.marketWrite(`operation:${source.operation_id}`,{...op,status:'committed',last_checked_at:new Date().toISOString()});
      }
    });
  }
  marketRemove(packId:string):void {this.transaction(()=>{for(const i of this.marketInstalls())if(this.getScenarioPack(i.release_id).pack_id===packId)this.removeScenarioPackRecords(i.release_id);this.marketPrune();});}
  marketUncollect(ref:ExpressionRef):void {this.transaction(()=>{this.db.prepare('DELETE FROM collection_refs WHERE asset_id=? AND revision_id=?').run(ref.asset_id,ref.revision_id);this.marketPrune();});}
  private marketPrune():void {
    // Replacing a collection's source can orphan its previous release too.
    const activeReleases=new Set([...this.marketInstalls().filter(i=>i.state==='installed').map(i=>i.release_id),...this.marketCollections().map(c=>(c.source as {release_id:string}).release_id)]);
    for(const pack of this.listScenarioPacks())if(this.marketRead(`release-source:${pack.release_id}`)&&!activeReleases.has(pack.release_id)&&!this.db.prepare("SELECT 1 FROM imported_packs WHERE json_extract(manifest,'$.release_id')=?").get(pack.release_id))this.removeScenarioPackRecords(pack.release_id);
    const retained=[...this.marketInstalls().filter(i=>i.state==='installed').flatMap(i=>i.refs),...this.marketCollections().map(c=>c.ref)];
    for(const entry of this.listEntries()){
      const id=entry.expression.asset_id;
      if(entry.origin==='local'||!this.marketRead(`owned:${id}`))continue;
      const ref=retained.find(r=>r.asset_id===id&&r.revision_id===entry.expression.revision_id)??retained.find(r=>r.asset_id===id);
      if(ref){this.db.prepare('UPDATE library_entries SET revision_id=? WHERE asset_id=?').run(ref.revision_id,id);continue;}
      this.db.prepare('DELETE FROM library_entries WHERE asset_id=?').run(id);this.db.prepare('DELETE FROM entry_state WHERE asset_id=?').run(id);this.db.prepare('DELETE FROM expression_origins WHERE asset_id=?').run(id);
    }
  }
  private persistScenarioPack(pack:ScenarioPack):void {
    const previous=this.db.prepare('SELECT manifest FROM pack_releases WHERE release_id=? OR (pack_id=? AND version=?)').all(pack.release_id,pack.pack_id,pack.version) as Array<{manifest:string}>;
    if(previous.some(p=>!isDeepStrictEqual(JSON.parse(p.manifest),pack)))fail('RELEASE_CONFLICT','发布身份或版本已绑定其他内容');
    if(!previous.length){const latest=this.db.prepare('SELECT max(version) AS version FROM pack_releases WHERE pack_id=?').get(pack.pack_id) as {version:number|null};if(latest.version!==null&&pack.version<=latest.version)fail('RELEASE_CONFLICT','新发布版本必须递增');}
    for(const a of pack.actions){const prior=this.db.prepare('SELECT data FROM action_definitions WHERE action_id=? AND action_revision_id=?').get(a.action_id,a.action_revision_id) as {data:string}|undefined;if(prior&&!isDeepStrictEqual(JSON.parse(prior.data),a))fail('ACTION_REVISION_CONFLICT','动作版本不可变');}
    for(const a of pack.actions)this.db.prepare('INSERT OR IGNORE INTO action_definitions VALUES (?,?,?)').run(a.action_id,a.action_revision_id,JSON.stringify(a));
    this.db.prepare('INSERT OR IGNORE INTO pack_releases VALUES (?,?,?,?)').run(pack.release_id,pack.pack_id,pack.version,JSON.stringify(pack));
  }
  listScenarioPacks():ScenarioPack[]{return (this.db.prepare('SELECT manifest FROM pack_releases ORDER BY rowid DESC').all() as Array<{manifest:string}>).map(r=>JSON.parse(r.manifest));}
  getScenarioPack(releaseId:string):ScenarioPack {const row=this.db.prepare('SELECT manifest FROM pack_releases WHERE release_id=?').get(releaseId) as {manifest:string}|undefined;return row?JSON.parse(row.manifest):fail('PACK_NOT_FOUND','没有此精确发布版本');}
  createScenarioDraft(refs:ExpressionRef[]):ScenarioDraft {
    if(!Array.isArray(refs)||!refs.length||refs.length>200)fail('INVALID_ARGUMENT','请选择 1–200 个已确认版本');
    const expressions=refs.map(ref=>this.resolve(ref));const defaults=new Map<string,ExpressionRef>();for(const e of expressions)if(!defaults.has(e.asset_id))defaults.set(e.asset_id,{asset_id:e.asset_id,revision_id:e.revision_id});
    const manifest=validatePackManifest({kind:'amoji.pack',schema_version:'0.2',pack_id:randomUUID(),release_id:randomUUID(),version:1,name:'我的场景包',created_at:new Date().toISOString(),scenario:['协作'],expressions,defaults:[...defaults.values()],actions:[],bindings:[],rights:{license:'仅供个人使用'}}) as ScenarioPack;
    const draft:ScenarioDraft={draft_id:randomUUID(),version:1,manifest};this.db.prepare('INSERT INTO scenario_drafts VALUES (?,?)').run(draft.draft_id,JSON.stringify(draft));return draft;
  }
  listScenarioDrafts():ScenarioDraft[]{return (this.db.prepare('SELECT data FROM scenario_drafts ORDER BY rowid DESC').all() as Array<{data:string}>).map(r=>JSON.parse(r.data));}
  getScenarioDraft(id:string):ScenarioDraft {const row=this.db.prepare('SELECT data FROM scenario_drafts WHERE draft_id=?').get(id) as {data:string}|undefined;return row?JSON.parse(row.data):fail('DRAFT_NOT_FOUND','场景包草稿不存在');}
  private scenarioDraft(id:string,version:number):ScenarioDraft {const d=this.getScenarioDraft(id);if(d.version!==version)fail('DRAFT_CONFLICT','草稿已变更，请保留输入并重新读取',d);return d;}
  saveScenarioDraft(id:string,version:number,value:unknown):ScenarioDraft {
    return this.transaction(()=>{const current=this.scenarioDraft(id,version);if(current.saved)fail('DRAFT_FINALIZED','已保存发布不可改写，请新建草稿');const manifest=validatePackManifest(value);if(manifest.schema_version!=='0.2')fail('INVALID_SCHEMA','场景包需要 0.2');
      for(const field of ['pack_id','release_id','created_at','version'] as const)if(manifest[field]!==current.manifest[field])fail('INVALID_ARGUMENT','草稿身份不可更改');
      for(const e of manifest.expressions)if(!isDeepStrictEqual(this.resolve(e),e))fail('REVISION_CONFLICT','只能使用本地已确认的精确版本');
      const draft:ScenarioDraft={...current,version:version+1,manifest};this.db.prepare('UPDATE scenario_drafts SET data=? WHERE draft_id=?').run(JSON.stringify(draft),id);return draft;});
  }
  async previewScenarioDraft(id:string,version:number):Promise<ScenarioPack>{const d=this.scenarioDraft(id,version);validatePackManifest(d.manifest);for(const e of d.manifest.expressions)await validateExpressionMedia(e,async blob=>{await this.verifyBlob(blob);return readFile(join(this.directory,'blobs',blob.sha256));});this.scenarioDraft(id,version);return d.manifest;}
  async confirmScenarioDraft(id:string,version:number):Promise<ScenarioPack>{await this.previewScenarioDraft(id,version);return this.transaction(()=>{const d=this.scenarioDraft(id,version);this.persistScenarioPack(d.manifest);this.db.prepare('UPDATE scenario_drafts SET data=? WHERE draft_id=?').run(JSON.stringify({...d,saved:true}),id);return d.manifest;});}
  async exportScenarioPack(releaseId:string,expressionsOnly=false):Promise<Buffer>{const pack=this.getScenarioPack(releaseId);return expressionsOnly?this.exportPack(pack.expressions.map(e=>({asset_id:e.asset_id,revision_id:e.revision_id})),pack.name):exportManifest(pack,async blob=>{await this.verifyBlob(blob);return readFile(join(this.directory,'blobs',blob.sha256));});}
  selectRevision(ref: ExpressionRef, version: number): LibraryEntry {
    return this.transaction(() => {
      const current = this.currentEntry(ref.asset_id, version);
      if (current.origin === 'local') fail('LOCAL_REVISION_PROTECTED', '个人条目通过确认编辑草稿更新');
      this.resolve(ref);
      if (current.expression.revision_id !== ref.revision_id) {
        this.db.prepare('UPDATE library_entries SET revision_id=? WHERE asset_id=?').run(ref.revision_id, ref.asset_id);
        this.db.prepare('UPDATE entry_state SET version=version+1 WHERE asset_id=?').run(ref.asset_id);
      }
      return this.getEntry(ref.asset_id);
    });
  }
  async exportPack(refs: ExpressionRef[], name: string): Promise<Buffer> {
    if (!Array.isArray(refs) || refs.length < 1 || refs.length > 200) fail('INVALID_ARGUMENT', '导出需要 1–200 个确定版本');
    const expressions = refs.map(ref => this.resolve(ref));
    const defaults = new Map<string, ExpressionRef>();
    for (const ref of refs) {
      if (!defaults.has(ref.asset_id) || this.getEntry(ref.asset_id).expression.revision_id === ref.revision_id) defaults.set(ref.asset_id, ref);
    }
    return exportPack(expressions, [...defaults.values()], name, async blob => { await this.verifyBlob(blob); return readFile(join(this.directory, 'blobs', blob.sha256)); });
  }

  private getRevision(ref: ExpressionRef): Expression | undefined {
    const row = this.db.prepare('SELECT data FROM revisions WHERE asset_id=? AND revision_id=?').get(ref.asset_id, ref.revision_id) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : undefined;
  }
  resolve(ref: ExpressionRef): Expression { return this.getRevision(ref) ?? fail('REVISION_NOT_FOUND', '精确版本不存在'); }
  private availableEntries(): LibraryEntry[] { return this.listEntries().filter(entry => !entry.archived); }
  // Appearance only filters discovery. A token or an explicit selection keeps
  // its exact available revision when the person switches visual style.
  private canSend(ref: ExpressionRef): boolean {
    return this.availableEntries().some(({expression}) => expression.asset_id === ref.asset_id &&
      (expression.revision_id === ref.revision_id || this.marketCollections().some(c => c.ref.asset_id === ref.asset_id && c.ref.revision_id === ref.revision_id)));
  }
  list(): Expression[] {
    const appearance = this.getSettings().appearance;
    const seen = new Set<string>();
    const selected=this.availableEntries().filter(entry => {
      if (entry.origin !== 'builtin') return true;
      const tagged = expressionAppearance(entry.expression);
      if (tagged && tagged !== appearance) return false;
      const family = expressionFamily(entry.expression);
      if (!family) return true;
      if (seen.has(family)) return false;
      seen.add(family); return true;
    }).map(entry => entry.expression);
    for(const {ref} of this.marketCollections())if(this.availableEntries().some(e=>e.expression.asset_id===ref.asset_id)&&!selected.some(e=>e.asset_id===ref.asset_id&&e.revision_id===ref.revision_id))selected.push(this.resolve(ref));
    return selected;
  }

  getEntry(assetId: string): LibraryEntry {
    const row = this.db.prepare('SELECT l.revision_id, o.origin, s.version, s.archived FROM library_entries l JOIN expression_origins o USING(asset_id) JOIN entry_state s USING(asset_id) WHERE l.asset_id=?').get(assetId) as { revision_id: string; origin: LibraryEntry['origin']; version: number; archived: number } | undefined;
    if (!row) fail('ENTRY_NOT_FOUND', '库条目不存在');
    return { expression: this.resolve({ asset_id: assetId, revision_id: row.revision_id }), origin: row.origin, version: row.version, archived: !!row.archived };
  }
  listRevisions(assetId: string): Expression[] { this.getEntry(assetId); return (this.db.prepare('SELECT data FROM revisions WHERE asset_id=? ORDER BY rowid DESC').all(assetId) as Array<{data: string}>).map(row => JSON.parse(row.data)); }
  listEntries(): LibraryEntry[] { return (this.db.prepare('SELECT asset_id FROM library_entries ORDER BY rowid').all() as Array<{asset_id: string}>).map(row => this.getEntry(row.asset_id)); }
  private currentEntry(assetId: string, version: number): LibraryEntry {
    const current = this.getEntry(assetId);
    if (current.version !== version) fail('ENTRY_CONFLICT', '条目已变化；请保留草稿并读取当前版本', current);
    return current;
  }
  startRevisionDraft(ref: ExpressionRef, version: number): Draft {
    return this.transaction(() => {
      const entry = this.currentEntry(ref.asset_id, version);
      if (entry.expression.revision_id !== ref.revision_id) fail('ENTRY_CONFLICT', '选中版本已经变化', entry);
      if (entry.archived) fail('SELECTION_UNAVAILABLE', '请先恢复归档条目');
      const e = entry.expression;
      const draft: Draft = { draft_id: `draft_${randomUUID()}`, version: 1, updated_at: new Date().toISOString(), mode: entry.origin === 'local' ? 'edit' : 'copy', source: ref, entry_version: version, fields: { name: e.name, semantics: e.semantics, rights: e.rights, ...(e.tags ? { tags: e.tags } : {}) }, visual: e.visual };
      this.db.prepare('INSERT INTO drafts VALUES (?,?)').run(draft.draft_id, JSON.stringify(draft)); return draft;
    });
  }
  setArchived(assetId: string, version: number, archived: boolean): LibraryEntry {
    if (typeof archived !== 'boolean') fail('INVALID_ARGUMENT', '归档状态必须是布尔值');
    return this.transaction(() => {
      const entry = this.currentEntry(assetId, version);
      if (entry.archived !== archived) this.db.prepare('UPDATE entry_state SET archived=?, version=version+1 WHERE asset_id=?').run(Number(archived), assetId);
      return this.getEntry(assetId);
    });
  }
  getSettings(): PersonalSettings {
    const row = this.db.prepare("SELECT value FROM metadata WHERE key='personal_settings'").get() as {value: string} | undefined;
    return row ? { ...DEFAULT_SETTINGS, ...JSON.parse(row.value) } : { ...DEFAULT_SETTINGS };
  }
  updateSettings(version: number, input: unknown): PersonalSettings {
    const fields = preferences(input);
    return this.transaction(() => {
      const current = this.getSettings();
      if (current.version !== version) fail('SETTINGS_CONFLICT', '偏好已变化；请保留输入并读取当前值', current);
      const settings = { ...current, ...fields, version: version + 1 };
      this.db.prepare("INSERT INTO metadata VALUES ('personal_settings',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(settings)); return settings;
    });
  }
  createDraft(): Draft {
    const draft: Draft = { draft_id: `draft_${randomUUID()}`, mode: 'create', version: 1, updated_at: new Date().toISOString(), fields: { name: '', semantics: { locale: 'zh-CN', meaning: '', fallback: '' }, rights: { license: '仅供个人使用' } } };
    this.db.prepare('INSERT INTO drafts VALUES (?,?)').run(draft.draft_id, JSON.stringify(draft)); return draft;
  }
  getDraft(id: string): Draft {
    const row = this.db.prepare('SELECT data FROM drafts WHERE draft_id=?').get(id) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : fail('DRAFT_NOT_FOUND', '草稿不存在');
  }
  listDrafts(): Draft[] {
    return (this.db.prepare("SELECT data FROM drafts WHERE json_extract(data,'$.confirmed') IS NULL ORDER BY rowid DESC").all() as Array<{ data: string }>).map(row => JSON.parse(row.data));
  }
  private currentDraft(id: string, version: number): Draft {
    const draft = this.getDraft(id);
    if (draft.version !== version) fail('DRAFT_CONFLICT', '草稿已变化，请保留输入并重新读取', draft);
    return draft;
  }
  async saveDraft(id: string, version: number, input: unknown, upload?: string): Promise<Draft> {
    const fields = draftFields(input);
    const requestHash = createHash('sha256').update(canonical({ version, fields, upload: upload ?? null })).digest('hex');
    const retry = (draft: Draft) => draft.last_save?.base_version === version && draft.last_save.request_hash === requestHash;
    const previous = this.getDraft(id);
    if (retry(previous)) return previous;
    this.currentDraft(id, version);
    if (previous.confirmed) fail('DRAFT_CONFIRMED', '已确认版本不可修改');
    let prepared: Awaited<ReturnType<typeof prepareUploadedMedia>> | undefined;
    if (upload !== undefined) {
      if (typeof upload !== 'string' || upload.length > Math.ceil(MEDIA_LIMITS.bytes / 3) * 4) fail('MEDIA_LIMIT_EXCEEDED', '单个素材大小超限（最大 10 MiB）');
      if (!upload || upload.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(upload)) fail('INVALID_ARGUMENT', '素材需要有效 base64 编码');
      const bytes = Buffer.from(upload, 'base64');
      if (bytes.toString('base64') !== upload) fail('INVALID_ARGUMENT', '素材编码不规范');
      prepared = await prepareUploadedMedia(bytes);
      for (const [digest, bytes] of prepared.blobs) {
        const destination = join(this.directory, 'blobs', digest);
        if (await exists(destination)) {
          if (!(await readFile(destination)).equals(bytes)) fail('BLOB_INTEGRITY_FAILED', '已有素材损坏，不覆盖不可变素材');
        } else {
          const temporary = `${destination}.${randomUUID()}.tmp`;
          await writeFile(temporary, bytes, { mode: 0o600 }); await rename(temporary, destination);
        }
      }
    }
    return this.transaction(() => {
      const current = this.getDraft(id);
      if (retry(current)) return current;
      this.currentDraft(id, version);
      if (current.confirmed) fail('DRAFT_CONFIRMED', '已确认版本不可修改');
      const draft: Draft = { ...current, fields, last_save: { base_version: version, request_hash: requestHash }, version: version + 1, updated_at: new Date().toISOString(), ...(prepared ? { visual: prepared.visual } : {}) };
      this.db.prepare('UPDATE drafts SET data=? WHERE draft_id=?').run(JSON.stringify(draft), id); return draft;
    });
  }
  async previewDraft(id: string, version: number): Promise<Draft> {
    const draft = this.currentDraft(id, version);
    validateDraftFields(draft.fields);
    if (!draft.visual) fail('MEDIA_REQUIRED', '请先上传视觉素材');
    await validateExpressionMedia({ visual: draft.visual } as Expression, async blob => {
      await this.verifyBlob(blob); return readFile(join(this.directory, 'blobs', blob.sha256));
    });
    this.currentDraft(id, version); return draft;
  }
  async confirmDraft(id: string, version: number): Promise<Expression> {
    const current = this.currentDraft(id, version);
    if (current.confirmed) return this.resolve(current.confirmed);
    const draft = await this.previewDraft(id, version);
    return this.transaction(() => {
      const latest = this.currentDraft(id, version);
      if (latest.confirmed) return this.resolve(latest.confirmed);
      const editing = draft.mode === 'edit';
      if (editing) {
        const entry = this.currentEntry(draft.source!.asset_id, draft.entry_version!);
        if (entry.origin !== 'local' || entry.archived || entry.expression.revision_id !== draft.source!.revision_id) fail('ENTRY_CONFLICT', '原条目已变化', entry);
      }
      const expression: Expression = { ...draft.fields, ...(draft.source ? { derived_from: draft.source } : {}), kind: 'amoji.expression', schema_version: '0.1', asset_id: editing ? draft.source!.asset_id : randomUUID(), revision_id: randomUUID(), created_at: new Date().toISOString(), visual: draft.visual! };
      validateExpressionDefinition(expression);
      this.db.prepare('INSERT INTO revisions VALUES (?,?,?)').run(expression.asset_id, expression.revision_id, JSON.stringify(expression));
      if (editing) {
        this.db.prepare('UPDATE library_entries SET revision_id=? WHERE asset_id=?').run(expression.revision_id, expression.asset_id);
        this.db.prepare('UPDATE entry_state SET version=version+1 WHERE asset_id=?').run(expression.asset_id);
      } else {
        this.db.prepare('INSERT INTO library_entries VALUES (?,?)').run(expression.asset_id, expression.revision_id);
        this.db.prepare("INSERT INTO expression_origins VALUES (?,'local')").run(expression.asset_id);
        this.db.prepare('INSERT INTO entry_state VALUES (?,1,0)').run(expression.asset_id);
      }
      draft.confirmed = { asset_id: expression.asset_id, revision_id: expression.revision_id };
      this.db.prepare('UPDATE drafts SET data=? WHERE draft_id=?').run(JSON.stringify(draft), id);
      return expression;
    });
  }

  /** Consumed tokens are message deduplication records and share their messages' retention. */
  pruneSelections(): void {
    this.db.prepare("DELETE FROM selections WHERE json_extract(data,'$.messageId') IS NULL AND json_extract(data,'$.expires')<=?").run(Date.now());
  }

  search(context: BindingContext, query: string, limit = 3): { candidates: Candidate[]; policy: string } {
    if (!context.turnId?.trim()) fail('TURN_REQUIRED', 'AI 检索必须绑定真实回合');
    this.pruneSelections();
    const settings = this.getSettings();
    const session = this.session(context); this.observeTurn(context, session); this.save(context, session);
    const matching = searchExpressions(this.list(), query, limit, candidates => styleOrder(candidates, settings.style));
    const matches = settings.paused ? [] : matching;
    const result = buildSearchResult(matches, () => randomBytes(24).toString('base64url'), preferencePolicy(settings));
    result.candidates.forEach((candidate, index) => {
      const expression = matches[index]!;
      const selection: Selection = { context, ref: { asset_id: expression.asset_id, revision_id: expression.revision_id }, expires: Date.now() + 300000 };
      this.db.prepare('INSERT INTO selections VALUES (?,?)').run(candidate.selection_token, JSON.stringify(selection));
    });
    return result;
  }
  private observeTurn(context: BindingContext, session: Session): number {
    session.observedTurns ??= [...session.emittedTurns];
    if (!session.observedTurns.includes(context.turnId!)) session.observedTurns.push(context.turnId!);
    return context.turnOrdinal ?? session.observedTurns.indexOf(context.turnId!) + 1;
  }
  private session(context: BindingContext): Session {
    const row = this.db.prepare('SELECT data FROM sessions WHERE session_key=?').get(sessionKey(context)) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : { bindingId: randomUUID(), messages: [], emittedTurns: [], received: [] };
  }
  private save(context: BindingContext, session: Session): void { this.db.prepare('INSERT INTO sessions VALUES (?,?) ON CONFLICT(session_key) DO UPDATE SET data=excluded.data').run(sessionKey(context), JSON.stringify(session)); }
  history(context: BindingContext): SampleMessage[] { return this.session(context).messages; }
  private message(session: Session, ref: ExpressionRef, direction: SampleMessage['direction']): SampleMessage {
    const message: SampleMessage = { message_id: randomUUID(), binding_id: session.bindingId, direction, created_at: new Date().toISOString(), revision: this.resolve(ref), delivery: 'pending', presentation: 'pending' };
    session.messages.push(message); return message;
  }
  emit(context: BindingContext, token: string): SampleMessage {
    const turnId = context.turnId;
    if (!turnId?.trim()) fail('TURN_REQUIRED', 'AI 发送必须绑定真实回合');
    return this.transaction(() => {
      const row = this.db.prepare('SELECT data FROM selections WHERE token=?').get(token) as { data: string } | undefined;
      if (!row) fail('SELECTION_UNAVAILABLE', '选择凭据不存在，请重新检索');
      const selection: Selection = JSON.parse(row.data);
      if (sessionKey(selection.context) !== sessionKey(context)) fail('BINDING_MISMATCH', '不能使用其他会话的选择凭据');
      if (selection.context.turnId !== context.turnId) fail('TURN_MISMATCH', '不能使用其他回合的选择凭据');
      const session = this.session(context);
      if (selection.messageId) return session.messages.find(m => m.message_id === selection.messageId) ?? fail('MESSAGE_NOT_FOUND', '去重记录对应的消息不存在');
      if (selection.expires <= Date.now()) fail('SELECTION_EXPIRED', '选择凭据已过期，请重新检索');
      const settings = this.getSettings();
      if (settings.paused) fail('AI_PAUSED', 'AI 主动表情已暂停，仍可手动发送');
      const ordinal = this.observeTurn(context, session);
      if (session.emittedTurns.includes(turnId)) fail('TURN_LIMIT', '每回合最多发送一个 AI 表情');
      if (!this.canSend(selection.ref)) fail('SELECTION_UNAVAILABLE', '已选版本当前不可新发');
      if (session.lastEmission?.assetId === selection.ref.asset_id) fail('REPEAT_LIMIT', '不能连续重复同一表情');
      if (settings.frequency === 'restrained' && session.lastEmission && ordinal - session.lastEmission.ordinal < 2) fail('FREQUENCY_LIMIT', '克制模式需冷却一个完整回合');
      const message = this.message(session, selection.ref, 'ai_to_human');
      session.lastEmission = { ordinal, assetId: selection.ref.asset_id };
      session.emittedTurns.push(turnId);
      this.save(context, session);
      selection.messageId = message.message_id;
      this.db.prepare('UPDATE selections SET data=? WHERE token=?').run(JSON.stringify(selection), token);
      return message;
    });
  }
  receive(context: BindingContext, ref: ExpressionRef, requestId: string, selected?: ActionSelection): SampleMessage {
    const selection = selected === undefined ? undefined : actionSelection(selected);
    return this.transaction(() => {
      const session = this.session(context);
      const previous = new Map(session.received).get(requestId);
      if (previous) {
        const message = session.messages.find(m => m.message_id === previous)!;
        if (!isDeepStrictEqual(message.action_intent?.selection, selection) || message.revision.asset_id !== ref.asset_id || message.revision.revision_id !== ref.revision_id) fail('REQUEST_CONFLICT', '该请求已用于其他表情');
        return message;
      }
      this.resolve(ref);
      if (!this.canSend(ref)) fail('SELECTION_UNAVAILABLE', '已选版本当前不可新发，请重新选择');
      const choice = selection ? this.collaborationChoices(context, ref).find(c => isDeepStrictEqual(c.selection,selection)) ?? fail('ACTION_UNAVAILABLE','此精确动作不可用于所选表情') : undefined;
      const message = this.message(session, ref, 'human_to_ai');
      if(choice){message.action_intent={...choice,operation_id:randomUUID(),requestId,status:'prepared'};this.db.prepare('INSERT INTO action_intents VALUES (?,?,?,?)').run(message.action_intent.operation_id,sessionKey(context),requestId,JSON.stringify(message.action_intent));}
      session.received.push([requestId, message.message_id]); this.save(context, session); return message;
    });
  }
  collaborationChoices(context: BindingContext, ref: ExpressionRef): ActionChoice[] {
    if(context.host !== 'dsh') fail('CAPABILITY_UNAVAILABLE','动作仅支持 dsh');
    return this.listScenarioPacks().flatMap(pack => {
      const binding=pack.bindings.find(b=>b.expression.asset_id===ref.asset_id && b.expression.revision_id===ref.revision_id);
      if(!binding)return [];
      const installed=this.db.prepare('SELECT origin,state FROM local_installs WHERE release_id=?').get(pack.release_id) as {origin:string;state:string}|undefined;
      if(installed && !['installed','collected'].includes(installed.state))return [];
      if(this.unsafePack(pack))return [];
      return pack.actions.flatMap(action=>action.kind==='instruction' && binding.actions.some(a=>a.action_id===action.action_id&&a.action_revision_id===action.action_revision_id)?[{selection:{release_id:pack.release_id,action_id:action.action_id,action_revision_id:action.action_revision_id},action,source:{pack_id:pack.pack_id,release_id:pack.release_id,version:pack.version,origin:installed?.origin??this.marketRead<string>(`release-source:${pack.release_id}`)??(this.db.prepare("SELECT 1 FROM imported_packs WHERE json_extract(manifest,'$.release_id')=?").get(pack.release_id)?'imported-file':'local')}}]:[]);
    });
  }
  ruleChoices(context: BindingContext): RuleChoice[] {
    if(context.host!=='dsh')fail('CAPABILITY_UNAVAILABLE','规则仅支持 dsh');
    const packs=this.listScenarioPacks();
    return packs.flatMap(pack=>{
      const install=this.db.prepare('SELECT origin,state FROM local_installs WHERE release_id=?').get(pack.release_id) as {origin:string;state:string}|undefined;
      if((install && !['installed','collected'].includes(install.state)) || this.unsafePack(pack))return [];
      // A new release never carries forward consent to a changed action revision.
      if(packs.some(p=>p.pack_id===pack.pack_id && p.version>pack.version))return [];
      return pack.actions.flatMap(action=>action.kind==='hook'?[{selection:{release_id:pack.release_id,action_id:action.action_id,action_revision_id:action.action_revision_id},action,source:{pack_id:pack.pack_id,release_id:pack.release_id,version:pack.version,origin:install?.origin??this.marketRead<string>(`release-source:${pack.release_id}`)??(this.db.prepare("SELECT 1 FROM imported_packs WHERE json_extract(manifest,'$.release_id')=?").get(pack.release_id)?'imported-file':'local')}}]:[]);
    });
  }
  rules(context:BindingContext):RuleSnapshot {
    const row=this.db.prepare("SELECT data FROM rule_activations WHERE session_key=? AND conflict_group='@session'").get(sessionKey(context)) as {data:string}|undefined;
    const state:RuleSnapshot=row?JSON.parse(row.data):{generation:0,rules:[]};
    const choices=this.ruleChoices(context);
    let changed=false;
    for(const rule of state.rules)if(rule.enabled && !choices.some(c=>isDeepStrictEqual(c.selection,rule.selection))){rule.enabled=false;rule.status='disabled';rule.reason='source-unavailable';changed=true;}
    if(changed){state.generation++;for(const rule of state.rules)rule.generation=state.generation;this.writeRules(context,state);}
    return state;
  }
  private writeRules(context:BindingContext,state:RuleSnapshot):void {
    this.db.prepare("INSERT INTO rule_activations VALUES (?,'@session',?,?) ON CONFLICT(session_key,conflict_group) DO UPDATE SET generation=excluded.generation,data=excluded.data").run(sessionKey(context),state.generation,JSON.stringify(state));
  }
  changeRules(context:BindingContext,change:RuleChange):RuleSnapshot {
    return this.transaction(()=>{
      const state=this.rules(context);
      if(!Number.isSafeInteger(change.generation)||state.generation!==change.generation)fail('RULE_STALE','规则已变更，请刷新后重试');
      if(change.kind==='enable'){
        const choice=this.ruleChoices(context).find(c=>isDeepStrictEqual(c.selection,change.selection))??fail('ACTION_UNAVAILABLE','此精确规则版本当前不可启用');
        const active=state.rules.find(r=>r.enabled&&r.action.conflict_group===choice.action.conflict_group);
        if(active&&!isDeepStrictEqual(active.selection,change.replace))fail('RULE_CONFLICT','同组规则已启用，请明确选择替换');
        if(!active&&change.replace)fail('RULE_STALE','待替换规则已变化');
        state.rules=state.rules.filter(r=>r.action.conflict_group!==choice.action.conflict_group);
        state.rules.push({...choice,actor:'user',enabled:true,generation:state.generation+1,status:'configured'});
      }else for(const rule of state.rules)if(change.kind==='disableAll'||isDeepStrictEqual(rule.selection,change.selection)){rule.enabled=false;rule.status='disabled';}
      const active=state.rules.filter(r=>r.enabled);
      if(active.length>2)fail('ACTION_LIMIT','最多两条持续规则');
      try{collaborationEnvelope(context.hostInstanceId!,context.sessionId,Number.MAX_SAFE_INTEGER,active.map(compiledRule));}catch{fail('ACTION_LIMIT','完整动作上下文超过 8 KiB，不截断');}
      state.generation++;state.checkpoint=change.checkpoint;
      for(const rule of state.rules)rule.generation=state.generation;
      this.writeRules(context,state);return state;
    });
  }
  removeScenarioPack(releaseId:string):void {
    this.transaction(()=>this.removeScenarioPackRecords(releaseId));
  }
  private removeScenarioPackRecords(releaseId:string):void {
      this.getScenarioPack(releaseId);
      this.db.prepare("INSERT INTO local_installs VALUES (?,'local','','removed','[]') ON CONFLICT(release_id) DO UPDATE SET state='removed'").run(releaseId);
      const rows=this.db.prepare("SELECT session_key,data FROM rule_activations WHERE conflict_group='@session'").all() as {session_key:string;data:string}[];
      for(const row of rows){const state:RuleSnapshot=JSON.parse(row.data);let changed=false;for(const rule of state.rules)if(rule.enabled&&rule.source.release_id===releaseId){rule.enabled=false;rule.status='disabled';rule.reason='source-unavailable';changed=true;}if(changed){state.generation++;this.db.prepare("UPDATE rule_activations SET generation=?,data=? WHERE session_key=? AND conflict_group='@session'").run(state.generation,JSON.stringify(state),row.session_key);}}
  }
  saveActionIntent(context: BindingContext, messageId: string, update: Pick<ActionIntent,'status'|'checkpoint'|'receipt'>): void {
    if(context.host!=='dsh')fail('BINDING_MISMATCH','动作仅支持 dsh');
    this.transaction(()=>{
      const session=this.session(context); const message=session.messages.find(m=>m.message_id===messageId);
      if(!message?.action_intent)fail('BINDING_MISMATCH','动作不属于此会话消息');
      if(message.action_intent.receipt?.reason==='safety_removed')return;
      message.action_intent={...message.action_intent,...update};
      this.db.prepare('UPDATE action_intents SET data=? WHERE operation_id=? AND session_key=?').run(JSON.stringify(message.action_intent),message.action_intent.operation_id,sessionKey(context));
      if(update.receipt)this.db.prepare('INSERT INTO action_receipts VALUES (?,?,?) ON CONFLICT(receipt_id) DO UPDATE SET data=excluded.data').run(message.action_intent.operation_id,sessionKey(context),JSON.stringify(update.receipt));
      this.save(context,session);
    });
  }
  dshAttempted(context: BindingContext, messageId: string): boolean {
    if (context.host !== 'dsh') fail('BINDING_MISMATCH', '只有 dsh 可以保存原生投递记录');
    return this.transaction(() => {
      const session = this.session(context);
      const message = session.messages.find(m => m.message_id === messageId && m.direction === 'human_to_ai');
      if (!message) fail('BINDING_MISMATCH', '投递消息不属于当前会话');
      if (message.dsh_submission) return false;
      message.dsh_submission = 'attempted'; this.save(context, session); return true;
    });
  }
  dshAccepted(context: BindingContext, messageId: string): void {
    if (context.host !== 'dsh') fail('BINDING_MISMATCH', '只有 dsh 可以保存原生投递回执');
    this.transaction(() => {
      const session = this.session(context);
      const message = session.messages.find(m => m.message_id === messageId && m.direction === 'human_to_ai');
      if (!message) fail('BINDING_MISMATCH', '投递消息不属于当前会话');
      message.dsh_submission = 'accepted'; this.save(context, session);
    });
  }
  presentation(context: BindingContext, messageId: string, state: 'rendered' | 'fallback'): void {
    this.transaction(() => {
      const session = this.session(context);
      const message = session.messages.find(m => m.message_id === messageId);
      if (!message) fail('MESSAGE_NOT_FOUND', '当前会话不存在此消息');
      message.presentation = state; this.save(context, session);
    });
  }
  async blobPath(digest: string): Promise<string> {
    if (!/^[a-f0-9]{64}$/.test(digest)) fail('INVALID_ARGUMENT', '无效素材摘要');
    const rows = this.db.prepare('SELECT data FROM revisions').all() as Array<{ data: string }>;
    const drafts = this.db.prepare('SELECT data FROM drafts').all() as Array<{ data: string }>;
    const draftBlobs = drafts.flatMap(row => { const draft: Draft = JSON.parse(row.data); return [draft.visual?.primary, draft.visual?.poster]; });
    const blob = [...draftBlobs, ...rows.flatMap(row => { const expression: Expression = JSON.parse(row.data); return [expression.visual.primary, expression.visual.poster]; })].find(b => b?.sha256 === digest);
    if (!blob) fail('BLOB_MISSING', '素材未被任何版本引用');
    await this.verifyBlob(blob); return join(this.directory, 'blobs', digest);
  }
  private async verifyBlob(blob: BlobRef): Promise<void> {
    let bytes: Buffer;
    try { bytes = await readFile(join(this.directory, 'blobs', blob.sha256)); } catch { fail('BLOB_MISSING', '保留素材缺失'); }
    verify(bytes, blob);
  }
  close(): void { this.db.close(); }
}
async function exists(path: string): Promise<boolean> { try { await access(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; } }
function verify(bytes: Buffer, blob: BlobRef): void { if (bytes.length !== blob.bytes || createHash('sha256').update(bytes).digest('hex') !== blob.sha256) fail('BLOB_INTEGRITY_FAILED', '素材摘要不匹配'); }

/** Stable identity for one save intent, independent of JSON object key order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
