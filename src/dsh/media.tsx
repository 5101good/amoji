import { useText, useUiLocale, errorMessage, type TextMessage } from './i18n.js';
import { actGloss, expressionText } from '../protocol/browser.js';
import { rpcError } from './management-rpc.js';
import React, { useEffect, useState } from 'react';
import type { ExpressionRef } from '../protocol/browser.js';
import type { ClientPort } from './client.js';
import type { DshRpc, VisualData, VisualMeta } from './contracts.js';
interface SessionProps { sessionId: string }
export function errorText(error: unknown): TextMessage { return errorMessage(error); }
type Motion = 'system' | 'on' | 'off';
// The person's reduce_motion preference (RFC §11.6), read once per page and updated when they save it.
let motionPreference: Motion | undefined; let motionLoad: Promise<void> | undefined; const motionListeners = new Set<() => void>();
export function setMotionPreference(value: Motion) { if (motionPreference === value) return; motionPreference = value; motionListeners.forEach(listener => listener()); }
function loadMotionPreference(rpc: DshRpc, sessionId: string) {
  if (motionPreference !== undefined || motionLoad || !rpc.management) return;
  motionLoad = Promise.resolve(rpc.management(sessionId, 'getSettings', {})).then(value => { if (value?.reduce_motion) setMotionPreference(value.reduce_motion); }).catch(() => {}).finally(() => { motionLoad = undefined; });
}
function reducedMotion(): boolean {
  if (motionPreference === 'on') return true;
  if (motionPreference === 'off') return false;
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}
function narrowRef(ref: ExpressionRef): ExpressionRef { return { asset_id: ref.asset_id, revision_id: ref.revision_id }; }
export function createRpc(ctx: ClientPort): DshRpc {
  const call = async <T,>(method: string, payload: unknown, signal?: AbortSignal, operation = method): Promise<T> => {
    signal?.throwIfAborted();
    let result;
    try { result = await ctx.connection.rpc.call('/api', `amoji/${method}`, payload, signal); }
    catch {
      signal?.throwIfAborted();
      if (operation === 'saveDraft' || operation === 'confirmDraft') throw rpcError({code:'DRAFT_OUTCOME_UNKNOWN',message:'草稿写入结果尚待核对。原填写和上传已保留，请重新连接后核对当前状态，不要重复保存或确认。'});
      if (operation === 'previewDraft') throw rpcError({code:'DRAFT_PREVIEW_UNAVAILABLE',message:'预览连接中断，请重新连接后重试预览；原草稿仍保留。'});
      throw rpcError({ code: method === 'submit' ? 'DSH_OUTCOME_UNKNOWN' : 'CONNECTION_CLOSED', message: method === 'submit' ? '投递结果尚待核对，请保留原选择，重新连接后核对原请求。' : '连接中断，请点击重新连接并核对；原有草稿和历史仍保留。' });
    }
    if (!result.ok) throw rpcError(result.error);
    return result.value as T;
  };
  const reportedErrors = new WeakSet<Error>();
  const binary = async (sessionId: string, action: string, body: BodyInit) => {
    const response = await fetch(`/api/amoji/pack-${action}?sessionId=${encodeURIComponent(sessionId)}`, { method: 'POST', body, credentials: 'same-origin', signal: AbortSignal.timeout(125000) });
    if (!response.ok) {
      const data = await response.json(); const raw = data?.error;
      if (!raw || typeof raw.code !== 'string' || !/^[A-Z][A-Z0-9_]+$/.test(raw.code) || typeof raw.message !== 'string' || !raw.details || typeof raw.details !== 'object' || Array.isArray(raw.details)) throw new Error('包服务返回了无法识别的错误');
      const error = rpcError(raw); reportedErrors.add(error); throw error;
    } return response;
  };
  return {
    publisher:(sessionId,method,args)=>call('publisher.'+method,{sessionId,args}),
    marketplace:(sessionId,method,args)=>call('marketplace.'+method,{sessionId,args}),
    reconnect: (sessionId, signal) => call('reconnect', { sessionId }, signal),
    management: (sessionId, method, args, signal) => call('management', { sessionId, method, args }, signal, method),
    importPack: async (sessionId, file) => {
      try {
        const { result } = await (await binary(sessionId, 'import', file)).json();
        if (!result || typeof result.pack_id !== 'string' || !result.pack_id || typeof result.release_id !== 'string' || !Number.isSafeInteger(result.added) || result.added < 0 || !Number.isSafeInteger(result.existing) || result.existing < 0 || !Number.isSafeInteger(result.effects)) throw new Error('导入结果正文无效');
        return result;
      } catch (error) {
        if (error instanceof Error && reportedErrors.has(error)) throw error;
        throw rpcError({ code: 'PACK_OUTCOME_UNKNOWN', message: '导入结果尚待核对。请保留原文件，核对库或重试同一包。' });
      }
    },
    exportRelease:async(sessionId,releaseId,withoutEffects=false)=>(await binary(sessionId,'release-export',JSON.stringify({release_id:releaseId,without_effects:withoutEffects}))).blob(),
    exportPack: async (sessionId, refs, name, locale) => (await binary(sessionId, 'export', JSON.stringify({ refs: refs.map(narrowRef), name, ...(locale ? { locale } : {}) }))).blob(),
    manage: (sessionId, signal) => call('manage', { sessionId }, signal),
    catalog: (sessionId, signal) => call('catalog', { sessionId }, signal),
    search: (sessionId, query, limit, signal) => call('search', { sessionId, query, ...(limit === undefined ? {} : { limit }) }, signal),
    packs: (sessionId, signal) => call('packs', { sessionId }, signal),
    submit: (sessionId, input, requestId, signal) => call('submit', { sessionId, input: { ...input, ...(input.ref ? { ref: narrowRef(input.ref) } : {}) }, requestId }, signal),
    retract: (sessionId, messageId, signal) => call('retract', { sessionId, messageId }, signal),
    choose: (sessionId, messageId, option, signal) => call('choose', { sessionId, messageId, option }, signal),
    rules:sessionId=>call('collaboration.rules',{sessionId}),
    enableRule:(sessionId,selection,generation,replace)=>call('collaboration.enable',{sessionId,selection,generation,replace}),
    disableRule:(sessionId,selection,generation)=>call('collaboration.disable',{sessionId,selection,generation}),
    disableAllRules:(sessionId,generation)=>call('collaboration.disableAll',{sessionId,generation}),
    capabilities: (sessionId,signal)=>call('collaboration.capabilities',{sessionId},signal),
    receipts: (sessionId,signal)=>call('collaboration.receipts',{sessionId},signal),
    effects: (sessionId,ref,signal) => call('effects',{sessionId,ref:narrowRef(ref)},signal),
    history: (sessionId, signal) => call('history', { sessionId }, signal),
    visual: (sessionId, ref, messageId, signal) => call('visual', { sessionId, ref: narrowRef(ref), ...(messageId ? { messageId } : {}) }, signal),
    display: (sessionId, messageId, hash, state, signal) => call('display', { sessionId, messageId, hash, state }, signal),
  };
}
export function parseMeta(raw: unknown): VisualMeta | undefined {
  if (!raw || typeof raw !== 'object') return;
  const value = raw as Partial<VisualMeta>;
  if (value.kind !== 'amoji' || typeof value.messageId !== 'string' || typeof value.act !== 'string' || typeof value.alt !== 'string' || (value.direction !== 'h2a' && value.direction !== 'a2h') || (value.policy !== 'keep' && value.policy !== 'prefer')) return;
  if (value.ref === null) { if (value.visualHash !== null || value.posterHash !== null) return; }
  else if (typeof value.ref?.asset_id !== 'string' || typeof value.ref.revision_id !== 'string' || !/^[a-f0-9]{64}$/.test(value.visualHash ?? '') || (value.posterHash !== null && !/^[a-f0-9]{64}$/.test(value.posterHash ?? ''))) return;
  return value as VisualMeta;
}
export function sameRef(a: ExpressionRef, b: ExpressionRef): boolean { return a.asset_id === b.asset_id && a.revision_id === b.revision_id; }

export function AmojiImage({ rpc, sessionId, refValue, meta, thumbnail = false }: SessionProps & { rpc: DshRpc; refValue: ExpressionRef; meta?: VisualMeta; thumbnail?: boolean }) {
 const t=useText(); const locale=useUiLocale();
  const [data, setData] = useState<VisualData>(); const [paused, setPaused] = useState(() => thumbnail || reducedMotion()); const [error, setError] = useState<TextMessage>(''); const [receiptError, setReceiptError] = useState<unknown>();
  useEffect(() => {
    const abort = new AbortController(); setData(undefined); setError(''); setReceiptError(''); setPaused(thumbnail || reducedMotion());
    void rpc.visual(sessionId, refValue, meta?.messageId, abort.signal).then(value => {
      if (!sameRef(value.expression, refValue) || (meta && (value.expression.visual.primary.sha256 !== meta.visualHash || (value.expression.visual.poster?.sha256 ?? null) !== meta.posterHash))) throw new Error('图片版本或摘要不匹配');
      if (!abort.signal.aborted) setData(value);
    }).catch(e => { if (!abort.signal.aborted) setError(errorText(e)); });
    return () => abort.abort();
  }, [rpc, sessionId, refValue.asset_id, refValue.revision_id, meta?.messageId, meta?.visualHash, meta?.posterHash]);
  useEffect(() => {
    if (!thumbnail) loadMotionPreference(rpc, sessionId);
    const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const changed = () => setPaused(thumbnail || reducedMotion());
    preference?.addEventListener?.('change', changed);
    motionListeners.add(changed);
    return () => { preference?.removeEventListener?.('change', changed); motionListeners.delete(changed); };
  }, [rpc, sessionId, thumbnail]);
  const acknowledge = (state: 'rendered' | 'failed') => {
    if (!meta || !data) return;
    const hash = paused && data.poster ? data.expression.visual.poster!.sha256 : data.expression.visual.primary.sha256;
    void rpc.display(sessionId, meta.messageId, hash, state).catch(e => setReceiptError(e));
  };
  const alt = meta?.alt ?? (data ? expressionText(data.expression, locale).fallback : t('表情加载中'));
  const Frame = thumbnail ? 'span' : 'figure';
  return <Frame className={thumbnail ? 'amoji-media amoji-thumbnail' : 'amoji-media'}>
    {error ? <span className="amoji-media-fallback" role="alert" title={t(error)}>{alt}<small>{thumbnail ? '' : t("图片暂不可用")}</small></span> : data ? <img key={paused && data.poster ? data.poster : data.primary}  src={paused && data.poster ? data.poster : data.primary} alt={alt} onLoad={() => acknowledge('rendered')} onError={() => { setError('浏览器无法解码图片，显示固定文字'); acknowledge('failed'); }} /> : <span className="amoji-media-loading" role="status" aria-label={t("图片加载中")}/>}
    {!thumbnail && data?.expression.visual.animated && data.poster && !error && <button className="amoji-playback" type="button" aria-pressed={paused} onClick={() => setPaused(v => !v)}>{paused ? t("播放动图") : t("暂停动图")}</button>}
    {!!receiptError && <small role="alert">{t('回执未保存：{error}',{error:t(errorText(receiptError))})}</small>}
  </Frame>;
}

/** One message's media: the glyph, or the act's gloss when the message has no glyph. A glyph that fails to load falls back to its text inside AmojiImage. */
export function MessageMedia({ rpc, sessionId, meta }: SessionProps & { rpc: DshRpc; meta: VisualMeta }) {
  const locale = useUiLocale();
  const gloss = actGloss(meta.act, meta.direction, locale).text;
  useEffect(() => { if (!meta.ref) void rpc.display(sessionId, meta.messageId, 'text', 'fallback').catch(() => {}); }, [rpc, sessionId, meta.messageId, meta.ref]);
  const caption = meta.policy === 'prefer' || !meta.ref;
  return <>{meta.ref && <AmojiImage rpc={rpc} sessionId={sessionId} refValue={meta.ref} meta={{ ...meta, alt: gloss }}/>}{caption && <span className="amoji-gloss" lang={locale}>{gloss}</span>}</>;
}
