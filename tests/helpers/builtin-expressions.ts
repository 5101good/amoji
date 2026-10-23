import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LibraryStore } from '../../src/library-store.js';
import type { Expression } from '../../src/protocol/index.js';
import { SEEDS } from './store-runtime.js';

interface Builtin { expressions: Expression[]; bytes(sha256: string): Buffer; dataUrl(blob: { sha256: string; mime: string }): string }
let loaded: Promise<Builtin> | undefined;
/** The built-in packs' expressions and media bytes, read once from a throwaway store. */
export function builtin(): Promise<Builtin> {
  loaded ??= (async () => {
    const directory = await mkdtemp(join(tmpdir(), 'amoji-builtin-'));
    const store = await LibraryStore.open(directory, SEEDS);
    try {
      const expressions = store.list(); const blobs = new Map<string, Buffer>();
      for (const e of expressions) for (const blob of [e.visual.primary, e.visual.poster]) if (blob && !blobs.has(blob.sha256)) blobs.set(blob.sha256, await readFile(await store.blobPath(blob.sha256)));
      const bytes = (sha256: string) => blobs.get(sha256) ?? (() => { throw new Error(`unknown blob ${sha256}`); })();
      return { expressions, bytes, dataUrl: blob => `data:${blob.mime};base64,${bytes(blob.sha256).toString('base64')}` };
    } finally { store.close(); await rm(directory, { recursive: true, force: true }); }
  })();
  return loaded;
}
