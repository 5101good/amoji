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
  private readonly bindings = new Map<string, Promise<string>>();
  readonly catalog;
  readonly connectionSignal;
  constructor(private readonly client: SharedClient) {
    this.connectionSignal = client.signal;
    this.catalog = { root: pathToFileURL(`${client.identity.dataRoot}/`), all: () => client.list(), resolve: (ref: ExpressionRef) => client.resolve(ref) };
  }
  private binding(context: HostContext): Promise<string> {
    const key = JSON.stringify(context);
    let binding = this.bindings.get(key);
    if (!binding) {
      binding = this.client.bind({ ...context, hostInstanceId: 'local' });
      this.bindings.set(key, binding);
      void binding.catch(() => this.bindings.delete(key));
    }
    return binding;
  }
  async search(context: HostContext, query: string, limit?: number) { return this.client.search(await this.binding(context), query, limit); }
  async emit(context: HostContext, token: string) { return this.client.emit(await this.binding(context), token); }
  async messages(context: HostContext) { return this.client.history(await this.binding(context)); }
  async receive(context: HostContext, ref: ExpressionRef, requestId: string) { return this.client.receive(await this.binding(context), ref, requestId); }
  async acknowledge(context: HostContext, messageId: string, state: 'rendered' | 'fallback') { return this.client.presentation(await this.binding(context), messageId, state); }
  blobPath(digest: string) { return this.client.blobPath(digest); }
  async readBlob(digest: string) { return readFile(await this.client.blobPath(digest)); }
}
