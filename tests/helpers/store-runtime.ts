import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { LibraryStore } from '../../src/library-store.js';
import type { AdapterRuntime } from '../../src/adapter-runtime.js';

export const OFFICIAL = new URL('../../assets/official-packs/', import.meta.url);
export const SEEDS = [new URL('classic.amoji', OFFICIAL), new URL('office.amoji', OFFICIAL)];

/** A temporary store seeded with the built-in packs. */
export async function openStore(seeds: readonly URL[] = SEEDS): Promise<{ store: LibraryStore; directory: string; close(): Promise<void> }> {
  const directory = await mkdtemp(join(tmpdir(), 'amoji-store-'));
  const store = await LibraryStore.open(directory, seeds);
  return { store, directory, close: async () => { store.close(); await rm(directory, { recursive: true, force: true }); } };
}

/** In-process AdapterRuntime over a store, for adapter and tool tests without the HTTP service. */
export function storeRuntime(store: LibraryStore, directory: string): AdapterRuntime {
  return {
    catalog: { root: pathToFileURL(`${directory}/`), all: () => store.list(), resolve: ref => store.resolve(ref) },
    search: (context, query, limit, locale) => store.search(context, query, limit, locale),
    express: (context, input) => store.express(context, input),
    messages: context => store.history(context),
    receive: (context, input, requestId) => store.receive(context, input, requestId),
    retract: (context, id) => store.retract(context, id),
    choose: (context, id, option) => store.choose(context, id, option),
    signalState: (context, id, state) => store.signal(context, id, state),
    applied: (context, id) => store.applied(context, id),
    acknowledge: (context, id, state) => store.presentation(context, id, state),
    blobPath: digest => store.blobPath(digest),
  };
}
