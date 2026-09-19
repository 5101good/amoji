import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { CREATE_DRAFT_CAPABILITY, TEXT_SUGGESTION_CAPABILITY, type BindingContext as HostContext } from './shared-contract.js';
import type { Expression, ExpressionRef } from './sample-catalog.js';
import type { Candidate, SampleMessage } from './sample-runtime.js';
import type { SharedClient } from './shared-client.js';

type Awaitable<T> = T | Promise<T>;
/** Host presentation boundary; supports the ticket-01 fixtures and the shared client. */
export interface AdapterRuntime {
  connectionSignal?: AbortSignal;
  creation?: Pick<SharedClient, 'createDraft' | 'getDraft' | 'listDrafts' | 'saveDraft' | 'previewDraft' | 'confirmDraft'>;
  suggestions?: Pick<SharedClient, 'suggestText'>;
  catalog: { root: URL; all(): Awaitable<Expression[]>; resolve(ref: ExpressionRef): Awaitable<Expression> };
  search(context: HostContext, query: string, limit?: number): Awaitable<{ candidates: Candidate[]; policy: string }>;
  emit(context: HostContext, token: string): Awaitable<SampleMessage>;
  messages(context: HostContext): Awaitable<SampleMessage[]>;
  receive(context: HostContext, ref: ExpressionRef, requestId: string): Awaitable<SampleMessage>;
  dshAccepted?(context: HostContext, messageId: string): Awaitable<void>;
  acknowledge(context: HostContext, messageId: string, state: 'rendered' | 'fallback'): Awaitable<void>;
  blobPath?(digest: string): Promise<string>;
  readBlob?(digest: string): Promise<Buffer>;
}

/** Host adapters translate trusted context; all library writes remain in the service. */
export class ConnectedRuntime implements AdapterRuntime {
  readonly catalog;
  readonly connectionSignal;
  readonly creation;
  readonly suggestions;
  constructor(private readonly client: SharedClient) {
    this.connectionSignal = client.signal;
    this.creation = client.identity.capabilities?.includes(CREATE_DRAFT_CAPABILITY) ? client : undefined;
    this.suggestions = client.identity.capabilities?.includes(TEXT_SUGGESTION_CAPABILITY) ? client : undefined;
    this.catalog = { root: pathToFileURL(`${client.identity.dataRoot}/`), all: () => client.list(), resolve: (ref: ExpressionRef) => client.resolve(ref) };
  }
  private async withBinding<T>(context: HostContext, operation: (binding: string) => Promise<T>): Promise<T> {
    const binding = await this.client.bind({ ...context, hostInstanceId: context.hostInstanceId ?? 'local' });
    try { return await operation(binding); }
    finally { if (!this.client.signal.aborted) await this.client.unbind(binding); }
  }
  search(context: HostContext, query: string, limit?: number) { return this.withBinding(context, binding => this.client.search(binding, query, limit)); }
  emit(context: HostContext, token: string) { return this.withBinding(context, binding => this.client.emit(binding, token)); }
  messages(context: HostContext) { return this.withBinding(context, binding => this.client.history(binding)); }
  receive(context: HostContext, ref: ExpressionRef, requestId: string) { return this.withBinding(context, binding => this.client.receive(binding, ref, requestId)); }
  acknowledge(context: HostContext, messageId: string, state: 'rendered' | 'fallback') { return this.withBinding(context, binding => this.client.presentation(binding, messageId, state)); }
  dshAccepted(context: HostContext, messageId: string) { return this.withBinding(context, binding => this.client.dshAccepted(binding, messageId)); }
  blobPath(digest: string) { return this.client.blobPath(digest); }
  async readBlob(digest: string) { return readFile(await this.client.blobPath(digest)); }
}
