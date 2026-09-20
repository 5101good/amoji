import { createReadStream } from 'node:fs';
import { withValidatedPack, exportPack, type PackInput, type ValidatedPack, type ImportResult } from './packs.js';
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
      db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS revisions (asset_id TEXT, revision_id TEXT, data TEXT NOT NULL, PRIMARY KEY(asset_id,revision_id));
        CREATE TABLE IF NOT EXISTS library_entries (asset_id TEXT PRIMARY KEY, revision_id TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions (session_key TEXT PRIMARY KEY, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS selections (token TEXT PRIMARY KEY, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS drafts (draft_id TEXT PRIMARY KEY, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS entry_state (asset_id TEXT PRIMARY KEY, version INTEGER NOT NULL, archived INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS imported_packs (digest TEXT PRIMARY KEY, pack_id TEXT NOT NULL, manifest TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS expression_origins (asset_id TEXT PRIMARY KEY, origin TEXT NOT NULL); PRAGMA user_version=${DATABASE_VERSION};`);
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
        let policy: {pack_id: string; retired: ExpressionRef[]} | undefined;
        try {
          const raw = JSON.parse(await readFile(new URL('builtin-policy.json', seed), 'utf8'));
          if (!raw || raw.pack_id !== pack.manifest.pack_id || !Array.isArray(raw.retired) || raw.retired.length > 200 ||
              !raw.retired.every((ref: ExpressionRef) => ref && typeof ref.asset_id === 'string' && typeof ref.revision_id === 'string')) {
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
          this.db.prepare('INSERT INTO metadata VALUES (?,?)').run(marker, '1');
        });
      });
    }
  }

  async importPack(input: PackInput): Promise<ImportResult> {
    return withValidatedPack(input, pack => this.importValidatedPack(pack, 'imported'));
  }
  private async importValidatedPack(pack: ValidatedPack, origin: 'imported' | 'builtin'): Promise<ImportResult> {
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
    return this.transaction(() => {
      let added = 0;
      for (const e of pack.manifest.expressions) {
        const prior = this.getRevision(e);
        if (prior && !isDeepStrictEqual(prior, e)) fail('REVISION_CONFLICT', '同一版本不能改变已确认定义');
        if (!prior) { this.db.prepare('INSERT INTO revisions VALUES (?,?,?)').run(e.asset_id, e.revision_id, JSON.stringify(e)); added++; }
      }
      for (const ref of pack.manifest.defaults) {
        const present = this.db.prepare('SELECT asset_id FROM library_entries WHERE asset_id=?').get(ref.asset_id);
        if (present) continue; // Import is never an implicit current-version switch.
        this.db.prepare('INSERT INTO library_entries VALUES (?,?)').run(ref.asset_id, ref.revision_id);
        this.db.prepare('INSERT INTO expression_origins VALUES (?,?)').run(ref.asset_id, origin);
        this.db.prepare('INSERT INTO entry_state VALUES (?,1,0)').run(ref.asset_id);
      }
      const manifest = JSON.stringify(pack.manifest);
      this.db.prepare('INSERT OR IGNORE INTO imported_packs VALUES (?,?,?)').run(createHash('sha256').update(manifest).digest('hex'), pack.manifest.pack_id, manifest);
      return { pack_id: pack.manifest.pack_id, added, existing: pack.manifest.expressions.length - added, defaults: pack.manifest.defaults };
    });
  }
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
  list(): Expression[] { return (this.db.prepare('SELECT r.data FROM library_entries l JOIN revisions r ON r.asset_id=l.asset_id AND r.revision_id=l.revision_id LEFT JOIN entry_state s ON s.asset_id=l.asset_id WHERE coalesce(s.archived,0)=0 ORDER BY l.rowid').all() as Array<{ data: string }>).map(row => JSON.parse(row.data)); }

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
    return row ? JSON.parse(row.value) : { ...DEFAULT_SETTINGS };
  }
  updateSettings(version: number, input: unknown): PersonalSettings {
    const fields = preferences(input);
    return this.transaction(() => {
      const current = this.getSettings();
      if (current.version !== version) fail('SETTINGS_CONFLICT', '偏好已变化；请保留输入并读取当前值', current);
      const settings = { ...fields, version: version + 1 };
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
      if (!this.list().some(e => e.asset_id === selection.ref.asset_id && e.revision_id === selection.ref.revision_id)) fail('SELECTION_UNAVAILABLE', '已选版本当前不可新发');
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
  receive(context: BindingContext, ref: ExpressionRef, requestId: string): SampleMessage {
    return this.transaction(() => {
      const session = this.session(context);
      const previous = new Map(session.received).get(requestId);
      if (previous) {
        const message = session.messages.find(m => m.message_id === previous)!;
        if (message.revision.asset_id !== ref.asset_id || message.revision.revision_id !== ref.revision_id) fail('REQUEST_CONFLICT', '该请求已用于其他表情');
        return message;
      }
      this.resolve(ref);
      if (!this.list().some(e => e.asset_id === ref.asset_id && e.revision_id === ref.revision_id)) fail('SELECTION_UNAVAILABLE', '已选版本当前不可新发，请重新选择');
      const message = this.message(session, ref, 'human_to_ai');
      session.received.push([requestId, message.message_id]); this.save(context, session); return message;
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
