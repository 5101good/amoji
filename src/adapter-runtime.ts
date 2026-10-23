import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { COLLABORATION_CAPABILITY, PACKS_CAPABILITY, VERSIONED_PACKS_CAPABILITY, CREATE_DRAFT_CAPABILITY, TEXT_SUGGESTION_CAPABILITY, LIBRARY_MANAGEMENT_CAPABILITY, type BindingContext as HostContext } from './shared-contract.js';
import type { Expression, ExpressionRef } from './protocol/index.js';
import type { EffectChoice, EffectIntent } from './effects.js';
import type { ExpressInput, ExpressResult, ReceiveInput } from './library-store.js';
import type { StoredMessage } from './messages.js';
import type { SearchResult } from './search.js';
import type { SharedClient } from './shared-client.js';
import type { RuleChoice, RuleSnapshot, RuleChange } from './conversation-rules.js';

type Awaitable<T> = T | Promise<T>;
/** Host presentation boundary over the shared service. */
export interface AdapterRuntime {
  marketplace?: Pick<SharedClient, 'marketplace'>;
  collaboration?: { choices(context: HostContext, ref: ExpressionRef): Promise<EffectChoice[]>; save(context: HostContext, messageId: string, update: Pick<EffectIntent, 'status' | 'checkpoint' | 'receipt'>): Promise<void> };
  rules?: { choices(context: HostContext): Promise<RuleChoice[]>; read(context: HostContext): Promise<RuleSnapshot>; change(context: HostContext, change: RuleChange): Promise<RuleSnapshot> };
  connectionSignal?: AbortSignal;
  reconnect?(): Promise<void>;
  creation?: Pick<SharedClient, 'createDraft' | 'getDraft' | 'listDrafts' | 'saveDraft' | 'previewDraft' | 'confirmDraft'>;
  packDrafts?: Pick<SharedClient, 'createPackDraft' | 'listPackDrafts' | 'getPackDraft' | 'savePackDraft' | 'previewPackDraft' | 'confirmPackDraft' | 'listPacks' | 'getPack' | 'exportRelease' | 'removePack'>;
  packs?: Pick<SharedClient, 'importPack' | 'exportPack' | 'selectRevision'>;
  management?: Pick<SharedClient, 'listRevisions' | 'listEntries' | 'getEntry' | 'startRevisionDraft' | 'setArchived' | 'getSettings' | 'updateSettings'>;
  suggestions?: Pick<SharedClient, 'suggestText'>;
  catalog: { root: URL; all(): Awaitable<Expression[]>; resolve(ref: ExpressionRef): Awaitable<Expression> };
  search(context: HostContext, query: string, limit?: number, locale?: string): Awaitable<SearchResult>;
  express(context: HostContext, input: ExpressInput): Awaitable<ExpressResult>;
  messages(context: HostContext): Awaitable<StoredMessage[]>;
  receive(context: HostContext, input: ReceiveInput, requestId: string): Awaitable<StoredMessage>;
  retract?(context: HostContext, messageId: string): Awaitable<StoredMessage>;
  choose?(context: HostContext, messageId: string, option: string): Awaitable<StoredMessage>;
  signalState?(context: HostContext, messageId: string, state: 'delivered_to_model' | 'promoted'): Awaitable<StoredMessage>;
  applied?(context: HostContext, messageId: string): Awaitable<StoredMessage>;
  dshAttempted?(context: HostContext, messageId: string): Awaitable<boolean>;
  dshAccepted?(context: HostContext, messageId: string): Awaitable<void>;
  acknowledge(context: HostContext, messageId: string, state: 'rendered' | 'fallback'): Awaitable<void>;
  blobPath?(digest: string): Promise<string>;
  readBlob?(digest: string): Promise<Buffer>;
}

/** Host adapters translate trusted context; all library writes remain in the service. */
export class ConnectedRuntime implements AdapterRuntime {
  readonly catalog;
  get connectionSignal() { return this.client.signal; }
  reconnect() { return this.client.reconnect(); }
  readonly creation;
  readonly suggestions;
  readonly management;
  readonly packs;
  readonly packDrafts;
  readonly marketplace;
  readonly collaboration;
  readonly rules;
  constructor(private readonly client: SharedClient) {
    const has = (capability: string) => client.identity.capabilities?.includes(capability) ?? false;
    this.marketplace = has('marketplace-v1') ? client : undefined;
    this.rules = has(COLLABORATION_CAPABILITY) ? { choices: (c: HostContext) => this.withBinding(c, b => client.ruleChoices(b)), read: (c: HostContext) => this.withBinding(c, b => client.rules(b)), change: (c: HostContext, v: RuleChange) => this.withBinding(c, b => client.changeRules(b, v)) } : undefined;
    this.collaboration = has(COLLABORATION_CAPABILITY) ? { choices: (context: HostContext, ref: ExpressionRef) => this.withBinding(context, b => client.effectChoices(b, ref)), save: (context: HostContext, messageId: string, update: Pick<EffectIntent, 'status' | 'checkpoint' | 'receipt'>) => this.withBinding(context, b => client.saveEffectIntent(b, messageId, update)) } : undefined;
    this.packDrafts = has(VERSIONED_PACKS_CAPABILITY) ? client : undefined;
    this.packs = has(PACKS_CAPABILITY) ? client : undefined;
    this.management = has(LIBRARY_MANAGEMENT_CAPABILITY) ? client : undefined;
    this.creation = has(CREATE_DRAFT_CAPABILITY) ? client : undefined;
    this.suggestions = has(TEXT_SUGGESTION_CAPABILITY) ? client : undefined;
    this.catalog = { root: pathToFileURL(`${client.identity.dataRoot}/`), all: () => client.list(), resolve: (ref: ExpressionRef) => client.resolve(ref) };
  }
  private async withBinding<T>(context: HostContext, operation: (binding: string) => Promise<T>): Promise<T> {
    const binding = await this.client.bind({ ...context, hostInstanceId: context.hostInstanceId ?? 'local' });
    try { return await operation(binding); }
    finally { if (!this.client.signal.aborted) await this.client.unbind(binding); }
  }
  search(context: HostContext, query: string, limit?: number, locale?: string) { return this.withBinding(context, binding => this.client.search(binding, query, limit, locale)); }
  express(context: HostContext, input: ExpressInput) { return this.withBinding(context, binding => this.client.express(binding, input)); }
  messages(context: HostContext) { return this.withBinding(context, binding => this.client.history(binding)); }
  receive(context: HostContext, input: ReceiveInput, requestId: string) { return this.withBinding(context, binding => this.client.receive(binding, input, requestId)); }
  retract(context: HostContext, messageId: string) { return this.withBinding(context, binding => this.client.retract(binding, messageId)); }
  choose(context: HostContext, messageId: string, option: string) { return this.withBinding(context, binding => this.client.choose(binding, messageId, option)); }
  signalState(context: HostContext, messageId: string, state: 'delivered_to_model' | 'promoted') { return this.withBinding(context, binding => this.client.signalState(binding, messageId, state)); }
  applied(context: HostContext, messageId: string) { return this.withBinding(context, binding => this.client.applied(binding, messageId)); }
  acknowledge(context: HostContext, messageId: string, state: 'rendered' | 'fallback') { return this.withBinding(context, binding => this.client.presentation(binding, messageId, state)); }
  dshAttempted(context: HostContext, messageId: string) { return this.withBinding(context, binding => this.client.dshAttempted(binding, messageId)); }
  dshAccepted(context: HostContext, messageId: string) { return this.withBinding(context, binding => this.client.dshAccepted(binding, messageId)); }
  blobPath(digest: string) { return this.client.blobPath(digest); }
  async readBlob(digest: string) { return readFile(await this.client.blobPath(digest)); }
}
