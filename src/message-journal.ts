import { DatabaseSync } from 'node:sqlite';
import type { HostContext } from './codex-context.js';
import type { SampleMessage } from './sample-runtime.js';
import type { Expression } from './sample-catalog.js';
import { isDeepStrictEqual } from 'node:util';

export interface StoredSession {
  version: number;
  bindingId: string;
  messages: SampleMessage[];
  emittedTurns: string[];
  received: Array<[string, string]>;
}

/** Ticket 01 history only; the editable shared library is a separate later migration. */
export class MessageJournal {
  private readonly db: DatabaseSync;
  private closed = false;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA busy_timeout=3000; PRAGMA journal_mode=WAL;');
    const version = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
    if (version.user_version > 1) { this.db.close(); throw new Error('消息记录版本过新，请升级插件'); }
    this.db.exec('CREATE TABLE IF NOT EXISTS session_snapshots (session_key TEXT PRIMARY KEY, version INTEGER NOT NULL, data TEXT NOT NULL); PRAGMA user_version=1;');
    this.db.exec('CREATE TABLE IF NOT EXISTS revision_definitions (asset_id TEXT NOT NULL, revision_id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(asset_id,revision_id));');
  }

  /** Remember every installed definition, including samples later removed from the catalog. */
  registerRevisions(expressions: Expression[]): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const expression of expressions) {
        const previous = this.db.prepare('SELECT data FROM revision_definitions WHERE asset_id=? AND revision_id=?').get(expression.asset_id, expression.revision_id) as { data: string } | undefined;
        if (previous && !isDeepStrictEqual(JSON.parse(previous.data), expression)) throw new Error('REVISION_CONFLICT：同一版本不能修改已确认的定义');
        if (!previous) this.db.prepare('INSERT INTO revision_definitions(asset_id,revision_id,data) VALUES (?,?,?)').run(expression.asset_id, expression.revision_id, JSON.stringify(expression));
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  load(context: HostContext): StoredSession | undefined {
    const row = this.db.prepare('SELECT version, data FROM session_snapshots WHERE session_key=?').get(`${context.host}:${context.sessionId}`) as { version: number; data: string } | undefined;
    return row ? { ...JSON.parse(row.data), version: row.version } : undefined;
  }

  save(context: HostContext, state: Omit<StoredSession, 'version'>, expectedVersion: number): number {
    const key = `${context.host}:${context.sessionId}`;
    const data = JSON.stringify(state);
    const result = expectedVersion === 0
      ? this.db.prepare('INSERT OR IGNORE INTO session_snapshots(session_key,version,data) VALUES (?,1,?)').run(key, data)
      : this.db.prepare('UPDATE session_snapshots SET version=version+1,data=? WHERE session_key=? AND version=?').run(data, key, expectedVersion);
    if (result.changes !== 1) throw new Error('会话记录已在其他连接改变，请重试');
    return expectedVersion + 1;
  }

  close(): void { if (!this.closed) { this.closed = true; this.db.close(); } }
}
