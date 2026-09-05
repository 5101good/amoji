import { createServer, type ServerResponse, type IncomingMessage, type Server as HttpServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { HostContext } from './codex-context.js';
import type { SampleRuntime, SampleMessage } from './sample-runtime.js';

interface PendingPick { id: string; resolve: (message: SampleMessage) => void; reject: (error: Error) => void; cleanup: () => void }
interface PanelSession { context: HostContext; capability: string; pending?: PendingPick }

export class PanelServer {
  private readonly sessions = new Map<string, PanelSession>();
  private readonly http: HttpServer;
  private origin = '';
  private closed = false;
  private constructor(private readonly runtime: SampleRuntime, private readonly open: (url: string) => Promise<void>, private readonly webRoot: URL) {
    this.http = createServer((req, res) => { void this.handle(req, res).catch(() => this.json(res, 500, { error: '面板操作失败' })); });
  }

  static async start(runtime: SampleRuntime, open: (url: string) => Promise<void>, webRoot = new URL('../../web/', import.meta.url)): Promise<PanelServer> {
    const panel = new PanelServer(runtime, open, webRoot);
    await new Promise<void>((resolve, reject) => { panel.http.once('error', reject); panel.http.listen(0, '127.0.0.1', resolve); });
    const address = panel.http.address();
    if (!address || typeof address === 'string') throw new Error('面板启动失败');
    panel.origin = `http://127.0.0.1:${address.port}`;
    return panel;
  }

  url(context: HostContext): string {
    const key = `${context.host}:${context.sessionId}`;
    let session = this.sessions.get(key);
    if (!session) {
      session = { context: { ...context }, capability: randomBytes(32).toString('base64url') };
      this.sessions.set(key, session);
    }
    return `${this.origin}/#${session.capability}`;
  }

  pick(context: HostContext, signal: AbortSignal): Promise<SampleMessage> {
    const url = this.url(context);
    const session = this.sessions.get(`${context.host}:${context.sessionId}`)!;
    if (session.pending) return Promise.reject(new Error('该会话已有待选请求'));
    if (signal.aborted) return Promise.reject(new Error('选择已取消'));
    session.context = { ...context };
    return new Promise((resolve, reject) => {
      const cancel = () => { session.pending?.cleanup(); session.pending = undefined; reject(new Error('选择已取消或超时')); };
      const timer = setTimeout(cancel, 300000);
      const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', cancel); };
      session.pending = { id: randomUUID(), resolve, reject, cleanup };
      signal.addEventListener('abort', cancel, { once: true });
      void this.open(url).catch(error => { cleanup(); session.pending = undefined; reject(error); });
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const session of this.sessions.values()) {
      session.pending?.cleanup();
      session.pending?.reject(new Error('连接已关闭'));
      session.pending = undefined;
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
    if (!session) { this.json(res, 401, { error: '请从当前 Codex 会话重新打开选择器' }); return; }
    if (req.method === 'GET' && url.pathname === '/api/state') {
      this.json(res, 200, { host: session.context.host, session_id: session.context.sessionId, turn_id: session.context.turnId, pending_pick: session.pending?.id ?? null, expressions: this.runtime.catalog.all(), messages: this.runtime.messages(session.context) }); return;
    }
    if (req.method === 'GET' && /^\/blobs\/[a-f0-9]{64}$/.test(url.pathname)) {
      const digest = url.pathname.slice('/blobs/'.length);
      const blob = this.runtime.catalog.all().flatMap(e => [e.visual.primary, e.visual.poster]).find(b => b?.sha256 === digest);
      if (!blob) { this.json(res, 404, { error: '素材不存在' }); return; }
      const bytes = await readFile(new URL(`blobs/${digest}`, this.runtime.catalog.root));
      res.writeHead(200, { 'Content-Type': blob.mime, 'Cache-Control': 'private, max-age=3600' }); res.end(bytes); return;
    }
    if (req.method !== 'POST' || !['/api/select', '/api/ack', '/api/cancel'].includes(url.pathname)) { this.json(res, 404, { error: '接口不存在' }); return; }
    if (!req.headers['content-type']?.startsWith('application/json')) { this.json(res, 415, { error: '需要 JSON' }); return; }
    let raw = '';
    for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 4096) { this.json(res, 413, { error: '请求太大' }); return; } }
    let body: Record<string, unknown>;
    try { body = JSON.parse(raw); if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error(); } catch { this.json(res, 400, { error: '无效 JSON' }); return; }
    if (url.pathname === '/api/ack') {
      if (typeof body.message_id !== 'string' || !['rendered', 'fallback'].includes(String(body.presentation))) { this.json(res, 400, { error: '无效回执' }); return; }
      try { this.runtime.acknowledge(session.context, body.message_id, body.presentation as 'rendered' | 'fallback'); this.json(res, 200, { ok: true }); }
      catch { this.json(res, 404, { error: '当前会话不存在此消息' }); }
      return;
    }
    const pending = session.pending;
    if (!pending || body.pick_id !== pending.id) { this.json(res, 409, { error: '选择请求已结束或不属于当前会话' }); return; }
    if (url.pathname === '/api/cancel') {
      pending.cleanup(); session.pending = undefined; pending.reject(new Error('用户取消选择')); this.json(res, 200, { ok: true }); return;
    }
    if (typeof body.asset_id !== 'string' || typeof body.revision_id !== 'string' || Object.keys(body).some(k => !['pick_id', 'asset_id', 'revision_id'].includes(k))) { this.json(res, 400, { error: '只能选择固定版本，不能覆盖语义' }); return; }
    try {
      const message = this.runtime.receive(session.context, { asset_id: body.asset_id, revision_id: body.revision_id }, pending.id);
      pending.cleanup(); session.pending = undefined; pending.resolve(message);
      this.json(res, 200, { message_id: message.message_id });
    } catch (error) { this.json(res, 400, { error: error instanceof Error ? error.message : '选择失败' }); }
  }
}
