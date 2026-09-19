import { createServer, type ServerResponse, type IncomingMessage } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LibraryStore } from './library-store.js';
import { API_VERSION, DATABASE_VERSION, PACKS_CAPABILITY, LIBRARY_MANAGEMENT_CAPABILITY, CREATE_DRAFT_CAPABILITY, TEXT_SUGGESTION_CAPABILITY, DSH_SUBMISSION_CAPABILITY, DSH_NATIVE_CAPABILITY, CLAUDE_TICKET_CAPABILITY, ServiceError, bindingContext, fail, nonempty, object, type BindingContext, type ServiceDescriptor } from './shared-contract.js';
import { ClaudeTickets } from './claude-tickets.js';
import { suggestText } from './suggestions.js';

import { expressionRef } from './library-management.js';
import { draftVersion } from './drafts.js';

interface Connection { response: ServerResponse; bindings: Map<string, BindingContext> }

/** A kernel-held SQLite EXCLUSIVE lock elects the sole writer, including during startup. */
export async function startSharedService(directory: string, seed: URL, idleMs = 60000): Promise<{ close(): Promise<void> }> {
  process.umask(0o077);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  directory = await realpath(directory);
  await chmod(directory, 0o700);
  const lock = new DatabaseSync(join(directory, 'service-lock.sqlite'));
  try { lock.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE; CREATE TABLE IF NOT EXISTS owner (id TEXT);'); }
  catch { lock.close(); fail('SERVICE_STARTING', '另一个服务已取得写入锁，等待健康握手'); }
  let store: LibraryStore;
  try { store = await LibraryStore.open(directory, seed); }
  catch (error) { lock.close(); throw error; }
  const descriptor: ServiceDescriptor = { serviceId: randomUUID(), pid: process.pid, dataRoot: directory, apiVersion: API_VERSION, databaseVersion: DATABASE_VERSION, capabilities: [PACKS_CAPABILITY, LIBRARY_MANAGEMENT_CAPABILITY, CLAUDE_TICKET_CAPABILITY, DSH_SUBMISSION_CAPABILITY, DSH_NATIVE_CAPABILITY, CREATE_DRAFT_CAPABILITY, TEXT_SUGGESTION_CAPABILITY], origin: '', secret: randomBytes(32).toString('base64url') };
  const connections = new Map<string, Connection>();
  const claudeTickets = new ClaudeTickets();
  const selectionCleanup = setInterval(() => { store.pruneSelections(); claudeTickets.prune(); }, 60000);
  selectionCleanup.unref();
  let timer: NodeJS.Timeout | undefined;
  let closing: Promise<void> | undefined;
  let shuttingDown = false;
  const http = createServer((req, res) => { void handle(req, res).catch(error => {
    json(res, error instanceof ServiceError ? 400 : 500, { code: error instanceof ServiceError ? error.code : 'SERVICE_ERROR', error: error instanceof Error ? error.message : '服务操作失败', ...(error instanceof ServiceError && error.current !== undefined ? { current: error.current } : {}) });
  }); });
  const armIdle = () => {
    clearTimeout(timer);
    if (connections.size === 0 && !shuttingDown) timer = setTimeout(() => { void close(); }, idleMs);
  };
  const disconnect = (id: string) => {
    const connection = connections.get(id);
    if (!connection) return;
    connections.delete(id); connection.bindings.clear(); connection.response.end(); armIdle();
  };
  async function close(): Promise<void> {
    if (closing) return closing;
    shuttingDown = true;
    closing = (async () => {
      clearTimeout(timer);
      clearInterval(selectionCleanup);
      for (const id of connections.keys()) disconnect(id);
      http.closeAllConnections();
      await new Promise<void>(resolve => http.close(() => resolve()));
      try {
        const current = JSON.parse(await readFile(join(directory, 'service.json'), 'utf8'));
        if (current.serviceId === descriptor.serviceId) await rm(join(directory, 'service.json'));
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      finally { store.close(); lock.close(); }
    })();
    return closing;
  }
  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', descriptor.origin);
    if (req.headers.host !== new URL(descriptor.origin).host || req.headers.origin) { json(res, 403, { code: 'ORIGIN_DENIED', error: '服务接口不接受网页来源' }); return; }
    if (req.headers.authorization !== `Bearer ${descriptor.secret}`) { json(res, 401, { code: 'AUTH_FAILED', error: '服务凭据不匹配' }); return; }
    if (req.headers['x-amoji-service'] !== descriptor.serviceId) fail('SERVICE_IDENTITY_MISMATCH', '服务身份与发现文件不一致');
    if (req.method === 'GET' && url.pathname === '/health') {
      const min = Number(req.headers['x-amoji-api-min']); const max = Number(req.headers['x-amoji-api-max']);
      if (!Number.isInteger(min) || !Number.isInteger(max) || min > API_VERSION || max < API_VERSION) fail('API_INCOMPATIBLE', '客户端和服务 API 不兼容，请升级；不会降级数据库');
      const { secret: _, origin: __, ...identity } = descriptor;
      json(res, 200, identity); return;
    }
    if (req.method === 'GET' && url.pathname === '/connect') {
      const id = randomBytes(24).toString('base64url');
      clearTimeout(timer);
      connections.set(id, { response: res, bindings: new Map() });
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' });
      res.write(`${JSON.stringify({ connectionId: id })}\n`);
      res.once('close', () => disconnect(id)); return;
    }
    if (req.method === 'POST' && ['/packs/import', '/packs/export'].includes(url.pathname)) {
      if (!connections.has(String(req.headers['x-amoji-connection'] ?? ''))) fail('CONNECTION_CLOSED', '适配器连接已失效');
      if (url.pathname === '/packs/import') {
        if (req.headers['content-type'] !== 'application/zip') fail('INVALID_ARGUMENT', '需要 ZIP 文件');
        json(res, 200, { result: await store.importPack(req) });
      } else {
        const args = object(await readJson(req), ['refs', 'name']);
        if (!Array.isArray(args.refs) || args.refs.length > 200) fail('INVALID_ARGUMENT', '需要有界确定版本列表');
        const bytes = await store.exportPack(args.refs.map(expressionRef), nonempty(args.name));
        res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': bytes.length, 'Cache-Control': 'no-store', 'Content-Disposition': 'attachment; filename="expressions.amoji"' }); res.end(bytes);
      }
      return;
    }
    if (req.method !== 'POST' || !['/rpc', '/stop'].includes(url.pathname)) { json(res, 404, { code: 'NOT_FOUND', error: '接口不存在' }); return; }
    const body = await readJson(req);
    if (url.pathname === '/stop') {
      const args = object(body, ['serviceId']);
      if (args.serviceId !== descriptor.serviceId) fail('SERVICE_IDENTITY_MISMATCH', '拒绝停止其他实例');
      if (connections.size > 0) fail('SERVICE_BUSY', '仍有客户端连接，不能停止共享服务');
      json(res, 200, { ok: true }); setImmediate(() => { void close(); }); return;
    }
    const connectionId = String(req.headers['x-amoji-connection'] ?? '');
    const connection = connections.get(connectionId);
    if (!connection) fail('CONNECTION_CLOSED', '适配器连接已失效，请重新连接');
    const envelope = object(body, ['method', 'params']);
    const method = nonempty(envelope.method);
    const value = envelope.params;
    const context = (args: Record<string, unknown>): BindingContext => connection.bindings.get(nonempty(args.binding)) ?? fail('BINDING_UNAVAILABLE', '当前连接没有此绑定');
    let result: unknown;
    switch (method) {
      case 'issueClaudeTicket': result = claudeTickets.issue(value); break;
      case 'redeemClaudeTicket': result = claudeTickets.redeem(value); break;
      case 'close': object(value, []); json(res, 200, { result: null }); disconnect(connectionId); return;
      case 'bind': {
        const c = bindingContext(value); const id = randomUUID(); connection.bindings.set(id, c); result = id; break;
      }
      case 'unbind': {
        const args = object(value, ['binding']); connection.bindings.delete(nonempty(args.binding)); result = null; break;
      }
      case 'listRevisions': { const args = object(value, ['asset_id']); result = store.listRevisions(nonempty(args.asset_id)); break; }
      case 'listEntries': object(value, []); result = store.listEntries(); break;
      case 'getEntry': { const args = object(value, ['asset_id']); result = store.getEntry(nonempty(args.asset_id)); break; }
      case 'startRevisionDraft': { const args = object(value, ['ref', 'version']); result = store.startRevisionDraft(expressionRef(args.ref), draftVersion(args.version)); break; }
      case 'setArchived': { const args = object(value, ['asset_id', 'version', 'archived']); result = store.setArchived(nonempty(args.asset_id), draftVersion(args.version), args.archived as boolean); break; }
      case 'selectRevision': { const args = object(value, ['ref', 'version']); result = store.selectRevision(expressionRef(args.ref), draftVersion(args.version)); break; }
      case 'getSettings': object(value, []); result = store.getSettings(); break;
      case 'updateSettings': { const args = object(value, ['version', 'preferences']); result = store.updateSettings(draftVersion(args.version), args.preferences); break; }
      case 'createDraft': object(value, []); result = store.createDraft(); break;
      case 'listDrafts': object(value, []); result = store.listDrafts(); break;
      case 'getDraft': { const args = object(value, ['draft_id']); result = store.getDraft(nonempty(args.draft_id)); break; }
      case 'saveDraft': { const args = object(value, ['draft_id', 'version', 'fields', 'upload'], ['draft_id', 'version', 'fields']); result = await store.saveDraft(nonempty(args.draft_id), draftVersion(args.version), args.fields, args.upload as string | undefined); break; }
      case 'previewDraft':
      case 'confirmDraft': { const args = object(value, ['draft_id', 'version']); result = await store[method](nonempty(args.draft_id), draftVersion(args.version)); break; }
      case 'suggestText': { const args = object(value, ['intent', 'notes'], ['intent']); result = suggestText(args.intent, args.notes); break; }
      case 'list': object(value, []); result = store.list(); break;
      case 'resolve': { const args = object(value, ['asset_id', 'revision_id']); result = store.resolve({ asset_id: nonempty(args.asset_id), revision_id: nonempty(args.revision_id) }); break; }
      case 'blobPath': { const args = object(value, ['digest']); result = await store.blobPath(nonempty(args.digest)); break; }
      case 'search': { const args = object(value, ['binding', 'query', 'limit'], ['binding', 'query']); result = store.search(context(args), nonempty(args.query), args.limit === undefined ? 3 : Number(args.limit)); break; }
      case 'emit': { const args = object(value, ['binding', 'selection_token']); result = store.emit(context(args), nonempty(args.selection_token)); break; }
      case 'history': { const args = object(value, ['binding']); result = store.history(context(args)); break; }
      case 'receive': {
        const args = object(value, ['binding', 'ref', 'send_request_id']); const ref = object(args.ref, ['asset_id', 'revision_id']);
        result = store.receive(context(args), { asset_id: nonempty(ref.asset_id), revision_id: nonempty(ref.revision_id) }, nonempty(args.send_request_id)); break;
      }
      case 'dshAccepted': {
        const args = object(value, ['binding', 'message_id']);
        store.dshAccepted(context(args), nonempty(args.message_id)); result = null; break;
      }
      case 'presentation': {
        const args = object(value, ['binding', 'message_id', 'presentation']);
        if (args.presentation !== 'rendered' && args.presentation !== 'fallback') fail('INVALID_ARGUMENT', '无效展示回执');
        store.presentation(context(args), nonempty(args.message_id), args.presentation); result = null; break;
      }
      default: fail('INVALID_ARGUMENT', '未知服务方法');
    }
    json(res, 200, { result });
  }
  try {
    await new Promise<void>((resolve, reject) => { http.once('error', reject); http.listen(0, '127.0.0.1', resolve); });
    const address = http.address();
    if (!address || typeof address === 'string') throw new Error('服务未监听');
    descriptor.origin = `http://127.0.0.1:${address.port}`;
    const temporary = join(directory, `service-${descriptor.serviceId}.tmp`);
    await writeFile(temporary, JSON.stringify(descriptor), { mode: 0o600 });
    await rename(temporary, join(directory, 'service.json'));
    armIdle(); return { close };
  } catch (error) { await close(); throw error; }
}
function json(res: ServerResponse, status: number, value: unknown): void {
  if (res.writableEnded || res.destroyed) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value));
}
async function readJson(req: IncomingMessage): Promise<unknown> {
  if (!req.headers['content-type']?.startsWith('application/json')) fail('INVALID_ARGUMENT', '需要 JSON');
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 14 * 1024 * 1024) fail('REQUEST_TOO_LARGE', '请求过大'); chunks.push(Buffer.from(chunk)); }
  const raw = Buffer.concat(chunks).toString('utf8');
  try { return JSON.parse(raw); } catch { fail('INVALID_ARGUMENT', '无效 JSON'); }
}
