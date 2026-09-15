import { spawn } from 'node:child_process';
import { mkdir, readFile, realpath, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { API_VERSION, ServiceError, dataDirectory, fail, type ApiRange, type BindingContext, type ServiceDescriptor, type ServiceIdentity } from './shared-contract.js';
import type { Expression, ExpressionRef } from './sample-catalog.js';
import type { Candidate, SampleMessage } from './sample-runtime.js';

interface ConnectOptions { directory?: string; apiRange?: ApiRange }

/** Public adapter boundary. Only trusted adapter code may supply bind context. */
export class SharedClient {
  private readonly lease = new AbortController();
  private readonly disconnected = new AbortController();
  get signal(): AbortSignal { return this.disconnected.signal; }
  private connectionId = '';
  private closed = false;
  private constructor(private readonly descriptor: ServiceDescriptor, readonly identity: ServiceIdentity) {}

  static async connect(options: ConnectOptions = {}): Promise<SharedClient> {
    let directory = resolve(options.directory ?? dataDirectory());
    await mkdir(directory, { recursive: true, mode: 0o700 });
    directory = await realpath(directory);
    const range = options.apiRange ?? { min: API_VERSION, max: API_VERSION };
    const descriptor = await discover(directory, range);
    const identity = await health(descriptor, range);
    const client = new SharedClient(descriptor, identity);
    const response = await fetch(`${descriptor.origin}/connect`, { headers: headers(descriptor), signal: client.lease.signal });
    if (!response.ok || !response.body) { await decoded(response); fail('CONNECTION_FAILED', '无法建立服务连接'); }
    const reader = response.body.getReader();
    let raw = '';
    const deadline = setTimeout(() => client.lease.abort(), 3000);
    try {
      while (!raw.includes('\n')) {
        const value = await reader.read();
        if (value.done) fail('CONNECTION_CLOSED', '服务在握手期间断开');
        raw += new TextDecoder().decode(value.value);
      }
      const hello = JSON.parse(raw.split('\n')[0]!);
      if (typeof hello.connectionId !== 'string' || !hello.connectionId) fail('HANDSHAKE_INVALID', '服务未返回连接身份');
      client.connectionId = hello.connectionId;
      void (async () => { try { while (!(await reader.read()).done) {} } catch {} finally { client.closed = true; client.disconnected.abort(); } })();
    } catch (error) { client.lease.abort(); throw error; }
    finally { clearTimeout(deadline); }
    return client;
  }
  private async call<T>(method: string, params: unknown): Promise<T> {
    if (this.closed) fail('CONNECTION_CLOSED', '服务连接已关闭，请重新连接');
    const response = await fetch(`${this.descriptor.origin}/rpc`, { method: 'POST', headers: { ...headers(this.descriptor), 'Content-Type': 'application/json', 'x-amoji-connection': this.connectionId }, body: JSON.stringify({ method, params }), signal: AbortSignal.timeout(5000) });
    return (await decoded(response)).result as T;
  }
  bind(context: BindingContext): Promise<string> { return this.call('bind', context); }
  unbind(binding: string): Promise<void> { return this.call('unbind', { binding }); }
  list(): Promise<Expression[]> { return this.call('list', {}); }
  resolve(ref: ExpressionRef): Promise<Expression> { return this.call('resolve', ref); }
  blobPath(digest: string): Promise<string> { return this.call('blobPath', { digest }); }
  search(binding: string, query: string, limit?: number): Promise<{ candidates: Candidate[]; policy: string }> { return this.call('search', { binding, query, ...(limit === undefined ? {} : { limit }) }); }
  emit(binding: string, token: string): Promise<SampleMessage> { return this.call('emit', { binding, selection_token: token }); }
  receive(binding: string, ref: ExpressionRef, requestId: string): Promise<SampleMessage> { return this.call('receive', { binding, ref, send_request_id: requestId }); }
  history(binding: string): Promise<SampleMessage[]> { return this.call('history', { binding }); }
  presentation(binding: string, messageId: string, presentation: 'rendered' | 'fallback'): Promise<void> { return this.call('presentation', { binding, message_id: messageId, presentation }); }
  async close(): Promise<void> {
    if (this.closed) { this.lease.abort(); this.disconnected.abort(); return; }
    try { await this.call('close', {}); } finally { this.closed = true; this.lease.abort(); this.disconnected.abort(); }
  }
}

/** Administrative stop: refuses other identities/active adapters; never terminates a PID. */
export async function stopSharedService(directory: string, serviceId: string): Promise<void> {
  directory = await realpath(directory);
  const descriptor = await readDescriptor(directory);
  if (!descriptor) return;
  if (descriptor.serviceId !== serviceId) fail('SERVICE_IDENTITY_MISMATCH', '拒绝停止其他实例');
  await health(descriptor, { min: 1, max: API_VERSION });
  await decoded(await fetch(`${descriptor.origin}/stop`, { method: 'POST', headers: { ...headers(descriptor), 'Content-Type': 'application/json' }, body: JSON.stringify({ serviceId }), signal: AbortSignal.timeout(3000) }));
  for (let i = 0; i < 100; i++) {
    const current = await readDescriptor(directory);
    // Discovery disappears before SQLite closes; process exit proves its kernel lock is released.
    if ((!current || current.serviceId !== serviceId) && !processAlive(descriptor.pid)) return;
    await delay(20);
  }
  fail('SERVICE_STOP_TIMEOUT', '服务没有按时退出');
}
function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; throw error; }
}
function headers(descriptor: ServiceDescriptor): Record<string, string> { return { Authorization: `Bearer ${descriptor.secret}`, 'x-amoji-service': descriptor.serviceId }; }
async function decoded(response: Response): Promise<any> {
  let value: any;
  try { value = await response.json(); } catch { fail('HANDSHAKE_INVALID', '服务未返回有效 JSON'); }
  if (!response.ok) throw new ServiceError(typeof value.code === 'string' ? value.code : 'SERVICE_ERROR', typeof value.error === 'string' ? value.error : '服务请求失败');
  return value;
}
async function health(descriptor: ServiceDescriptor, range: ApiRange): Promise<ServiceIdentity> {
  const identity = await decoded(await fetch(`${descriptor.origin}/health`, { headers: { ...headers(descriptor), 'x-amoji-api-min': String(range.min), 'x-amoji-api-max': String(range.max) }, signal: AbortSignal.timeout(1000) }));
  if (identity.serviceId !== descriptor.serviceId || identity.dataRoot !== descriptor.dataRoot || identity.pid !== descriptor.pid) fail('SERVICE_IDENTITY_MISMATCH', '健康响应与发现身份不一致');
  if (identity.apiVersion < range.min || identity.apiVersion > range.max) fail('API_INCOMPATIBLE', '服务 API 不在客户端接受范围');
  return identity;
}
async function readDescriptor(directory: string): Promise<ServiceDescriptor | undefined> {
  const path = join(directory, 'service.json');
  try {
    const metadata = await stat(path);
    if ((metadata.mode & 0o077) !== 0 || (process.getuid && metadata.uid !== process.getuid())) fail('DISCOVERY_UNSAFE', '发现凭据必须由当前用户以 0600 保存');
    const d = JSON.parse(await readFile(path, 'utf8')) as ServiceDescriptor;
    const url = new URL(d.origin);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.pathname !== '/' || url.search || url.hash || url.username || url.password || d.dataRoot !== directory || typeof d.secret !== 'string' || !d.secret || typeof d.serviceId !== 'string' || !Number.isInteger(d.pid) || d.pid < 1) fail('DISCOVERY_INVALID', '发现文件不合法');
    return d;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    if (error instanceof ServiceError) throw error;
    fail('DISCOVERY_INVALID', '发现文件无法解析');
  }
}
async function discover(directory: string, range: ApiRange): Promise<ServiceDescriptor> {
  const current = await readDescriptor(directory);
  if (current) {
    try { await health(current, range); return current; }
    catch (error) {
      if (error instanceof ServiceError) throw error;
      // Liveness is only a conservative stale-record check. Health still requires a handshake.
      try { process.kill(current.pid, 0); fail('SERVICE_UNAVAILABLE', '发现的进程仍在运行但健康握手失败；不会覆盖或终止它'); }
      catch (probe) { if ((probe as NodeJS.ErrnoException).code !== 'ESRCH') throw probe; }
    }
  }
  const source = import.meta.url.endsWith('.ts');
  const entry = fileURLToPath(new URL(source ? './service-main.ts' : './service-main.js', import.meta.url));
  const launch = () => {
    const child = spawn(process.execPath, [...(source ? ['--import', 'tsx'] : []), entry], { env: { ...process.env, AMOJI_DATA_DIR: directory }, detached: true, stdio: ['ignore', 'ignore', 'pipe'] });
    const attempt: { child: typeof child; failure: string; exited: number | null } = { child, failure: '', exited: null };
    child.stderr.on('data', chunk => { attempt.failure = (attempt.failure + chunk.toString()).slice(-4096); });
    child.once('error', error => { attempt.failure = error.message; attempt.exited = 1; });
    child.once('exit', code => { attempt.exited = code; });
    child.unref(); return attempt;
  };
  let attempt = launch();
  const deadline = performance.now() + 8000;
  try {
    while (performance.now() < deadline) {
      const candidate = await readDescriptor(directory);
      if (candidate && candidate.serviceId !== current?.serviceId) {
        await health(candidate, range); return candidate;
      }
      if (attempt.exited === 75) {
        // A competing candidate may also have lost or exited before publishing discovery.
        attempt.child.stderr.destroy();
        await delay(25 + Math.floor(Math.random() * 75));
        attempt = launch();
      } else if (attempt.exited !== null && attempt.exited !== 0) fail('SERVICE_START_FAILED', attempt.failure.trim() || '服务无法启动');
      await delay(50);
    }
    fail('SERVICE_START_TIMEOUT', '写入服务没有完成健康握手');
  } finally { attempt.child.stderr.destroy(); }
}
