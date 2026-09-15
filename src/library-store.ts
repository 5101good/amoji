import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile, rename, access } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SampleCatalog, type BlobRef, type Expression, type ExpressionRef } from './sample-catalog.js';
import type { Candidate, SampleMessage } from './sample-runtime.js';
import { DATABASE_VERSION, fail, sessionKey, type BindingContext } from './shared-contract.js';
import { buildSearchResult, searchExpressions } from './search.js';
import { prepareUploadedMedia, MEDIA_LIMITS, validateExpressionMedia } from './media.js';

import { draftFields, validateDraftFields, validateExpressionDefinition, type Draft } from './drafts.js';

interface Session { bindingId: string; messages: SampleMessage[]; emittedTurns: string[]; received: Array<[string, string]> }
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
    const catalog = await SampleCatalog.load(seed);
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
      for (const row of legacySessions) {
        if (!row.session_key.startsWith('codex:')) fail('LEGACY_STATE_INVALID', '无法识别旧会话身份');
        const key = sessionKey({ host: 'codex', sessionId: row.session_key.slice(6), turnId: 'migration' });
        this.db.prepare('INSERT OR IGNORE INTO sessions VALUES (?,?)').run(key, row.data);
      }
      this.db.prepare("INSERT OR IGNORE INTO metadata VALUES ('initialized','1')").run();
    });
  }

  private getRevision(ref: ExpressionRef): Expression | undefined {
    const row = this.db.prepare('SELECT data FROM revisions WHERE asset_id=? AND revision_id=?').get(ref.asset_id, ref.revision_id) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : undefined;
  }
  resolve(ref: ExpressionRef): Expression { return this.getRevision(ref) ?? fail('REVISION_NOT_FOUND', '精确版本不存在'); }
  list(): Expression[] { return (this.db.prepare('SELECT r.data FROM library_entries l JOIN revisions r ON r.asset_id=l.asset_id AND r.revision_id=l.revision_id ORDER BY l.rowid').all() as Array<{ data: string }>).map(row => JSON.parse(row.data)); }

  createDraft(): Draft {
    const draft: Draft = { draft_id: `draft_${randomUUID()}`, version: 1, updated_at: new Date().toISOString(), fields: { name: '', semantics: { locale: 'zh-CN', meaning: '', fallback: '' }, rights: { license: '仅供个人使用' } } };
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
    if (draft.version !== version) fail('DRAFT_CONFLICT', '草稿已变化，请重新读取并预览');
    return draft;
  }
  async saveDraft(id: string, version: number, input: unknown, upload?: string): Promise<Draft> {
    const previous = this.currentDraft(id, version);
    if (previous.confirmed) fail('DRAFT_CONFIRMED', '已确认版本不可修改');
    const fields = draftFields(input);
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
      const current = this.currentDraft(id, version);
      if (current.confirmed) fail('DRAFT_CONFIRMED', '已确认版本不可修改');
      const draft: Draft = { ...current, fields, version: version + 1, updated_at: new Date().toISOString(), ...(prepared ? { visual: prepared.visual } : {}) };
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
      const expression: Expression = { ...draft.fields, kind: 'amoji.expression', schema_version: '0.1', asset_id: randomUUID(), revision_id: randomUUID(), created_at: new Date().toISOString(), visual: draft.visual! };
      validateExpressionDefinition(expression);
      this.db.prepare('INSERT INTO revisions VALUES (?,?,?)').run(expression.asset_id, expression.revision_id, JSON.stringify(expression));
      this.db.prepare('INSERT INTO library_entries VALUES (?,?)').run(expression.asset_id, expression.revision_id);
      this.db.prepare("INSERT INTO expression_origins VALUES (?,'local')").run(expression.asset_id);
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
    const matches = searchExpressions(this.list(), query, limit);
    const result = buildSearchResult(matches, () => randomBytes(24).toString('base64url'));
    result.candidates.forEach((candidate, index) => {
      const expression = matches[index]!;
      const selection: Selection = { context, ref: { asset_id: expression.asset_id, revision_id: expression.revision_id }, expires: Date.now() + 300000 };
      this.db.prepare('INSERT INTO selections VALUES (?,?)').run(candidate.selection_token, JSON.stringify(selection));
    });
    return result;
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
      if (session.emittedTurns.includes(turnId)) fail('TURN_LIMIT', '每回合最多发送一个 AI 表情');
      if (!this.list().some(e => e.asset_id === selection.ref.asset_id && e.revision_id === selection.ref.revision_id)) fail('SELECTION_UNAVAILABLE', '已选版本当前不可新发');
      const message = this.message(session, selection.ref, 'ai_to_human');
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
      const message = this.message(session, ref, 'human_to_ai');
      session.received.push([requestId, message.message_id]); this.save(context, session); return message;
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
