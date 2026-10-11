import { createHash } from "node:crypto";
import type { Env } from './worker';
const STATUS = 'backups/status.json';
const PENDING = 'backups/pending.json';
const DAY = 86_400_000;
const MAX_BYTES = 256 * 1024 * 1024;
const TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
type BackupStatus = { key?: string; sha256?: string; bytes?: number; snapshot_at?: number; completed_at?: number; failed?: boolean; retention_failed?: boolean };
type Pending = { started_at: number; bookmark?: string };
async function read<T>(env: Env, key: string): Promise<T | null> {
  const object = await env.UPLOADS?.get(key);
  return object ? object.json<T>() : null;
}
/** Public operational state deliberately excludes SQL, object paths and provider errors. */
export async function backupHealth(env: Env, now = Date.now()) {
  try {
    const state = await read<BackupStatus>(env, STATUS);
    const last = state?.snapshot_at ?? null;
    return { status: state?.failed || state?.retention_failed ? 'failed' : last === null ? 'missing' : now - last > DAY ? 'stale' : 'ok', last_success_at: last };
  } catch { return { status: 'unavailable', last_success_at: null }; }
}
/** One bounded export/poll per cron. Start twice daily to leave retry margin for the 24h RPO. */
export async function runBackup(env: Env, now = Date.now(), network: typeof fetch = fetch) {
  if (!env.UPLOADS) return;
  let previous: BackupStatus | null;
  try { previous = await read<BackupStatus>(env, STATUS); } catch { console.error("BACKUP_STATE_UNAVAILABLE"); return; }
  let retentionFailed = false;
  // Privacy retention progresses even when credentials/export/download fail.
  try {
    const old = await env.UPLOADS.list({ prefix: 'backups/d1/', limit: 1000 });
    for (const object of old.objects) {
      if (object.uploaded.getTime() > now - 30 * DAY) continue;
      await env.UPLOADS.delete(object.key);
      if (previous?.key === object.key) { previous = null; await env.UPLOADS.put(STATUS, JSON.stringify({ failed: true })); }
    }
    if (old.truncated) throw Error('BACKUP_RETENTION_PAGE');
  } catch { retentionFailed = true; console.error('BACKUP_RETENTION_RETRY'); }
  if (previous?.snapshot_at && now - previous.snapshot_at < DAY / 2 && !previous.failed) {
    if (retentionFailed !== !!previous.retention_failed) await env.UPLOADS.put(STATUS, JSON.stringify({ ...previous, retention_failed: retentionFailed }));
    return;
  }
  try {
    if (!/^[a-f0-9]{32}$/.test(env.BACKUP_ACCOUNT_ID ?? '') || !/^[a-f0-9-]{36}$/.test(env.BACKUP_DATABASE_ID ?? '') || !env.D1_BACKUP_API_TOKEN) throw Error('BACKUP_CONFIGURATION');
    let pending = await read<Pending>(env, PENDING);
    if (!pending || now - pending.started_at > DAY) pending = { started_at: now };
    const api = await network(`https://api.cloudflare.com/client/v4/accounts/${env.BACKUP_ACCOUNT_ID}/d1/database/${env.BACKUP_DATABASE_ID}/export`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000),
      headers: { authorization: `Bearer ${env.D1_BACKUP_API_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ output_format: 'polling', ...(pending.bookmark ? { current_bookmark: pending.bookmark } : {}) }),
    });
    if (!api.ok) throw Error('BACKUP_EXPORT');
    const data = await api.json() as { success: boolean; result: { success?: boolean; status?: string; at_bookmark?: string; error?: string; result?: { signed_url?: string } } };
    if (!data.success || data.result.success === false || data.result.error || data.result.status === 'error') throw Error('BACKUP_EXPORT');
    if (data.result.status !== 'complete') {
      if (!data.result.at_bookmark || data.result.at_bookmark.length > 512) throw Error('BACKUP_EXPORT');
      await env.UPLOADS.put(PENDING, JSON.stringify({ ...pending, bookmark: data.result.at_bookmark }));
      await env.UPLOADS.put(STATUS, JSON.stringify({ ...previous, retention_failed: retentionFailed }));
      return;
    }
    const url = new URL(data.result.result?.signed_url ?? '');
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !(url.hostname === '1ad59b064bfa3690063414a9906129e4.r2.cloudflarestorage.com')) throw Error('BACKUP_URL');
    const response = await network(url.href, { redirect: 'error', signal: AbortSignal.timeout(60_000) });
    if (!response.ok || !response.body || Number(response.headers.get('content-length')) > MAX_BYTES) throw Error('BACKUP_DOWNLOAD');
    const length = Number(response.headers.get('content-length'));
    if (!Number.isSafeInteger(length) || length <= 0 || length > MAX_BYTES) throw Error('BACKUP_SIZE');
    const inventory = await env.UPLOADS.list({ prefix: 'backups/d1/', limit: 1000 });
    if (inventory.truncated) throw Error('BACKUP_STORAGE_BUDGET');
    let total = inventory.objects.reduce((sum, object) => sum + object.size, 0);
    for (const object of inventory.objects.sort((a, b) => a.uploaded.getTime() - b.uploaded.getTime())) {
      if (total + length <= TOTAL_BYTES) break;
      if (object.key === previous?.key) continue;
      await env.UPLOADS.delete(object.key); total -= object.size;
    }
    if (total + length > TOTAL_BYTES) throw Error('BACKUP_STORAGE_BUDGET');
    const key = `backups/d1/${new Date(pending.started_at).toISOString().replaceAll(':', '-')}-${crypto.randomUUID()}.sql`;
    const stream = new FixedLengthStream(length);
    const reader = response.body.getReader(), writer = stream.writable.getWriter();
    const hash = createHash('sha256'); let received = 0;
    const stored = env.UPLOADS.put(key, stream.readable, { onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: 'application/sql' }, customMetadata: { snapshot_at: String(pending.started_at) } });
    const pumping = (async () => {
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        received += value.length; if (received > length) throw Error('BACKUP_SIZE');
        hash.update(value); await writer.write(value);
      }
      if (received !== length) throw Error('BACKUP_SIZE');
      await writer.close();
    })();
    try {
      const [object] = await Promise.all([stored, pumping]);
      if (object === null) throw Error('BACKUP_OBJECT_CONFLICT');
    } catch {
      await Promise.allSettled([reader.cancel(), writer.abort()]);
      await Promise.allSettled([stored, pumping]);
      throw Error('BACKUP_DOWNLOAD');
    } finally { reader.releaseLock(); writer.releaseLock(); }
    const sha256 = hash.digest('hex');
    // Publish the pointer only after the complete SQL object is durable.
    await env.UPLOADS.put(STATUS, JSON.stringify({ key, sha256, bytes: length, snapshot_at: pending.started_at, completed_at: now, failed: false, retention_failed: retentionFailed }));
    try { await env.UPLOADS.delete(PENDING); } catch { console.error('BACKUP_BOOKMARK_CLEANUP_RETRY'); }
  } catch {
    console.error("BACKUP_FAILED");
    await env.UPLOADS.put(STATUS, JSON.stringify({ ...previous, failed: true, retention_failed: retentionFailed }));
  }
}
