import { rpcError } from './management-rpc.js';
import React, { useEffect, useState } from 'react';
import type { ExpressionRef } from '../sample-catalog.js';
import type { ClientPort } from './client.js';
import type { DshRpc, VisualData, VisualMeta } from './contracts.js';
interface SessionProps { sessionId: string }
export function errorText(error: unknown): string { return error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string' ? (error as { message: string }).message : '操作失败'; }
function reducedMotion(): boolean { return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true; }
function narrowRef(ref: ExpressionRef): ExpressionRef { return { asset_id: ref.asset_id, revision_id: ref.revision_id }; }
export function createRpc(ctx: ClientPort): DshRpc {
  const call = async <T,>(method: string, payload: unknown, signal?: AbortSignal): Promise<T> => {
    const result = await ctx.connection.rpc.call('/api', `amoji/${method}`, payload, signal);
    if (!result.ok) throw rpcError(result.error);
    return result.value as T;
  };
  const binary = async (sessionId: string, action: string, body: BodyInit) => {
    const response = await fetch(`/api/amoji/pack-${action}?sessionId=${encodeURIComponent(sessionId)}`, { method: 'POST', body, credentials: 'same-origin', signal: AbortSignal.timeout(125000) });
    if (!response.ok) { const data = await response.json(); throw rpcError(data.error); } return response;
  };
  return {
    management: (sessionId, method, args, signal) => call('management', { sessionId, method, args }, signal),
    importPack: async (sessionId, file) => { try { return (await (await binary(sessionId, 'import', file)).json()).result; } catch (error) { if (!(error as {code?: string}).code) throw rpcError({code: 'PACK_OUTCOME_UNKNOWN', message: '导入结果尚待核对。请保留原文件，核对库或重试同一包。'}); throw error; } },
    exportPack: async (sessionId, refs, name) => (await binary(sessionId, 'export', JSON.stringify({ refs: refs.map(narrowRef), name }))).blob(),
    manage: (sessionId, signal) => call('manage', { sessionId }, signal),
    catalog: (sessionId, signal) => call('catalog', { sessionId }, signal),
    search: (sessionId, query, limit, signal) => call('search', { sessionId, query, ...(limit === undefined ? {} : { limit }) }, signal),
    submit: (sessionId, ref, requestId, signal) => call('submit', { sessionId, ref: narrowRef(ref), requestId }, signal),
    history: (sessionId, signal) => call('history', { sessionId }, signal),
    visual: (sessionId, ref, messageId, signal) => call('visual', { sessionId, ref: narrowRef(ref), ...(messageId ? { messageId } : {}) }, signal),
    display: (sessionId, messageId, hash, state, signal) => call('display', { sessionId, messageId, hash, state }, signal),
  };
}
export function parseMeta(raw: unknown): VisualMeta | undefined {
  if (!raw || typeof raw !== 'object') return;
  const value = raw as Partial<VisualMeta>;
  if (value.kind !== 'amoji' || typeof value.messageId !== 'string' || typeof value.ref?.asset_id !== 'string' || typeof value.ref.revision_id !== 'string' || typeof value.alt !== 'string' || !/^[a-f0-9]{64}$/.test(value.visualHash ?? '') || (value.posterHash !== null && !/^[a-f0-9]{64}$/.test(value.posterHash ?? ''))) return;
  return value as VisualMeta;
}
export function sameRef(a: ExpressionRef, b: ExpressionRef): boolean { return a.asset_id === b.asset_id && a.revision_id === b.revision_id; }

export function AmojiImage({ rpc, sessionId, refValue, meta }: SessionProps & { rpc: DshRpc; refValue: ExpressionRef; meta?: VisualMeta }) {
  const [data, setData] = useState<VisualData>(); const [paused, setPaused] = useState(reducedMotion); const [error, setError] = useState(''); const [receiptError, setReceiptError] = useState('');
  useEffect(() => {
    const abort = new AbortController(); setData(undefined); setError(''); setReceiptError(''); setPaused(reducedMotion());
    void rpc.visual(sessionId, refValue, meta?.messageId, abort.signal).then(value => {
      if (!sameRef(value.expression, refValue) || (meta && (value.expression.visual.primary.sha256 !== meta.visualHash || (value.expression.visual.poster?.sha256 ?? null) !== meta.posterHash || value.expression.semantics.fallback !== meta.alt))) throw new Error('图片版本或摘要不匹配');
      if (!abort.signal.aborted) setData(value);
    }).catch(e => { if (!abort.signal.aborted) setError(errorText(e)); });
    return () => abort.abort();
  }, [rpc, sessionId, refValue.asset_id, refValue.revision_id, meta?.messageId, meta?.visualHash, meta?.posterHash]);
  useEffect(() => {
    const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const changed = (event: MediaQueryListEvent) => { if (event.matches) setPaused(true); };
    preference?.addEventListener?.('change', changed);
    return () => preference?.removeEventListener?.('change', changed);
  }, []);
  const acknowledge = (state: 'rendered' | 'failed') => {
    if (!meta || !data) return;
    const hash = paused && data.poster ? data.expression.visual.poster!.sha256 : data.expression.visual.primary.sha256;
    void rpc.display(sessionId, meta.messageId, hash, state).catch(e => setReceiptError(`回执未保存：${errorText(e)}`));
  };
  const alt = meta?.alt ?? data?.expression.semantics.fallback ?? '表情加载中';
  return <figure style={{ margin: 8 }}>
    {error ? <span role="alert">{alt} · {error}</span> : data ? <img key={paused && data.poster ? data.poster : data.primary} style={{ width: 96, height: 96, objectFit: 'contain' }} src={paused && data.poster ? data.poster : data.primary} alt={alt} onLoad={() => acknowledge('rendered')} onError={() => { setError('浏览器无法解码图片，显示固定文字'); acknowledge('failed'); }} /> : <span>加载中…</span>}
    {data?.expression.visual.animated && data.poster && !error && <button type="button" aria-pressed={paused} onClick={() => setPaused(v => !v)}>{paused ? '播放动图' : '暂停动图'}</button>}
    {receiptError && <small role="alert">{receiptError}</small>}
  </figure>;
}
