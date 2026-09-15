import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import type { HostContext } from './codex-context.js';
import type { Expression, ExpressionRef } from './sample-catalog.js';
import type { Candidate, SampleMessage } from './sample-runtime.js';
import type { SharedClient } from './shared-client.js';

type Awaitable<T> = T | Promise<T>;
/** Host presentation boundary; supports the ticket-01 fixtures and the shared client. */
export interface AdapterRuntime {
  connectionSignal?: AbortSignal;
  catalog: { root: URL; all(): Awaitable<Expression[]>; resolve(ref: ExpressionRef): Awaitable<Expression> };
  search(context: HostContext, query: string, limit?: number): Awaitable<{ candidates: Candidate[]; policy: string }>;
  emit(context: HostContext, token: string): Awaitable<SampleMessage>;
  messages(context: HostContext): Awaitable<SampleMessage[]>;
  receive(context: HostContext, ref: ExpressionRef, requestId: string): Awaitable<SampleMessage>;
  acknowledge(context: HostContext, messageId: string, state: 'rendered' | 'fallback'): Awaitable<void>;
  blobPath?(digest: string): Promise<string>;
  readBlob?(digest: string): Promise<Buffer>;
}

/** Codex translates trusted metadata once; all library writes remain in the service. */
export class ConnectedRuntime implements AdapterRuntime {
  readonly catalog;
  readonly connectionSignal;
  constructor(private readonly client: SharedClient) {
    this.connectionSignal = client.signal;
    this.catalog = { root: pathToFileURL(`${client.identity.dataRoot}/`), all: () => client.list(), resolve: (ref: ExpressionRef) => client.resolve(ref) };
  }
  private async withBinding<T>(context: HostContext, operation: (binding: string) => Promise<T>): Promise<T> {
    const binding = await this.client.bind({ ...context, hostInstanceId: 'local' });
    try { return await operation(binding); }
    finally { if (!this.client.signal.aborted) await this.client.unbind(binding); }
  }
  search(context: HostContext, query: string, limit?: number) { return this.withBinding(context, binding => this.client.search(binding, query, limit)); }
  emit(context: HostContext, token: string) { return this.withBinding(context, binding => this.client.emit(binding, token)); }
  messages(context: HostContext) { return this.withBinding(context, binding => this.client.history(binding)); }
  receive(context: HostContext, ref: ExpressionRef, requestId: string) { return this.withBinding(context, binding => this.client.receive(binding, ref, requestId)); }
  acknowledge(context: HostContext, messageId: string, state: 'rendered' | 'fallback') { return this.withBinding(context, binding => this.client.presentation(binding, messageId, state)); }
  blobPath(digest: string) { return this.client.blobPath(digest); }
  async readBlob(digest: string) { return readFile(await this.client.blobPath(digest)); }
}
