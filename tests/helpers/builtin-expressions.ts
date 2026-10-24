import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LibraryStore } from '../../src/library-store.js';
import { expressionText, type Expression } from '../../src/protocol/index.js';
import type { Draft, DraftFields } from '../../src/drafts.js';
import type { StoredMessage } from '../../src/messages.js';
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

/** Draft fields that reproduce an expression's text exactly. */
export function fieldsOf(e: Expression): DraftFields {
  return { realizes: e.realizes, intensity: e.intensity, ...(e.directions ? { directions: e.directions } : {}), original_locale: e.original_locale, name: e.name, semantics: e.semantics, ...(e.tags ? { tags: e.tags } : {}), rights: e.rights, text_locale: e.visual.text_locale };
}
/** A saved create draft holding an expression's text and media. */
export function draftOf(e: Expression, draft_id = 'draft'): Draft {
  const { text_locale: _textLocale, ...visual } = e.visual;
  return { draft_id, version: 1, updated_at: 'now', mode: 'create', fields: fieldsOf(e), visual };
}
/** The zh-CN display text of an expression. */
export const zh = (e: Expression) => expressionText(e, 'zh-CN');
/** A minimal stored message carrying an exact revision, for visual meta. */
export function messageOf(e: Expression, message_id: string, role: 'human' | 'ai' = 'human'): StoredMessage {
  return { message_id, binding_id: 'binding', registry_revision: '0.1-r3', from: { role }, direction: role === 'human' ? 'human_to_ai' : 'ai_to_human', act: e.realizes, intensity: e.intensity, revision: e, glyph_policy: 'keep', mode: 'turn', created_at: '', presentation: 'pending' };
}
