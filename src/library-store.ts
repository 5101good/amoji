import { createReadStream } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile, rename, access, rm } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { join } from 'node:path';
import {
  actAllows, actEntry, backchannelEligible, findAct, interruptEligible, lookupLocale, PROTOCOL, REGISTRY_REVISION,
  type Anchor, type BlobRef, type DecisionOption, type Direction, type Expression, type ExpressionRef, type Intensity, type Mode, type Pack,
} from './protocol/index.js';
import { withValidatedPack, exportManifest, composePack, validatePackManifest, type PackInput, type ValidatedPack, type ImportResult } from './packs.js';
import { prepareUploadedMedia, MEDIA_LIMITS, validateExpressionMedia } from './media.js';
import { DATABASE_VERSION, fail, sessionKey, type BindingContext } from './shared-contract.js';
import { DEFAULT_PREFERENCES, preferences, preferencePolicy, type LibraryEntry, type ExpressionOrigin, type PersonalSettings } from './library-management.js';
import { buildSearchResult, searchExpressions, type SearchResult } from './search.js';
import { draftFields, emptyFields, validateDraftFields, type Draft } from './drafts.js';
import { effectConflictGroup, effectKey, type EffectChoice, type EffectIntent, type EffectSelection } from './effects.js';
import { compiledRule, ruleConflictGroup, type RuleChoice, type RuleSnapshot, type RuleChange } from './conversation-rules.js';
import { collaborationEnvelope } from './conversation-envelope.js';
import type { StoredMessage } from './messages.js';

export interface PackDraft { draft_id: string; version: number; manifest: Pack; saved?: true }
export type PackSource = 'builtin' | 'imported' | 'local' | `market:${string}`;
interface Session { bindingId: string; messages: StoredMessage[]; received: Array<[string, string]>; windows: Record<string, number> }
interface Selection { context: BindingContext; ref: ExpressionRef; expires: number; messageId?: string }

export const REJECT_REASONS = ['ai_expressions_paused', 'unknown_act', 'direction_not_allowed', 'family_disabled', 'rate_limited', 'pending_confirmation', 'invalid_options', 'invalid_replies', 'invalid_anchor', 'invalid_selection_token', 'budget_exceeded'] as const;
export type RejectReason = typeof REJECT_REASONS[number];
export interface ExpressInput { act?: string; selection_token?: string; intensity?: Intensity; anchor?: Anchor; replies?: string[]; options?: DecisionOption[]; responds_to?: string; rationale?: string; pending_confirmation?: boolean; locale?: string; agent_id?: string }
export type ExpressResult = { status: 'sent'; message: StoredMessage } | { status: 'rejected'; reason: RejectReason; message: string };
export interface ReceiveInput { ref?: ExpressionRef; act?: string; intensity?: Intensity; note?: string; anchor?: Anchor; anchor_degraded?: boolean; mode?: Mode; sent_during?: string; responds_to?: string; effect?: EffectSelection; participant_id?: string; locale?: string }

const SCHEMA = `
CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS revisions (asset_id TEXT NOT NULL, revision_id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(asset_id, revision_id));
CREATE TABLE IF NOT EXISTS entries (asset_id TEXT PRIMARY KEY, revision_id TEXT NOT NULL, origin TEXT NOT NULL, pack_id TEXT, version INTEGER NOT NULL, archived INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS packs (release_id TEXT PRIMARY KEY, pack_id TEXT NOT NULL, version INTEGER NOT NULL, source TEXT NOT NULL, digest TEXT, manifest TEXT NOT NULL, UNIQUE(pack_id, version));
CREATE TABLE IF NOT EXISTS pack_drafts (draft_id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS drafts (draft_id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (session_key TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS selections (token TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS effect_intents (operation_id TEXT PRIMARY KEY, session_key TEXT NOT NULL, request_id TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(session_key, request_id));
CREATE TABLE IF NOT EXISTS effect_receipts (receipt_id TEXT PRIMARY KEY, session_key TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS session_rules (session_key TEXT PRIMARY KEY, generation INTEGER NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS local_installs (release_id TEXT PRIMARY KEY, origin TEXT NOT NULL, digest TEXT NOT NULL, state TEXT NOT NULL, refs TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS collection_refs (asset_id TEXT NOT NULL, revision_id TEXT NOT NULL, origin TEXT NOT NULL, PRIMARY KEY(asset_id, revision_id));
CREATE TABLE IF NOT EXISTS revocations (origin TEXT NOT NULL, release_id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(origin, release_id));`;
export const DATABASE_FILE = 'library-0.1.sqlite';
const codePoints = (text: string) => [...text].length;

/** Only the lock-owning service opens this writer. Adapters use SharedClient. */
export class LibraryStore {
  private constructor(private readonly db: DatabaseSync, readonly directory: string) {}

  /** `seeds` are built-in .amoji packs, in the order they become the default preferred packs. */
  static async open(directory: string, seeds: readonly URL[] = []): Promise<LibraryStore> {
    await mkdir(join(directory, 'blobs'), { recursive: true, mode: 0o700 });
    const database = join(directory, DATABASE_FILE);
    const db = new DatabaseSync(database);
    const store = new LibraryStore(db, directory);
    try {
      const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
      if (version > DATABASE_VERSION) fail('DATABASE_INCOMPATIBLE', '数据库版本过新，请升级服务；不会降级');
      await chmod(database, 0o600);
      db.exec('PRAGMA journal_mode=WAL');
      db.exec(`BEGIN IMMEDIATE; ${SCHEMA} PRAGMA user_version=${DATABASE_VERSION}; COMMIT;`);
      await store.seed(seeds);
      store.pruneSelections();
      return store;
    } catch (error) { db.close(); throw error; }
  }

  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private meta<T>(key: string): T | undefined { const row = this.db.prepare('SELECT value FROM metadata WHERE key=?').get(key) as { value: string } | undefined; return row ? JSON.parse(row.value) : undefined; }
  private setMeta(key: string, value: unknown): void { this.db.prepare('INSERT INTO metadata VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value)); }

  private async seed(seeds: readonly URL[]): Promise<void> {
    const order: string[] = [];
    for (const seed of seeds) {
      await withValidatedPack(createReadStream(seed), async pack => {
        order.push(pack.manifest.pack_id);
        if (this.meta(`builtin:${pack.manifest.release_id}`)) return;
        await this.importValidatedPack(pack, 'builtin');
        this.transaction(() => this.setMeta(`builtin:${pack.manifest.release_id}`, true));
      });
    }
    this.transaction(() => this.setMeta('builtin_packs', order));
  }

  // ---------------------------------------------------------------- packs

  async importPack(input: PackInput): Promise<ImportResult> {
    const hash = createHash('sha256');
    async function* observed() { if (input instanceof Uint8Array) { hash.update(input); yield input; } else for await (const chunk of input) { hash.update(chunk); yield chunk; } }
    return withValidatedPack(observed(), pack => {
      const digest = hash.digest('hex');
      if (this.unsafePack(pack.manifest, digest)) fail('SAFETY_REMOVED', '已知安全下架内容不能重新导入');
      return this.importValidatedPack(pack, 'imported', undefined, digest);
    });
  }

  /** Stage blobs, then commit revisions, the release and library entries in one transaction. */
  private async importValidatedPack(pack: ValidatedPack, source: PackSource, acquisition?: { refs: ExpressionRef[]; beforeCommit(): Promise<void>; commit(): void }, digest?: string): Promise<ImportResult> {
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
      if (this.unsafePack(pack.manifest)) fail('SAFETY_REMOVED', '已知安全下架内容不可安装');
      const manifest = pack.manifest;
      this.persistRelease(manifest, source, digest);
      let added = 0;
      for (const e of manifest.expressions) {
        const prior = this.getRevision(e);
        if (prior && !isDeepStrictEqual(prior, e)) fail('REVISION_CONFLICT', '同一版本不能改变已确认定义');
        if (!prior) { this.db.prepare('INSERT INTO revisions VALUES (?,?,?)').run(e.asset_id, e.revision_id, JSON.stringify(e)); added++; }
      }
      const origin: ExpressionOrigin = source === 'builtin' ? 'builtin' : source.startsWith('market:') ? 'market' : source === 'local' ? 'local' : 'imported';
      for (const ref of acquisition?.refs ?? manifest.expressions) {
        if (!acquisition) this.marketWrite(`owned:${ref.asset_id}`, false);
        const present = this.db.prepare('SELECT origin FROM entries WHERE asset_id=?').get(ref.asset_id) as { origin: string } | undefined;
        if (present) {
          // Built-in updates follow the product; anything else never switches versions implicitly.
          if (source === 'builtin' && present.origin === 'builtin') this.db.prepare('UPDATE entries SET revision_id=?, version=version+1 WHERE asset_id=? AND revision_id<>?').run(ref.revision_id, ref.asset_id, ref.revision_id);
          continue;
        }
        if (acquisition) this.marketWrite(`owned:${ref.asset_id}`, true);
        this.db.prepare('INSERT INTO entries VALUES (?,?,?,?,1,0)').run(ref.asset_id, ref.revision_id, origin, manifest.pack_id);
      }
      acquisition?.commit();
      return { pack_id: manifest.pack_id, release_id: manifest.release_id, added, existing: manifest.expressions.length - added, effects: manifest.effects?.length ?? 0 };
    });
  }

  private persistRelease(pack: Pack, source: PackSource, digest?: string): void {
    const previous = this.db.prepare('SELECT manifest FROM packs WHERE release_id=? OR (pack_id=? AND version=?)').all(pack.release_id, pack.pack_id, pack.version) as Array<{ manifest: string }>;
    if (previous.some(p => !isDeepStrictEqual(JSON.parse(p.manifest), pack))) fail('RELEASE_CONFLICT', '发布身份或版本已绑定其他内容');
    if (previous.length) return;
    const latest = this.db.prepare('SELECT max(version) AS version FROM packs WHERE pack_id=?').get(pack.pack_id) as { version: number | null };
    if (latest.version !== null && pack.version <= latest.version) fail('RELEASE_CONFLICT', '新发布版本必须递增');
    for (const effect of pack.effects ?? []) {
      for (const row of this.db.prepare('SELECT manifest FROM packs').all() as Array<{ manifest: string }>) {
        const other = (JSON.parse(row.manifest) as Pack).effects?.find(e => effectKey(e) === effectKey(effect));
        if (other && !isDeepStrictEqual(other, effect)) fail('EFFECT_REVISION_CONFLICT', '效果版本不可变');
      }
    }
    this.db.prepare('INSERT INTO packs VALUES (?,?,?,?,?,?)').run(pack.release_id, pack.pack_id, pack.version, source, digest ?? null, JSON.stringify(pack));
  }
  private releaseSource(releaseId: string): PackSource | undefined { return (this.db.prepare('SELECT source FROM packs WHERE release_id=?').get(releaseId) as { source: PackSource } | undefined)?.source; }
  listPacks(): Pack[] { return (this.db.prepare('SELECT manifest FROM packs ORDER BY rowid DESC').all() as Array<{ manifest: string }>).map(r => JSON.parse(r.manifest)); }
  getPack(releaseId: string): Pack {
    const row = this.db.prepare('SELECT manifest FROM packs WHERE release_id=?').get(releaseId) as { manifest: string } | undefined;
    return row ? JSON.parse(row.manifest) : fail('PACK_NOT_FOUND', '没有此精确发布版本');
  }
  async exportRelease(releaseId: string, withoutEffects = false): Promise<Buffer> {
    const pack = this.getPack(releaseId);
    if (withoutEffects && (pack.effects?.length || pack.bindings?.length)) {
      const { effects: _, bindings: __, ...rest } = pack;
      return exportManifest({ ...rest, release_id: randomUUID(), pack_id: randomUUID(), version: 1 }, blob => this.readBlob(blob));
    }
    return exportManifest(pack, blob => this.readBlob(blob));
  }
  async exportPack(refs: ExpressionRef[], name: string, locale?: string): Promise<Buffer> {
    if (!Array.isArray(refs) || refs.length < 1 || refs.length > 200) fail('INVALID_ARGUMENT', '导出需要 1–200 个确定版本');
    return exportManifest(composePack(refs.map(ref => this.resolve(ref)), { name, locale }), blob => this.readBlob(blob));
  }
  removePack(releaseId: string): void { this.transaction(() => this.removePackRecords(releaseId)); }
  private removePackRecords(releaseId: string): void {
    this.getPack(releaseId);
    this.db.prepare("INSERT INTO local_installs VALUES (?,'local','','removed','[]') ON CONFLICT(release_id) DO UPDATE SET state='removed'").run(releaseId);
    for (const row of this.db.prepare('SELECT session_key,data FROM session_rules').all() as Array<{ session_key: string; data: string }>) {
      const state: RuleSnapshot = JSON.parse(row.data); let changed = false;
      for (const rule of state.rules) if (rule.enabled && rule.source.release_id === releaseId) { rule.enabled = false; rule.status = 'disabled'; rule.reason = 'source-unavailable'; changed = true; }
      if (changed) { state.generation++; this.db.prepare('UPDATE session_rules SET generation=?, data=? WHERE session_key=?').run(state.generation, JSON.stringify(state), row.session_key); }
    }
  }
  /**
   * A release offers effects while the user holds it: built-in, file imports and local packs until removed;
   * market releases only while installed or while one of their expressions is collected from them.
   */
  private releaseActive(releaseId: string): boolean {
    if (this.unsafePack(this.getPack(releaseId))) return false;
    const install = this.db.prepare('SELECT state FROM local_installs WHERE release_id=?').get(releaseId) as { state: string } | undefined;
    if (install?.state === 'installed') return true;
    if (this.releaseSource(releaseId)?.startsWith('market:')) return this.marketCollections().some(c => c.source.release_id === releaseId);
    return !install || install.state !== 'removed';
  }

  // ---------------------------------------------------------------- pack drafts

  createPackDraft(refs: ExpressionRef[], name = '我的表情包'): PackDraft {
    if (!Array.isArray(refs) || !refs.length || refs.length > 200) fail('INVALID_ARGUMENT', '请选择 1–200 个已确认版本');
    const manifest = composePack(refs.map(ref => this.resolve(ref)), { name });
    const draft: PackDraft = { draft_id: randomUUID(), version: 1, manifest };
    this.db.prepare('INSERT INTO pack_drafts VALUES (?,?)').run(draft.draft_id, JSON.stringify(draft)); return draft;
  }
  listPackDrafts(): PackDraft[] { return (this.db.prepare('SELECT data FROM pack_drafts ORDER BY rowid DESC').all() as Array<{ data: string }>).map(r => JSON.parse(r.data)); }
  getPackDraft(id: string): PackDraft { const row = this.db.prepare('SELECT data FROM pack_drafts WHERE draft_id=?').get(id) as { data: string } | undefined; return row ? JSON.parse(row.data) : fail('DRAFT_NOT_FOUND', '表情包草稿不存在'); }
  private packDraft(id: string, version: number): PackDraft { const d = this.getPackDraft(id); if (d.version !== version) fail('DRAFT_CONFLICT', '草稿已变更，请保留输入并重新读取', d); return d; }
  savePackDraft(id: string, version: number, value: unknown): PackDraft {
    return this.transaction(() => {
      const current = this.packDraft(id, version);
      if (current.saved) fail('DRAFT_FINALIZED', '已保存发布不可改写，请新建草稿');
      const manifest = validatePackManifest(value);
      for (const field of ['pack_id', 'release_id', 'version'] as const) if (manifest[field] !== current.manifest[field]) fail('INVALID_ARGUMENT', '草稿身份不可更改');
      for (const e of manifest.expressions) if (!isDeepStrictEqual(this.getRevision(e), e)) fail('REVISION_CONFLICT', '只能使用本地已确认的精确版本');
      const draft: PackDraft = { ...current, version: version + 1, manifest };
      this.db.prepare('UPDATE pack_drafts SET data=? WHERE draft_id=?').run(JSON.stringify(draft), id); return draft;
    });
  }
  async previewPackDraft(id: string, version: number): Promise<Pack> {
    const d = this.packDraft(id, version); validatePackManifest(d.manifest);
    for (const e of d.manifest.expressions) await validateExpressionMedia(e, blob => this.readBlob(blob));
    this.packDraft(id, version); return d.manifest;
  }
  async confirmPackDraft(id: string, version: number): Promise<Pack> {
    await this.previewPackDraft(id, version);
    return this.transaction(() => {
      const d = this.packDraft(id, version);
      this.persistRelease(d.manifest, 'local');
      this.db.prepare('UPDATE pack_drafts SET data=? WHERE draft_id=?').run(JSON.stringify({ ...d, saved: true }), id);
      return d.manifest;
    });
  }

  // ---------------------------------------------------------------- library entries

  private getRevision(ref: ExpressionRef): Expression | undefined {
    const row = this.db.prepare('SELECT data FROM revisions WHERE asset_id=? AND revision_id=?').get(ref.asset_id, ref.revision_id) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : undefined;
  }
  resolve(ref: ExpressionRef): Expression { return this.getRevision(ref) ?? fail('REVISION_NOT_FOUND', '精确版本不存在'); }
  getEntry(assetId: string): LibraryEntry {
    const row = this.db.prepare('SELECT revision_id, origin, pack_id, version, archived FROM entries WHERE asset_id=?').get(assetId) as { revision_id: string; origin: ExpressionOrigin; pack_id: string | null; version: number; archived: number } | undefined;
    if (!row) fail('ENTRY_NOT_FOUND', '库条目不存在');
    return { expression: this.resolve({ asset_id: assetId, revision_id: row.revision_id }), origin: row.origin, pack_id: row.pack_id, version: row.version, archived: !!row.archived };
  }
  listEntries(): LibraryEntry[] { return (this.db.prepare('SELECT asset_id FROM entries ORDER BY rowid').all() as Array<{ asset_id: string }>).map(row => this.getEntry(row.asset_id)); }
  listRevisions(assetId: string): Expression[] { this.getEntry(assetId); return (this.db.prepare('SELECT data FROM revisions WHERE asset_id=? ORDER BY rowid DESC').all(assetId) as Array<{ data: string }>).map(row => JSON.parse(row.data)); }
  private currentEntry(assetId: string, version: number): LibraryEntry {
    const current = this.getEntry(assetId);
    if (current.version !== version) fail('ENTRY_CONFLICT', '条目已变化；请保留草稿并读取当前版本', current);
    return current;
  }
  private packRank(): (packId: string | null) => number {
    const preferred = this.getSettings().preferred_packs;
    return packId => { const index = packId ? preferred.indexOf(packId) : -1; return index < 0 ? preferred.length : index; };
  }
  private availableEntries(): LibraryEntry[] {
    const rank = this.packRank();
    return this.listEntries().filter(entry => !entry.archived).map((entry, index) => ({ entry, index }))
      .sort((a, b) => rank(a.entry.pack_id) - rank(b.entry.pack_id) || a.index - b.index).map(item => item.entry);
  }
  private canSend(ref: ExpressionRef): boolean {
    return this.availableEntries().some(({ expression }) => expression.asset_id === ref.asset_id &&
      (expression.revision_id === ref.revision_id || this.marketCollections().some(c => c.ref.asset_id === ref.asset_id && c.ref.revision_id === ref.revision_id)));
  }
  /** Sendable expressions, preferred packs first (RFC §11.6). */
  list(): Expression[] {
    const selected = this.availableEntries().map(entry => entry.expression);
    for (const { ref } of this.marketCollections()) if (this.availableEntries().some(e => e.expression.asset_id === ref.asset_id) && !selected.some(e => e.asset_id === ref.asset_id && e.revision_id === ref.revision_id)) selected.push(this.resolve(ref));
    return selected;
  }
  /** The preferred glyph for an act and direction: preferred pack, readable lettering, closest intensity. */
  private glyphFor(act: string, direction: Direction, locale?: string, intensity?: Intensity): Expression | undefined {
    const candidates = this.list().filter(e => e.realizes === act && (e.directions ?? [direction]).includes(direction));
    const readable = (e: Expression) => e.visual.text_locale === null ? 1 : locale && lookupLocale([e.visual.text_locale], locale) ? 0 : 2;
    return candidates.map((e, index) => ({ e, index })).sort((a, b) => readable(a.e) - readable(b.e) || Math.abs(a.e.intensity - (intensity ?? 2)) - Math.abs(b.e.intensity - (intensity ?? 2)) || a.index - b.index)[0]?.e;
  }
  selectRevision(ref: ExpressionRef, version: number): LibraryEntry {
    return this.transaction(() => {
      const current = this.currentEntry(ref.asset_id, version);
      if (current.origin === 'local') fail('LOCAL_REVISION_PROTECTED', '个人条目通过确认编辑草稿更新');
      this.resolve(ref);
      if (current.expression.revision_id !== ref.revision_id) this.db.prepare('UPDATE entries SET revision_id=?, version=version+1 WHERE asset_id=?').run(ref.revision_id, ref.asset_id);
      return this.getEntry(ref.asset_id);
    });
  }
  setArchived(assetId: string, version: number, archived: boolean): LibraryEntry {
    if (typeof archived !== 'boolean') fail('INVALID_ARGUMENT', '归档状态必须是布尔值');
    return this.transaction(() => {
      const entry = this.currentEntry(assetId, version);
      if (entry.archived !== archived) this.db.prepare('UPDATE entries SET archived=?, version=version+1 WHERE asset_id=?').run(Number(archived), assetId);
      return this.getEntry(assetId);
    });
  }

  // ---------------------------------------------------------------- preferences

  getSettings(): PersonalSettings {
    const stored = this.meta<PersonalSettings>('preferences');
    return stored ?? { ...structuredClone(DEFAULT_PREFERENCES), preferred_packs: this.meta<string[]>('builtin_packs') ?? [], version: 1 };
  }
  updateSettings(version: number, input: unknown): PersonalSettings {
    const { version: _, ...fields } = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    const value = preferences(fields);
    return this.transaction(() => {
      const current = this.getSettings();
      if (current.version !== version) fail('SETTINGS_CONFLICT', '偏好已变化；请保留输入并读取当前值', current);
      const settings = { ...value, version: version + 1 };
      this.setMeta('preferences', settings); return settings;
    });
  }

  // ---------------------------------------------------------------- expression drafts

  startRevisionDraft(ref: ExpressionRef, version: number): Draft {
    return this.transaction(() => {
      const entry = this.currentEntry(ref.asset_id, version);
      if (entry.expression.revision_id !== ref.revision_id) fail('ENTRY_CONFLICT', '选中版本已经变化', entry);
      if (entry.archived) fail('SELECTION_UNAVAILABLE', '请先恢复归档条目');
      const e = entry.expression;
      const { text_locale, ...visual } = e.visual;
      const draft: Draft = { draft_id: `draft_${randomUUID()}`, version: 1, updated_at: new Date().toISOString(), mode: entry.origin === 'local' ? 'edit' : 'copy', source: ref, entry_version: version,
        fields: { realizes: e.realizes, intensity: e.intensity, ...(e.directions ? { directions: e.directions } : {}), original_locale: e.original_locale, name: e.name, semantics: e.semantics, ...(e.tags ? { tags: e.tags } : {}), rights: e.rights, text_locale },
        visual };
      this.db.prepare('INSERT INTO drafts VALUES (?,?)').run(draft.draft_id, JSON.stringify(draft)); return draft;
    });
  }
  createDraft(locale = 'zh-CN'): Draft {
    const draft: Draft = { draft_id: `draft_${randomUUID()}`, mode: 'create', version: 1, updated_at: new Date().toISOString(), fields: emptyFields(locale) };
    this.db.prepare('INSERT INTO drafts VALUES (?,?)').run(draft.draft_id, JSON.stringify(draft)); return draft;
  }
  getDraft(id: string): Draft {
    const row = this.db.prepare('SELECT data FROM drafts WHERE draft_id=?').get(id) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : fail('DRAFT_NOT_FOUND', '草稿不存在');
  }
  listDrafts(): Draft[] { return (this.db.prepare("SELECT data FROM drafts WHERE json_extract(data,'$.confirmed') IS NULL ORDER BY rowid DESC").all() as Array<{ data: string }>).map(row => JSON.parse(row.data)); }
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
      for (const [digest, data] of prepared.blobs) {
        const destination = join(this.directory, 'blobs', digest);
        if (await exists(destination)) { if (!(await readFile(destination)).equals(data)) fail('BLOB_INTEGRITY_FAILED', '已有素材损坏，不覆盖不可变素材'); }
        else { const temporary = `${destination}.${randomUUID()}.tmp`; await writeFile(temporary, data, { mode: 0o600 }); await rename(temporary, destination); }
      }
    }
    return this.transaction(() => {
      const current = this.getDraft(id);
      if (retry(current)) return current;
      this.currentDraft(id, version);
      if (current.confirmed) fail('DRAFT_CONFIRMED', '已确认版本不可修改');
      const visual = prepared ? (({ text_locale, ...rest }) => rest)(prepared.visual) : undefined;
      const draft: Draft = { ...current, fields, last_save: { base_version: version, request_hash: requestHash }, version: version + 1, updated_at: new Date().toISOString(), ...(visual ? { visual } : {}) };
      this.db.prepare('UPDATE drafts SET data=? WHERE draft_id=?').run(JSON.stringify(draft), id); return draft;
    });
  }
  async previewDraft(id: string, version: number): Promise<Draft> {
    const draft = this.currentDraft(id, version);
    validateDraftFields(draft.fields);
    if (!draft.visual) fail('MEDIA_REQUIRED', '请先上传视觉素材');
    await validateExpressionMedia({ visual: { ...draft.visual, text_locale: draft.fields.text_locale } }, blob => this.readBlob(blob));
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
      const { text_locale, ...fields } = draft.fields;
      const expression: Expression = { kind: 'amoji.expression', amoji: PROTOCOL, asset_id: editing ? draft.source!.asset_id : randomUUID(), revision_id: randomUUID(), ...fields, visual: { ...draft.visual!, text_locale }, created_at: new Date().toISOString().replace(/\.\d+Z$/, 'Z') };
      validateDraftFields(draft.fields);
      this.db.prepare('INSERT INTO revisions VALUES (?,?,?)').run(expression.asset_id, expression.revision_id, JSON.stringify(expression));
      if (editing) this.db.prepare('UPDATE entries SET revision_id=?, version=version+1 WHERE asset_id=?').run(expression.revision_id, expression.asset_id);
      else this.db.prepare("INSERT INTO entries VALUES (?,?,'local',NULL,1,0)").run(expression.asset_id, expression.revision_id);
      draft.confirmed = { asset_id: expression.asset_id, revision_id: expression.revision_id };
      this.db.prepare('UPDATE drafts SET data=? WHERE draft_id=?').run(JSON.stringify(draft), id);
      return expression;
    });
  }

  // ---------------------------------------------------------------- conversation

  /** Consumed tokens are message deduplication records and share their messages' retention. */
  pruneSelections(): void {
    this.db.prepare("DELETE FROM selections WHERE json_extract(data,'$.messageId') IS NULL AND json_extract(data,'$.expires')<=?").run(Date.now());
  }
  private session(context: BindingContext): Session {
    const row = this.db.prepare('SELECT data FROM sessions WHERE session_key=?').get(sessionKey(context)) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : { bindingId: randomUUID(), messages: [], received: [], windows: {} };
  }
  private save(context: BindingContext, session: Session): void { this.db.prepare('INSERT INTO sessions VALUES (?,?) ON CONFLICT(session_key) DO UPDATE SET data=excluded.data').run(sessionKey(context), JSON.stringify(session)); }
  history(context: BindingContext): StoredMessage[] { return this.session(context).messages; }
  private find(context: BindingContext, session: Session, messageId: string): StoredMessage {
    return session.messages.find(m => m.message_id === messageId) ?? fail('MESSAGE_NOT_FOUND', '当前会话不存在此消息');
  }

  search(context: BindingContext, query: string, limit = 3, locale?: string): SearchResult {
    if (!context.turnId?.trim()) fail('TURN_REQUIRED', 'AI 检索必须绑定真实回合');
    this.pruneSelections();
    const settings = this.getSettings();
    const ai = settings.ai_expressions;
    const usable = this.list().filter(e => (e.directions ?? ['a2h']).includes('a2h') && actAllows(e.realizes, 'a2h') && ai.families[actEntry(e.realizes).family]);
    const matches = ai.enabled ? searchExpressions(usable, query, limit) : [];
    const result = buildSearchResult(matches, () => randomBytes(24).toString('base64url'), preferencePolicy(settings), locale);
    result.candidates.forEach((candidate, index) => {
      const expression = matches[index]!;
      const selection: Selection = { context, ref: { asset_id: expression.asset_id, revision_id: expression.revision_id }, expires: Date.now() + 300000 };
      this.db.prepare('INSERT INTO selections VALUES (?,?)').run(candidate.selection_token, JSON.stringify(selection));
    });
    return result;
  }

  /** AI expression with the RFC §10.2 checks, in order; rejections carry a reason code. */
  express(context: BindingContext, input: ExpressInput): ExpressResult {
    const turnId = context.turnId;
    if (!turnId?.trim()) fail('TURN_REQUIRED', 'AI 表情必须绑定真实回合');
    const reject = (reason: RejectReason, message: string): ExpressResult => ({ status: 'rejected', reason, message });
    return this.transaction(() => {
      const settings = this.getSettings();
      const ai = settings.ai_expressions;
      const session = this.session(context);
      let selection: Selection | undefined; let glyph: Expression | undefined;
      if (input.selection_token !== undefined) {
        const row = this.db.prepare('SELECT data FROM selections WHERE token=?').get(input.selection_token) as { data: string } | undefined;
        selection = row ? JSON.parse(row.data) as Selection : undefined;
        if (selection?.messageId && sessionKey(selection.context) === sessionKey(context)) {
          const existing = session.messages.find(m => m.message_id === selection!.messageId);
          if (existing) return { status: 'sent', message: existing };
        }
      }
      if (!ai.enabled) return reject('ai_expressions_paused', '用户暂停了 AI 表情');
      if (input.selection_token !== undefined) {
        if (!selection || sessionKey(selection.context) !== sessionKey(context) || selection.context.turnId !== turnId || selection.expires <= Date.now() || !this.canSend(selection.ref)) return reject('invalid_selection_token', '选择凭据不属于本会话、本回应窗口，已过期或不可用');
        glyph = this.resolve(selection.ref);
      }
      const act = glyph?.realizes ?? input.act;
      const entry = act ? findAct(act) : undefined;
      if (!act || !entry) return reject('unknown_act', `码位不在注册表 ${REGISTRY_REVISION} 中`);
      if (!entry.forms.a2h || (glyph?.directions && !glyph.directions.includes('a2h'))) return reject('direction_not_allowed', '该码位不能由 AI 发出');
      if (!ai.families[entry.family]) return reject('family_disabled', `用户关闭了 ${entry.family} 类 AI 表情`);
      const window = session.windows[turnId] ?? 0;
      if (window >= ai.max_per_window) return reject('rate_limited', `每个回应窗口最多 ${ai.max_per_window} 条 AI 表情`);
      const windowMessages = session.messages.filter(m => m.from.role === 'ai' && m.sent_during === turnId);
      const pressure = entry.pressure_sensitive && (input.pending_confirmation || windowMessages.some(m => m.act === 'core:decide'));
      const decideAfterPressure = act === 'core:decide' && windowMessages.some(m => findAct(m.act)?.pressure_sensitive);
      if (pressure || decideAfterPressure) return reject('pending_confirmation', '有待决确认时不发送情感类表情');
      if (act === 'core:decide') {
        const options = input.options;
        if (!Array.isArray(options) || options.length < 2 || options.length > 6 || new Set(options.map(o => o?.id)).size !== options.length
          || options.some(o => !o || typeof o.id !== 'string' || !/^[a-z0-9-]{1,32}$/.test(o.id) || typeof o.label !== 'string' || !o.label.trim() || codePoints(o.label) > 60 || o.label.normalize('NFC') !== o.label)) return reject('invalid_options', 'core:decide 需要 2–6 个合法选项');
      } else if (input.options !== undefined) return reject('invalid_options', '只有 core:decide 可以带选项');
      if (input.replies !== undefined && (!Array.isArray(input.replies) || input.replies.length > 4 || new Set(input.replies).size !== input.replies.length || input.replies.some(r => typeof r !== 'string' || !actAllows(r, 'h2a')))) return reject('invalid_replies', '快捷回复最多 4 个，且必须能由人发出');
      if (input.anchor !== undefined && !validAnchor(input.anchor)) return reject('invalid_anchor', '锚定无效');
      if (input.rationale !== undefined && (typeof input.rationale !== 'string' || !input.rationale.trim() || codePoints(input.rationale) > 80 || input.rationale.normalize('NFC') !== input.rationale)) return reject('budget_exceeded', 'rationale 需要 1–80 字');
      if (input.intensity !== undefined && ![1, 2, 3].includes(input.intensity)) return reject('budget_exceeded', '强度只能是 1、2 或 3');
      glyph ??= this.glyphFor(act, 'a2h', input.locale, input.intensity);
      const message: StoredMessage = {
        message_id: randomUUID(), binding_id: session.bindingId, registry_revision: REGISTRY_REVISION, from: { role: 'ai', ...(input.agent_id ? { agent_id: input.agent_id } : {}) }, direction: 'ai_to_human',
        act, intensity: input.intensity ?? glyph?.intensity ?? 2, ...(glyph ? { revision: glyph } : {}), glyph_policy: selection ? 'keep' : 'prefer',
        ...(input.anchor ? { anchor: input.anchor } : {}), mode: 'turn', sent_during: turnId,
        ...(input.replies?.length ? { replies: input.replies } : {}), ...(act === 'core:decide' ? { options: input.options } : {}),
        ...(input.responds_to ? { responds_to: input.responds_to } : {}), ...(input.rationale ? { rationale: input.rationale } : {}),
        created_at: timestamp(), presentation: 'pending',
      };
      session.messages.push(message);
      session.windows[turnId] = window + 1;
      this.save(context, session);
      if (selection && input.selection_token) { selection.messageId = message.message_id; this.db.prepare('UPDATE selections SET data=? WHERE token=?').run(JSON.stringify(selection), input.selection_token); }
      return { status: 'sent', message };
    });
  }

  /** Human expression from the host's own UI (RFC §11.4). Idempotent per request id. */
  receive(context: BindingContext, input: ReceiveInput, requestId: string): StoredMessage {
    return this.transaction(() => {
      const session = this.session(context);
      const previous = new Map(session.received).get(requestId);
      if (previous) {
        const message = this.find(context, session, previous);
        if ((input.ref && (message.revision?.asset_id !== input.ref.asset_id || message.revision?.revision_id !== input.ref.revision_id)) || (input.act && message.act !== input.act) || message.note !== input.note || !isDeepStrictEqual(message.effect_intent?.selection, input.effect)) fail('REQUEST_CONFLICT', '该请求已用于其他表情');
        return message;
      }
      let glyph: Expression | undefined;
      if (input.ref) {
        glyph = this.resolve(input.ref);
        if (!this.canSend(input.ref)) fail('SELECTION_UNAVAILABLE', '已选版本当前不可新发，请重新选择');
        if (glyph.directions && !glyph.directions.includes('h2a')) fail('DIRECTION_NOT_ALLOWED', '这个表情不能由人发出');
      }
      const act = glyph?.realizes ?? input.act;
      if (!act || !findAct(act)) fail('UNKNOWN_ACT', '码位不在注册表中');
      if (!actAllows(act, 'h2a')) fail('DIRECTION_NOT_ALLOWED', '该码位不能由人发出');
      if (input.act && glyph && input.act !== glyph.realizes) fail('INVALID_ARGUMENT', '码位与所选表情不一致');
      glyph ??= this.glyphFor(act, 'h2a', input.locale, input.intensity);
      const mode = input.mode ?? 'turn';
      if (mode === 'backchannel' && !backchannelEligible(act)) fail('MODE_NOT_ALLOWED', '关系类表情不能在 AI 工作时插入');
      if (mode === 'interrupt' && !interruptEligible(act)) fail('MODE_NOT_ALLOWED', '只有暂停和停止可以打断');
      if (mode !== 'turn' && !input.sent_during) fail('INVALID_ARGUMENT', '纠偏信号需要 sent_during');
      if (input.note !== undefined && (typeof input.note !== 'string' || !input.note.trim() || codePoints(input.note) > 140)) fail('INVALID_ARGUMENT', '附言需要 1–140 字');
      if (input.anchor !== undefined && !validAnchor(input.anchor)) fail('INVALID_ARGUMENT', '锚定无效');
      if (input.intensity !== undefined && ![1, 2, 3].includes(input.intensity)) fail('INVALID_ARGUMENT', '强度只能是 1、2 或 3');
      const choice = input.effect ? (glyph ? this.effectChoices(context, glyph).find(c => isDeepStrictEqual(c.selection, input.effect)) : undefined) ?? fail('EFFECT_UNAVAILABLE', '此精确效果不可用于所选表情') : undefined;
      const message: StoredMessage = {
        message_id: randomUUID(), binding_id: session.bindingId, registry_revision: REGISTRY_REVISION, from: { role: 'human', ...(input.participant_id ? { participant_id: input.participant_id } : {}) }, direction: 'human_to_ai',
        act, intensity: input.intensity ?? glyph?.intensity ?? 2, ...(input.note ? { note: input.note.normalize('NFC') } : {}), ...(glyph ? { revision: glyph } : {}), glyph_policy: 'keep',
        ...(input.anchor ? { anchor: input.anchor, ...(input.anchor_degraded ? { anchor_degraded: true } : {}) } : {}), mode,
        ...(input.sent_during ? { sent_during: input.sent_during } : {}), ...(input.responds_to ? { responds_to: input.responds_to } : {}),
        ...(mode === 'backchannel' ? { signal: 'queued' as const } : {}), created_at: timestamp(), presentation: 'pending',
      };
      if (mode === 'backchannel') {
        // Coalesce: an undelivered signal of the same act from this sender is replaced by the newest one.
        for (const old of session.messages) if (old.mode === 'backchannel' && old.signal === 'queued' && old.act === act && old.from.role === 'human' && !old.retracted_at) old.retracted_at = message.created_at;
      }
      if (choice) {
        message.effect_intent = { ...choice, operation_id: randomUUID(), requestId, status: 'prepared' };
        this.db.prepare('INSERT INTO effect_intents VALUES (?,?,?,?)').run(message.effect_intent.operation_id, sessionKey(context), requestId, JSON.stringify(message.effect_intent));
      }
      session.messages.push(message);
      session.received.push([requestId, message.message_id]);
      this.save(context, session); return message;
    });
  }

  /** Only the original human sender retracts; history keeps the message (RFC §8.6). */
  retract(context: BindingContext, messageId: string): StoredMessage {
    return this.transaction(() => {
      const session = this.session(context); const message = this.find(context, session, messageId);
      if (message.from.role !== 'human') fail('NOT_SENDER', '只能撤回自己发出的表情');
      message.retracted_at ??= timestamp();
      this.save(context, session); return message;
    });
  }
  /** Answer a core:decide once. A choice expresses preference and never grants permission. */
  choose(context: BindingContext, messageId: string, option: string): StoredMessage {
    return this.transaction(() => {
      const session = this.session(context); const message = this.find(context, session, messageId);
      if (message.act !== 'core:decide' || !message.options) fail('NOT_A_DECISION', '这条消息不是决策');
      if (message.choice) { if (message.choice.option === option) return message; fail('ALREADY_CHOSEN', '这个决策已经作答，改主意请用文字说明'); }
      const selected = message.options.find(o => o.id === option) ?? fail('INVALID_ARGUMENT', '选项不存在');
      message.choice = { option: selected.id, label: selected.label, at: timestamp() };
      this.save(context, session); return message;
    });
  }
  /** Correction-signal delivery: queued → delivered_to_model, or promoted to a turn message (RFC §8.3). */
  signal(context: BindingContext, messageId: string, state: 'delivered_to_model' | 'promoted'): StoredMessage {
    return this.transaction(() => {
      const session = this.session(context); const message = this.find(context, session, messageId);
      if (message.mode !== 'backchannel' && message.signal !== 'promoted') fail('NOT_A_SIGNAL', '这条消息不是纠偏信号');
      if (message.signal === 'queued') {
        message.signal = state;
        if (state === 'promoted') message.mode = 'turn';
      }
      this.save(context, session); return message;
    });
  }
  /** Host-observed execution of a pause or stop. */
  applied(context: BindingContext, messageId: string): StoredMessage {
    return this.transaction(() => {
      const session = this.session(context); const message = this.find(context, session, messageId);
      if (message.mode !== 'interrupt') fail('NOT_AN_INTERRUPT', '这条消息不是打断');
      message.applied = true; this.save(context, session); return message;
    });
  }
  presentation(context: BindingContext, messageId: string, state: 'rendered' | 'fallback'): void {
    this.transaction(() => { const session = this.session(context); this.find(context, session, messageId).presentation = state; this.save(context, session); });
  }
  dshAttempted(context: BindingContext, messageId: string): boolean {
    if (context.host !== 'dsh') fail('BINDING_MISMATCH', '只有 dsh 可以保存原生投递记录');
    return this.transaction(() => {
      const session = this.session(context);
      const message = session.messages.find(m => m.message_id === messageId && m.direction === 'human_to_ai') ?? fail('BINDING_MISMATCH', '投递消息不属于当前会话');
      if (message.dsh_submission) return false;
      message.dsh_submission = 'attempted'; this.save(context, session); return true;
    });
  }
  dshAccepted(context: BindingContext, messageId: string): void {
    if (context.host !== 'dsh') fail('BINDING_MISMATCH', '只有 dsh 可以保存原生投递回执');
    this.transaction(() => {
      const session = this.session(context);
      const message = session.messages.find(m => m.message_id === messageId && m.direction === 'human_to_ai') ?? fail('BINDING_MISMATCH', '投递消息不属于当前会话');
      message.dsh_submission = 'accepted'; this.save(context, session);
    });
  }

  // ---------------------------------------------------------------- effects and session rules

  private effectSource(pack: Pack): EffectChoice['source'] {
    const install = this.db.prepare('SELECT origin FROM local_installs WHERE release_id=?').get(pack.release_id) as { origin: string } | undefined;
    const source = this.releaseSource(pack.release_id);
    return { pack_id: pack.pack_id, release_id: pack.release_id, version: pack.version, original_locale: pack.original_locale,
      origin: install?.origin ?? (source?.startsWith('market:') ? source.slice(7) : source === 'imported' ? 'imported-file' : source ?? 'local') };
  }
  /** Effects bound to this exact expression, or to its act inside the same pack (RFC §7.3). */
  effectChoices(context: BindingContext, ref: ExpressionRef): EffectChoice[] {
    if (!['dsh', 'claude-code'].includes(context.host)) fail('CAPABILITY_UNAVAILABLE', '此宿主不支持协作效果');
    return this.listPacks().flatMap(pack => {
      const expression = pack.expressions.find(e => e.asset_id === ref.asset_id && e.revision_id === ref.revision_id);
      if (!expression || !pack.effects?.length || !this.releaseActive(pack.release_id)) return [];
      const ids = new Set((pack.bindings ?? []).filter(b => 'act' in b.target ? b.target.act === expression.realizes : b.target.asset_id === ref.asset_id && b.target.revision_id === ref.revision_id).flatMap(b => b.effects));
      return pack.effects.filter(effect => ids.has(effect.effect_id)).map(effect => ({ selection: { release_id: pack.release_id, effect_id: effect.effect_id, effect_revision_id: effect.effect_revision_id }, effect, source: this.effectSource(pack) }));
    });
  }
  ruleChoices(context: BindingContext): RuleChoice[] {
    if (!['dsh', 'claude-code'].includes(context.host)) fail('CAPABILITY_UNAVAILABLE', '此宿主不支持会话规则');
    const packs = this.listPacks();
    return packs.flatMap(pack => {
      if (!this.releaseActive(pack.release_id)) return [];
      // A new release never carries forward consent to a changed effect revision.
      if (packs.some(p => p.pack_id === pack.pack_id && p.version > pack.version)) return [];
      return (pack.effects ?? []).map(effect => ({ selection: { release_id: pack.release_id, effect_id: effect.effect_id, effect_revision_id: effect.effect_revision_id }, effect, source: this.effectSource(pack) }));
    });
  }
  rules(context: BindingContext): RuleSnapshot {
    const row = this.db.prepare('SELECT data FROM session_rules WHERE session_key=?').get(sessionKey(context)) as { data: string } | undefined;
    const state: RuleSnapshot = row ? JSON.parse(row.data) : { generation: 0, rules: [] };
    const choices = this.ruleChoices(context);
    let changed = false;
    for (const rule of state.rules) if (rule.enabled && !choices.some(c => isDeepStrictEqual(c.selection, rule.selection))) { rule.enabled = false; rule.status = 'disabled'; rule.reason = 'source-unavailable'; changed = true; }
    if (changed) { state.generation++; for (const rule of state.rules) rule.generation = state.generation; this.writeRules(context, state); }
    return state;
  }
  private writeRules(context: BindingContext, state: RuleSnapshot): void {
    this.db.prepare('INSERT INTO session_rules VALUES (?,?,?) ON CONFLICT(session_key) DO UPDATE SET generation=excluded.generation, data=excluded.data').run(sessionKey(context), state.generation, JSON.stringify(state));
  }
  changeRules(context: BindingContext, change: RuleChange): RuleSnapshot {
    return this.transaction(() => {
      const state = this.rules(context);
      if (!Number.isSafeInteger(change.generation) || state.generation !== change.generation) fail('RULE_STALE', '规则已变更，请刷新后重试');
      if (change.kind === 'enable') {
        const choice = this.ruleChoices(context).find(c => isDeepStrictEqual(c.selection, change.selection)) ?? fail('EFFECT_UNAVAILABLE', '此精确效果版本当前不可启用');
        const group = effectConflictGroup(choice.effect);
        const active = state.rules.find(r => r.enabled && ruleConflictGroup(r) === group);
        if (active && !isDeepStrictEqual(active.selection, change.replace)) fail('RULE_CONFLICT', '同组效果已启用，请明确选择替换');
        if (!active && change.replace) fail('RULE_STALE', '待替换效果已变化');
        state.rules = state.rules.filter(r => ruleConflictGroup(r) !== group);
        state.rules.push({ ...choice, actor: 'user', enabled: true, generation: state.generation + 1, status: 'configured' });
      } else for (const rule of state.rules) if (change.kind === 'disableAll' || isDeepStrictEqual(rule.selection, change.selection)) { rule.enabled = false; rule.status = 'disabled'; }
      const active = state.rules.filter(r => r.enabled);
      if (active.length > 2) fail('EFFECT_LIMIT', '最多两条持续效果');
      try { collaborationEnvelope(context.hostInstanceId!, context.sessionId, Number.MAX_SAFE_INTEGER, active.map(compiledRule)); } catch { fail('EFFECT_LIMIT', '完整效果上下文超过 8 KiB，不截断'); }
      state.generation++; state.checkpoint = change.checkpoint;
      for (const rule of state.rules) rule.generation = state.generation;
      this.writeRules(context, state); return state;
    });
  }
  saveEffectIntent(context: BindingContext, messageId: string, update: Pick<EffectIntent, 'status' | 'checkpoint' | 'receipt'>): void {
    if (context.host !== 'dsh') fail('BINDING_MISMATCH', '效果仅支持 dsh');
    this.transaction(() => {
      const session = this.session(context); const message = session.messages.find(m => m.message_id === messageId);
      if (!message?.effect_intent) fail('BINDING_MISMATCH', '效果不属于此会话消息');
      if (message.effect_intent.receipt?.reason === 'safety_removed') return;
      message.effect_intent = { ...message.effect_intent, ...update };
      this.db.prepare('UPDATE effect_intents SET data=? WHERE operation_id=? AND session_key=?').run(JSON.stringify(message.effect_intent), message.effect_intent.operation_id, sessionKey(context));
      if (update.receipt) this.db.prepare('INSERT INTO effect_receipts VALUES (?,?,?) ON CONFLICT(receipt_id) DO UPDATE SET data=excluded.data').run(message.effect_intent.operation_id, sessionKey(context), JSON.stringify(update.receipt));
      this.save(context, session);
    });
  }

  // ---------------------------------------------------------------- marketplace

  private unsafePack(pack: Pack, digest?: string): boolean {
    const rows = this.db.prepare('SELECT release_id,data FROM revocations').all() as Array<{ release_id: string; data: string }>;
    return rows.some(row => {
      const r = JSON.parse(row.data);
      return r.state === 'safety_removed' && ((digest && r.archive_sha256 === digest) || row.release_id === pack.release_id
        || (pack.effects ?? []).some(e => (r.effects ?? []).some((b: { effect_id: string; effect_revision_id: string }) => effectKey(e) === effectKey(b))));
    });
  }
  applyRevocations(origin: string, entries: Array<{ pack_id: string; release_id: string; archive_sha256: string; state: string; reason_code: string }>, cursor: string, checked: string): void {
    this.transaction(() => {
      for (const entry of entries) {
        if (entry.state !== 'safety_removed') continue;
        const pack = this.listPacks().find(p => p.release_id === entry.release_id);
        const old = this.db.prepare('SELECT data FROM revocations WHERE origin=? AND release_id=?').get(origin, entry.release_id) as { data: string } | undefined;
        const data = { ...entry, effects: pack?.effects?.map(e => ({ effect_id: e.effect_id, effect_revision_id: e.effect_revision_id })) ?? (old ? JSON.parse(old.data).effects : []) };
        this.db.prepare('INSERT INTO revocations VALUES(?,?,?) ON CONFLICT(origin,release_id) DO UPDATE SET data=excluded.data').run(origin, entry.release_id, JSON.stringify(data));
      }
      const unsafe = new Set(this.listPacks().filter(p => this.unsafePack(p)).map(p => p.release_id));
      for (const row of this.db.prepare('SELECT session_key,data FROM session_rules').all() as Array<{ session_key: string; data: string }>) {
        const state: RuleSnapshot = JSON.parse(row.data); let changed = false;
        for (const rule of state.rules) if (rule.enabled && unsafe.has(rule.source.release_id)) { rule.enabled = false; rule.status = 'disabled'; rule.reason = 'safety_removed'; changed = true; }
        if (changed) { state.generation++; for (const rule of state.rules) rule.generation = state.generation; this.db.prepare('UPDATE session_rules SET generation=?, data=? WHERE session_key=?').run(state.generation, JSON.stringify(state), row.session_key); }
      }
      for (const row of this.db.prepare('SELECT session_key,data FROM sessions').all() as Array<{ session_key: string; data: string }>) {
        const session: Session = JSON.parse(row.data); let changed = false;
        for (const message of session.messages) {
          const intent = message.effect_intent;
          if (intent && unsafe.has(intent.source.release_id)) { intent.status = 'failed'; intent.receipt = { status: 'failed', reason: 'safety_removed' }; this.db.prepare('UPDATE effect_intents SET data=? WHERE operation_id=?').run(JSON.stringify(intent), intent.operation_id); changed = true; }
        }
        if (changed) this.db.prepare('UPDATE sessions SET data=? WHERE session_key=?').run(JSON.stringify(session), row.session_key);
      }
      this.marketWrite('revocation:' + origin, { cursor, last_checked_at: checked, stale: false });
    });
  }
  marketRead<T>(key: string): T | undefined { return this.meta<T>(`market:${key}`); }
  marketWrite(key: string, value: unknown): void { this.setMeta(`market:${key}`, value); }
  marketInstalls(): Array<{ release_id: string; origin: string; digest: string; state: string; refs: ExpressionRef[] }> { return (this.db.prepare('SELECT * FROM local_installs').all() as Array<{ release_id: string; origin: string; digest: string; state: string; refs: string }>).map(r => ({ ...r, refs: JSON.parse(r.refs) })); }
  marketCollections(): Array<{ ref: ExpressionRef; source: { origin: string; release_id: string; pack_id: string; rights: unknown } }> { return (this.db.prepare('SELECT * FROM collection_refs').all() as Array<{ asset_id: string; revision_id: string; origin: string }>).map(r => ({ ref: { asset_id: r.asset_id, revision_id: r.revision_id }, source: JSON.parse(r.origin) })); }
  async marketCommit(pack: ValidatedPack, source: { origin: string; digest: string; operation_id: string; ref?: ExpressionRef }, beforeCommit: () => Promise<void>): Promise<void> {
    const manifest = pack.manifest;
    if (source.ref && !manifest.expressions.some(e => e.asset_id === source.ref!.asset_id && e.revision_id === source.ref!.revision_id)) fail('REVISION_NOT_FOUND', '收藏版本不在包内');
    const selected = source.ref ? [source.ref] : manifest.expressions.map(e => ({ asset_id: e.asset_id, revision_id: e.revision_id }));
    await this.importValidatedPack(pack, `market:${source.origin}`, {
      refs: selected, beforeCommit,
      commit: () => {
        if (source.ref) {
          this.db.prepare("UPDATE local_installs SET state='collected', origin=? WHERE release_id=? AND state='removed'").run(source.origin, manifest.release_id);
          this.db.prepare('INSERT INTO collection_refs VALUES (?,?,?) ON CONFLICT(asset_id,revision_id) DO UPDATE SET origin=excluded.origin').run(source.ref.asset_id, source.ref.revision_id, JSON.stringify({ origin: source.origin, release_id: manifest.release_id, pack_id: manifest.pack_id, rights: manifest.rights }));
        } else {
          for (const old of this.marketInstalls()) if (old.state === 'installed' && this.getPack(old.release_id).pack_id === manifest.pack_id && old.release_id !== manifest.release_id) this.removePackRecords(old.release_id);
          this.db.prepare('INSERT INTO local_installs VALUES (?,?,?,?,?) ON CONFLICT(release_id) DO UPDATE SET state=excluded.state, refs=excluded.refs').run(manifest.release_id, source.origin, source.digest, 'installed', JSON.stringify(selected));
          for (const ref of selected) if (this.marketRead(`owned:${ref.asset_id}`)) this.db.prepare('UPDATE entries SET revision_id=?, version=version+1 WHERE asset_id=? AND revision_id<>?').run(ref.revision_id, ref.asset_id, ref.revision_id);
        }
        this.marketPrune();
        const op = this.marketRead<Record<string, unknown>>(`operation:${source.operation_id}`)!;
        this.marketWrite(`operation:${source.operation_id}`, { ...op, status: 'committed', last_checked_at: new Date().toISOString() });
      },
    });
  }
  marketRemove(packId: string): void { this.transaction(() => { for (const i of this.marketInstalls()) if (this.getPack(i.release_id).pack_id === packId) this.removePackRecords(i.release_id); this.marketPrune(); }); }
  marketUncollect(ref: ExpressionRef): void { this.transaction(() => { this.db.prepare('DELETE FROM collection_refs WHERE asset_id=? AND revision_id=?').run(ref.asset_id, ref.revision_id); this.marketPrune(); }); }
  /** Only acquisition-owned entries disappear with their last market reference. */
  private marketPrune(): void {
    const retained = [...this.marketInstalls().filter(i => i.state === 'installed').flatMap(i => i.refs), ...this.marketCollections().map(c => c.ref)];
    for (const entry of this.listEntries()) {
      const id = entry.expression.asset_id;
      if (entry.origin === 'local' || !this.marketRead(`owned:${id}`)) continue;
      const ref = retained.find(r => r.asset_id === id && r.revision_id === entry.expression.revision_id) ?? retained.find(r => r.asset_id === id);
      if (ref) { this.db.prepare('UPDATE entries SET revision_id=? WHERE asset_id=?').run(ref.revision_id, id); continue; }
      this.db.prepare('DELETE FROM entries WHERE asset_id=?').run(id);
    }
  }

  // ---------------------------------------------------------------- blobs

  private async readBlob(blob: BlobRef): Promise<Buffer> { await this.verifyBlob(blob); return readFile(join(this.directory, 'blobs', blob.sha256)); }
  async blobPath(digest: string): Promise<string> {
    if (!/^[a-f0-9]{64}$/.test(digest)) fail('INVALID_ARGUMENT', '无效素材摘要');
    const revisions = (this.db.prepare('SELECT data FROM revisions').all() as Array<{ data: string }>).flatMap(row => { const e: Expression = JSON.parse(row.data); return [e.visual.primary, e.visual.poster]; });
    const drafts = (this.db.prepare('SELECT data FROM drafts').all() as Array<{ data: string }>).flatMap(row => { const d: Draft = JSON.parse(row.data); return [d.visual?.primary, d.visual?.poster]; });
    const blob = [...drafts, ...revisions].find(b => b?.sha256 === digest);
    if (!blob) fail('BLOB_MISSING', '素材未被任何版本引用');
    await this.verifyBlob(blob); return join(this.directory, 'blobs', digest);
  }
  private async verifyBlob(blob: BlobRef): Promise<void> {
    let bytes: Buffer;
    try { bytes = await readFile(join(this.directory, 'blobs', blob.sha256)); } catch { fail('BLOB_MISSING', '保留素材缺失'); }
    if (bytes.length !== blob.bytes || createHash('sha256').update(bytes).digest('hex') !== blob.sha256) fail('BLOB_INTEGRITY_FAILED', '素材摘要不匹配');
  }
  close(): void { this.db.close(); }
}

function validAnchor(anchor: Anchor): boolean {
  if (!anchor || typeof anchor !== 'object' || typeof anchor.message_id !== 'string' || !anchor.message_id || anchor.message_id.length > 200) return false;
  const keys = Object.keys(anchor);
  if (keys.some(k => !['message_id', 'exact', 'prefix', 'suffix', 'start', 'end'].includes(k))) return false;
  if (anchor.exact !== undefined && (typeof anchor.exact !== 'string' || !anchor.exact || codePoints(anchor.exact) > 280)) return false;
  for (const side of [anchor.prefix, anchor.suffix]) if (side !== undefined && (typeof side !== 'string' || codePoints(side) > 32)) return false;
  for (const n of [anchor.start, anchor.end]) if (n !== undefined && (!Number.isSafeInteger(n) || n < 0)) return false;
  return true;
}
function timestamp(): string { return new Date().toISOString(); }
async function exists(path: string): Promise<boolean> { try { await access(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; } }
/** Stable identity for one save intent, independent of JSON object key order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
