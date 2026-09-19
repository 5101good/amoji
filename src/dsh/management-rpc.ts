import type { Draft, DraftFields } from '../drafts.js';
import type { Expression, ExpressionRef } from '../sample-catalog.js';
import type { LibraryEntry, PersonalPreferences, PersonalSettings } from '../library-management.js';
import type { TextSuggestion } from '../suggestions.js';
import type { ImportResult } from '../packs.js';
export interface ManagementMethods {
  listEntries: [Record<string, never>, LibraryEntry[]];
  listRevisions: [{ asset_id: string }, Expression[]];
  startRevisionDraft: [{ ref: ExpressionRef; version: number }, Draft];
  setArchived: [{ asset_id: string; version: number; archived: boolean }, LibraryEntry];
  selectRevision: [{ ref: ExpressionRef; version: number }, LibraryEntry];
  getSettings: [Record<string, never>, PersonalSettings];
  updateSettings: [{ version: number; preferences: PersonalPreferences }, PersonalSettings];
  createDraft: [Record<string, never>, Draft];
  listDrafts: [Record<string, never>, Draft[]];
  getDraft: [{ draft_id: string }, Draft];
  saveDraft: [{ draft_id: string; version: number; fields: DraftFields; upload?: string }, Draft];
  previewDraft: [{ draft_id: string; version: number }, { draft: Draft; primary: string; poster: string | null }];
  confirmDraft: [{ draft_id: string; version: number }, Expression];
  suggestText: [{ intent: string; notes?: string }, TextSuggestion];
  revisionVisual: [{ ref: ExpressionRef }, { expression: Expression; primary: string; poster: string | null }];
}
export interface ManagementRpc {
  management<K extends keyof ManagementMethods>(sessionId: string, method: K, args: ManagementMethods[K][0], signal?: AbortSignal): Promise<ManagementMethods[K][1]>;
  importPack(sessionId: string, file: File): Promise<ImportResult>;
  exportPack(sessionId: string, refs: ExpressionRef[], name: string): Promise<Blob>;
}
export function rpcError(raw: { code?: string; message?: string; details?: { current?: unknown } }): Error & { code?: string; current?: unknown } {
  return Object.assign(new Error(raw.message || '操作失败'), { code: raw.code, current: raw.details?.current });
}
