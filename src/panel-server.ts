import { createServer, type ServerResponse, type IncomingMessage, type Server as HttpServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { ServiceError, object, nonempty, sessionKey, type BindingContext as HostContext } from './shared-contract.js';
import type { SampleMessage } from './sample-runtime.js';
import type { AdapterRuntime } from './adapter-runtime.js';
import { searchExpressions } from './search.js';

import { draftVersion, type DraftFields } from './drafts.js';

interface PendingPick { id: string; finish: (result: SampleMessage | Error) => void }
interface PanelSession { context: HostContext; capability: string; pending?: PendingPick; completed: Map<string, { message_id: string; asset_id: string; revision_id: string }> }

export class PanelServer {
  private readonly sessions = new Map<string, PanelSession>();
  private readonly http: HttpServer;
  private origin = '';
  private closed = false;
  private readonly connectionClosed = () => { void this.close(); };
  private constructor(private readonly runtime: AdapterRuntime, private readonly open: (url: string) => Promise<void>, private readonly webRoot: URL) {
    this.http = createServer((req, res) => { void this.handle(req, res).catch(() => this.json(res, 500, { error: '面板操作失败' })); });
  }

  static async start(runtime: AdapterRuntime, open: (url: string) => Promise<void>, webRoot = new URL(import.meta.url.endsWith('.ts') ? '../web/' : '../../web/', import.meta.url)): Promise<PanelServer> {
    const panel = new PanelServer(runtime, open, webRoot);
    await new Promise<void>((resolve, reject) => { panel.http.once('error', reject); panel.http.listen(0, '127.0.0.1', resolve); });
    const address = panel.http.address();
    if (!address || typeof address === 'string') throw new Error('面板启动失败');
    panel.origin = `http://127.0.0.1:${address.port}`;
    if (runtime.connectionSignal?.aborted) { await panel.close(); throw new Error('共享服务连接已关闭'); }
    runtime.connectionSignal?.addEventListener('abort', panel.connectionClosed, { once: true });
    return panel;
  }

  url(context: HostContext): string {
    const key = sessionKey(context);
    let session = this.sessions.get(key);
    if (!session) {
      session = { context: { ...context }, capability: randomBytes(32).toString('base64url'), completed: new Map() };
      this.sessions.set(key, session);
    }
    if (!session.pending) session.context = { ...context };
    return `${this.origin}/#${session.capability}`;
  }

  async show(context: HostContext): Promise<string> {
    const url = this.url(context);
    await this.open(url);
    return url;
  }

  pick(context: HostContext, signal: AbortSignal): Promise<SampleMessage> {
    const url = this.url(context);
    const session = this.sessions.get(sessionKey(context))!;
    if (session.pending) return Promise.reject(new Error('该会话已有待选请求'));
    if (signal.aborted) return Promise.reject(new Error('选择已取消'));
    session.context = { ...context };
    return new Promise((resolve, reject) => {
      const pending: PendingPick = { id: randomUUID(), finish: result => {
        clearTimeout(timer);
        signal.removeEventListener('abort', cancel);
        if (session.pending !== pending) return;
        session.pending = undefined;
        if (result instanceof Error) reject(result); else resolve(result);
      } };
      const cancel = () => pending.finish(new Error('选择已取消或超时'));
      const timer = setTimeout(cancel, 300000);
      session.pending = pending;
      signal.addEventListener('abort', cancel, { once: true });
      void this.open(url).catch(error => pending.finish(error instanceof Error ? error : new Error('打开浏览器失败')));
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.runtime.connectionSignal?.removeEventListener('abort', this.connectionClosed);
    for (const session of this.sessions.values()) {
      session.pending?.finish(new Error('连接已关闭'));
    }
    this.http.closeAllConnections();
    await new Promise<void>((resolve, reject) => this.http.close(error => error ? reject(error) : resolve()));
  }

  private json(res: ServerResponse, status: number, value: unknown): void {
    if (res.writableEnded) return;
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(value));
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', this.origin);
    if (req.headers.host !== new URL(this.origin).host || (req.headers.origin && req.headers.origin !== this.origin)) { this.json(res, 403, { error: '来源不匹配' }); return; }
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' blob:; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (req.method === 'GET' && ['/', '/panel.js', '/panel.css'].includes(url.pathname)) {
      const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      const content = await readFile(new URL(name, this.webRoot));
      res.writeHead(200, { 'Content-Type': name.endsWith('.html') ? 'text/html; charset=utf-8' : name.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8' });
      res.end(content); return;
    }
    const token = req.headers.authorization?.replace(/^Bearer /, '');
    const session = [...this.sessions.values()].find(s => s.capability === token);
    if (!session) { this.json(res, 401, { error: '请从当前宿主会话重新打开选择器' }); return; }
    if (req.method === 'GET' && url.pathname === '/api/state') {
      this.json(res, 200, { host: session.context.host, session_id: session.context.sessionId, turn_id: session.context.turnId, pending_pick: session.pending?.id ?? null, creation_available: !!this.runtime.creation, expressions: await this.runtime.catalog.all(), messages: await this.runtime.messages(session.context) }); return;
    }
    if (req.method === 'GET' && url.pathname === '/api/drafts') {
      this.json(res, 200, { drafts: this.runtime.creation ? await this.runtime.creation.listDrafts() : [] }); return;
    }
    if (req.method === 'GET' && url.pathname === '/api/search') {
      try {
        const limit = url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : 3;
        this.json(res, 200, { expressions: searchExpressions(await this.runtime.catalog.all(), url.searchParams.get('query') ?? '', limit) });
      } catch (error) { this.json(res, 400, { error: error instanceof Error ? error.message : '搜索参数不合法' }); }
      return;
    }
    if (req.method === 'GET' && /^\/blobs\/[a-f0-9]{64}$/.test(url.pathname)) {
      const digest = url.pathname.slice('/blobs/'.length);
      const visible = [...await this.runtime.catalog.all(), ...(await this.runtime.messages(session.context)).map(m => m.revision)];
      const drafts = this.runtime.creation ? await this.runtime.creation.listDrafts() : [];
      const blob = [...visible.flatMap(e => [e.visual.primary, e.visual.poster]), ...drafts.flatMap(d => [d.visual?.primary, d.visual?.poster])].find(b => b?.sha256 === digest);
      if (!blob) { this.json(res, 404, { error: '素材不存在' }); return; }
      try {
        const bytes = this.runtime.readBlob ? await this.runtime.readBlob(digest) : await readFile(new URL(`blobs/${digest}`, this.runtime.catalog.root));
        res.writeHead(200, { 'Content-Type': blob.mime, 'Cache-Control': 'private, max-age=3600' }); res.end(bytes);
      } catch (error) {
        const code = error instanceof ServiceError ? error.code : (error as NodeJS.ErrnoException)?.code === 'ENOENT' ? 'BLOB_MISSING' : 'BLOB_UNAVAILABLE';
        const status = code === 'BLOB_MISSING' ? 404 : code === 'BLOB_INTEGRITY_FAILED' ? 422 : 500;
        this.json(res, status, { error: error instanceof Error ? error.message : `${code}：素材不可用` });
      }
      return;
    }
    if (req.method !== 'POST' || !['/api/select', '/api/ack', '/api/cancel', '/api/draft/create', '/api/draft/get', '/api/draft/save', '/api/draft/preview', '/api/draft/confirm'].includes(url.pathname)) { this.json(res, 404, { error: '接口不存在' }); return; }
    if (!req.headers['content-type']?.startsWith('application/json')) { this.json(res, 415, { error: '需要 JSON' }); return; }
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > (url.pathname === '/api/draft/save' ? 14 * 1024 * 1024 : 4096)) { this.json(res, 413, { error: '请求太大' }); return; } chunks.push(Buffer.from(chunk)); }
    const raw = Buffer.concat(chunks).toString('utf8');
    let body: Record<string, unknown>;
    try { body = JSON.parse(raw); if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error(); } catch { this.json(res, 400, { error: '无效 JSON' }); return; }
    if (url.pathname.startsWith('/api/draft/')) {
      try {
        const creation = this.runtime.creation;
        if (!creation) throw new Error('CAPABILITY_UNAVAILABLE：当前服务不支持手工创建，请更新服务');
        let result: unknown;
        switch (url.pathname) {
          case '/api/draft/create': object(body, []); result = await creation.createDraft(); break;
          case '/api/draft/get': { const args = object(body, ['draft_id']); result = await creation.getDraft(nonempty(args.draft_id)); break; }
          case '/api/draft/save': { const args = object(body, ['draft_id', 'version', 'fields', 'upload'], ['draft_id', 'version', 'fields']); result = await creation.saveDraft(nonempty(args.draft_id), draftVersion(args.version), args.fields as DraftFields, args.upload as string | undefined); break; }
          default: { const args = object(body, ['draft_id', 'version']); result = await creation[url.pathname.endsWith('/confirm') ? 'confirmDraft' : 'previewDraft'](nonempty(args.draft_id), draftVersion(args.version)); }
        }
        this.json(res, 200, result);
      } catch (error) { this.json(res, 400, { error: error instanceof Error ? error.message : '草稿操作失败' }); }
      return;
    }
    if (url.pathname === '/api/ack') {
      if (typeof body.message_id !== 'string' || !['rendered', 'fallback'].includes(String(body.presentation))) { this.json(res, 400, { error: '无效回执' }); return; }
      try { await this.runtime.acknowledge(session.context, body.message_id, body.presentation as 'rendered' | 'fallback'); this.json(res, 200, { ok: true }); }
      catch { this.json(res, 404, { error: '当前会话不存在此消息' }); }
      return;
    }
    if (url.pathname === '/api/select') {
      if (typeof body.pick_id !== 'string' || typeof body.asset_id !== 'string' || typeof body.revision_id !== 'string' || Object.keys(body).some(k => !['pick_id', 'asset_id', 'revision_id'].includes(k))) { this.json(res, 400, { error: '只能选择固定版本，不能覆盖语义' }); return; }
      const completed = session.completed.get(body.pick_id);
      if (completed) {
        if (completed.asset_id !== body.asset_id || completed.revision_id !== body.revision_id) { this.json(res, 409, { error: '该请求已用于其他表情' }); return; }
        this.json(res, 200, { message_id: completed.message_id }); return;
      }
    }
    const pending = session.pending;
    if (!pending || body.pick_id !== pending.id) { this.json(res, 409, { error: '选择请求已结束或不属于当前会话' }); return; }
    if (url.pathname === '/api/cancel') {
      pending.finish(new Error('用户取消选择')); this.json(res, 200, { ok: true }); return;
    }
    if (typeof body.asset_id !== 'string' || typeof body.revision_id !== 'string' || Object.keys(body).some(k => !['pick_id', 'asset_id', 'revision_id'].includes(k))) { this.json(res, 400, { error: '只能选择固定版本，不能覆盖语义' }); return; }
    try {
      const message = await this.runtime.receive(session.context, { asset_id: body.asset_id, revision_id: body.revision_id }, pending.id);
      session.completed.set(pending.id, { message_id: message.message_id, asset_id: body.asset_id, revision_id: body.revision_id });
      pending.finish(message);
      this.json(res, 200, { message_id: message.message_id });
    } catch (error) { this.json(res, 400, { error: error instanceof Error ? error.message : '选择失败' }); }
  }
}
