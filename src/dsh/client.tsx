import type { EffectChoice, EffectSelection } from '../effects.js';
import { useText, useUiLocale, message, type TextMessage, AmojiLocaleProvider, AMOJI_LOCALE, chinese, dictionaries, type AmojiLocale } from './i18n.js';
import { english } from './i18n-dictionary.js';
import { aiExpressionDefinition, AiExpressions } from './ai-messages.js';
import { Manager } from './manager.js';
import { Styles, CloseIcon, SmileIcon, ExpressionTile } from './ui.js';
import React, { useEffect, useRef, useState } from 'react';
import { actEntry, actGloss, expressionText, localizedText, type Expression, type Family } from '../protocol/index.js';
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots';
import { PickerPopover } from './picker-popover.js';
import { FAMILY_LABELS } from './labels.js';
export { FAMILY_LABELS } from './labels.js';
import { mountUserMessages } from './messages.js';
import type { DshRpc, HistoryEntry, PackSummary, RpcResult, SubmitInput } from './contracts.js';
import type { PersonalSettings } from '../library-management.js';

export interface ClientPort {
  locale?: AmojiLocale;
  uiConversation?: { events: { register(definition: typeof aiExpressionDefinition): () => void } };
  connection: { rpc: { call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<RpcResult<unknown>> } };
  effect(factory: () => (() => void), label?: string): unknown;
  slots: {
    register(options: { name: string; key?: string; id?: string; priority?: number; locale?: string; inject?: StoredEntry['inject']; store?: StoredEntry['store'] }, component: React.ComponentType<any>): () => void;
    inject(name: string, factory: () => (() => void)): () => void;
    entries(name: string): readonly StoredEntry[];
    subscribe(name: string, listener: () => void): () => void;
  };
}
interface SessionProps { sessionId: string }
import { AmojiImage, MessageMedia, createRpc, parseMeta, errorText } from './media.js';
export { AmojiImage, createRpc, parseMeta } from './media.js';
const FAMILIES: Family[] = ['grounding', 'steering', 'progress', 'epistemic', 'social'];
export function deliveryText(row: HistoryEntry): TextMessage {
  if (row.effect) {
    return ({ prepared: '效果已准备，尚未投递。', dispatched: '表达已排队，效果等待匹配回合领取。', bound: '效果已绑定匹配回合，尚待核对附加。', attached: '效果已附加到原生用户上下文；不代表模型遵从。', failed: '效果未应用；宿主未提交匹配上下文。可另选仅发送表达。', cancelled: '效果已取消，不会用于后续回合。', unknown: '效果结果待核对；不会再次提交原请求。', unsupported: '当前宿主不支持效果，可明确选择仅发送。' } as const)[row.effect.status];
  }
  const m = row.message;
  if (m.retracted_at) return '已撤回；历史保留这条记录。';
  if (m.mode === 'interrupt') return m.applied ? '已让 AI 停下当前回合。' : '停止请求尚待核对。';
  if (m.signal === 'queued') return '纠偏信号排队中：AI 的下一步会先看到它。';
  if (m.signal === 'delivered_to_model') return '纠偏信号已送达，AI 在本次回答中已看到。';
  if (m.signal === 'promoted') return 'AI 已结束上一回合，纠偏信号已转为一条新消息。';
  if (row.host?.status === 'observed') return m.presentation === 'rendered' ? '已观察到会话用户消息，图片已展示' : m.presentation === 'fallback' ? '已观察到会话用户消息，当前使用固定文字回退' : '已观察到会话用户消息，图片展示尚待确认';
  if (row.host?.status === 'accepted') return '宿主已接收入队，尚未确认用户消息落盘';
  if (row.host?.status === 'unknown') return '投递结果尚待核对；不会再次提交，请核对原会话。';
  return '尚未提交到宿主，可保留原选择重试。';
}
const UNKNOWN_CODES = ['CONNECTION_CLOSED', 'SERVICE_OUTCOME_UNKNOWN', 'DSH_OUTCOME_UNKNOWN'];
const inputKey = (input: SubmitInput) => JSON.stringify(input);

export function createComponents(rpc: DshRpc) {
  // Keep unresolved identities beyond a keyed PickerSession's lifetime. A UI abort
  // cannot tell us whether the host already accepted the original submission.
  const pendingSelections = new Map<string, { input: SubmitInput; selected?: Expression; requestId: string; sent?: HistoryEntry }>();
  function Picker({ sessionId }: SessionProps) {
    const [managerTab, setManagerTab] = useState('library'); const [reopen, setReopen] = useState(0); const [managerSession, setManagerSession] = useState<string>(); const [managerOpen, setManagerOpen] = useState(false); const [refresh, setRefresh] = useState(0);
    return <><PickerSession key={sessionId} sessionId={sessionId} refresh={refresh} reopen={reopen} onMarket={() => { setManagerTab('market'); setManagerSession(v => v ?? sessionId); setManagerOpen(true); }} onManage={() => { setManagerTab('library'); setManagerSession(v => v ?? sessionId); setManagerOpen(true); }}/>{managerSession && <Manager initialTab={managerTab} rpc={rpc} sessionId={managerSession} currentSessionId={sessionId} open={managerOpen} onClose={() => { setManagerOpen(false); setRefresh(v => v + 1); setReopen(v => v + 1); }} onChanged={() => setRefresh(v => v + 1)}/>}</>;
  }
  function PickerSession({ sessionId, onManage, onMarket, refresh, reopen }: SessionProps & { onManage: () => void; onMarket: () => void; refresh: number; reopen: number }) {
    const t = useText(); const locale = useUiLocale();
    const pending = pendingSelections.get(sessionId);
    const anchor = useRef<HTMLButtonElement>(null);
    const [target, setTarget] = useState<string>(); const [catalog, setCatalog] = useState<Expression[]>([]); const [packs, setPacks] = useState<PackSummary[]>([]); const [pack, setPack] = useState<string>('all');
    const [selected, setSelected] = useState<Expression | undefined>(pending?.selected); const [query, setQuery] = useState(''); const [note, setNote] = useState(pending?.input.note ?? '');
    const [searching, setSearching] = useState(false); const [searchStatus, setSearchStatus] = useState<TextMessage>(''); const [requestId, setRequestId] = useState(pending?.requestId ?? ''); const [busy, setBusy] = useState(false); const [status, setStatus] = useState<TextMessage>(pending ? '原投递结果尚待核对，请重新连接并核对原请求。' : '');
    const [choices, setChoices] = useState<EffectChoice[]>([]); const [effectIndex, setEffectIndex] = useState(0); const [effectsLoading, setEffectsLoading] = useState(false); const [moreQuick, setMoreQuick] = useState(false);
    const selectionEpoch = useRef(0);
    const sendLock = useRef(false);
    const [settings, setSettings] = useState<PersonalSettings>();
    const [unavailable, setUnavailable] = useState(!!pending); const [uncertain, setUncertain] = useState(!!pending); const [sent, setSent] = useState<HistoryEntry | undefined>(pending?.sent);
    const lifetime = useRef({ sessionId, generation: 0, abort: new AbortController() });
    const searchTask = useRef({ generation: 0, abort: new AbortController() });
    const [receipts, setReceipts] = useState<HistoryEntry[]>([]);
    const choose = async (expression: Expression, detail = false) => {
      selectionEpoch.current++; const epoch = selectionEpoch.current; setSent(undefined); setStatus(''); setChoices([]); setEffectIndex(0); setRequestId('');
      if (!rpc.effects) { if (detail) setSelected(expression); else void send({ ref: expression }, expression); return; }
      setSelected(expression); setEffectsLoading(true);
      try { const values = await rpc.effects(sessionId, expression, lifetime.current.abort.signal); if (selectionEpoch.current !== epoch) return; if (!Array.isArray(values)) throw new Error('当前宿主不支持效果，可明确选择仅发送。'); setChoices(values); if (!values.length && !detail) void send({ ref: expression }, expression); }
      catch (e) { if (selectionEpoch.current === epoch) setStatus(errorText(e)); }
      finally { if (selectionEpoch.current === epoch) setEffectsLoading(false); }
    };
    const refreshReceipts = async () => {
      if (!rpc.receipts || !target) return;
      const owner = lifetime.current; const generation = owner.generation;
      try { const rows = await rpc.receipts(sessionId, owner.abort.signal); if (!Array.isArray(rows)) throw new Error('协作回执暂不可用，请重新核对。'); if (!owner.abort.signal.aborted && owner.generation === generation) setReceipts(rows); }
      catch (error) { if (!owner.abort.signal.aborted && owner.generation === generation) setStatus(errorText(error)); }
    };
    const previousReopen = useRef(reopen);
    useEffect(() => { if (previousReopen.current !== reopen) { previousReopen.current = reopen; setTarget(sessionId); } }, [reopen, sessionId]);
    const [category, setCategory] = useState<Family | 'all'>('all');
    const inPack = (e: Expression) => pack === 'all' || !!packs.find(p => p.pack_id === pack)?.assets.includes(e.asset_id);
    const packCatalog = catalog.filter(inPack);
    const familyOf = (e: Expression) => actEntry(e.realizes).family;
    const categories = FAMILIES.filter(c => packCatalog.some(e => familyOf(e) === c));
    const visibleCatalog = category === 'all' ? packCatalog : packCatalog.filter(e => familyOf(e) === category);
    const quickEntries = (settings?.quick_entries ?? []).slice(0, moreQuick ? 8 : 4);
    useEffect(() => { void refreshReceipts(); }, [target, sent?.meta?.messageId]);
    useEffect(() => {
      const owner = lifetime.current; owner.generation++; owner.abort = new AbortController();
      return () => { owner.generation++; owner.abort.abort(); };
    }, [sessionId]);
    useEffect(() => {
      if (!target) return;
      void Promise.all([load(''), rpc.packs ? rpc.packs(target).then(setPacks) : Promise.resolve(), rpc.management ? rpc.management(target, 'getSettings', {}).then(value => { setSettings(value); setPack(previous => previous === 'all' && value.preferred_packs[0] ? value.preferred_packs[0] : previous); }) : Promise.resolve()]).catch(() => {});
      return () => { searchTask.current.generation++; searchTask.current.abort.abort(); };
    }, [target, refresh]);
    const load = async (nextQuery: string, afterReconnect = false) => {
      if (!target || (uncertain && unavailable && !afterReconnect)) return;
      const owner = lifetime.current; const ownerGeneration = owner.generation; const frozen = target; const task = searchTask.current;
      task.generation++; task.abort.abort(); task.abort = new AbortController();
      const taskGeneration = task.generation; const signal = AbortSignal.any([owner.abort.signal, task.abort.signal]);
      const current = () => !signal.aborted && owner.generation === ownerGeneration && owner.sessionId === frozen && task.generation === taskGeneration;
      setSearching(true); setSearchStatus('');
      try {
        const value = nextQuery.trim() ? await rpc.search(frozen, nextQuery, 5, signal) : await rpc.catalog(frozen, signal);
        if (!current()) return;
        setUnavailable(false); setCatalog(value); setSelected(previous => uncertain ? previous : previous && value.some(e => e.asset_id === previous.asset_id && e.revision_id === previous.revision_id) ? previous : undefined);
        setSearchStatus(nextQuery.trim() ? (value.length ? message('找到 {count} 个候选。', { count: value.length }) : '没有合适的表情，可以继续用文字表达。') : message('当前可选 {count} 个表情。', { count: value.length }));
      } catch (e) { if (current()) { setCatalog([]); setUnavailable(true); setSearchStatus(errorText(e)); } }
      finally { if (current()) setSearching(false); }
    };
    const send = async (base: SubmitInput, shown?: Expression, retryRequestId = requestId) => {
      if (!target || sendLock.current || unavailable) return;
      sendLock.current = true;
      const owner = lifetime.current; const generation = owner.generation; const frozen = target; const signal = owner.abort.signal;
      const current = () => !signal.aborted && owner.generation === generation && owner.sessionId === frozen;
      const input: SubmitInput = { ...base, ...(note.trim() ? { note: note.trim() } : {}) };
      const previous = pendingSelections.get(frozen);
      const id = retryRequestId && previous && inputKey(previous.input) === inputKey(input) ? retryRequestId : crypto.randomUUID();
      setSelected(shown); setRequestId(id);
      const identity = { input, selected: shown, requestId: id, sent };
      pendingSelections.set(frozen, identity);
      setBusy(true); setStatus('');
      try {
        const result = await rpc.submit(frozen, input, id, signal);
        if (pendingSelections.get(frozen) === identity) {
          if (result.host?.status === 'unknown') identity.sent = result;
          else pendingSelections.delete(frozen);
        }
        if (current()) {
          setSent(result); setUncertain(result.host?.status === 'unknown'); setStatus(deliveryText(result));
          if (!result.effect && (result.host?.status === 'accepted' || result.host?.status === 'observed')) {
            setSelected(undefined); setNote(''); setTarget(undefined); anchor.current?.focus({ preventScroll: true });
          }
        }
      } catch (e) {
        const unknown = signal.aborted || UNKNOWN_CODES.includes((e as { code?: string }).code ?? '');
        if (!unknown && pendingSelections.get(frozen) === identity) pendingSelections.delete(frozen);
        if (current()) { setStatus(errorText(e)); if (UNKNOWN_CODES.includes((e as { code?: string }).code ?? '')) { setUncertain(true); setUnavailable(true); setCatalog([]); searchTask.current.generation++; searchTask.current.abort.abort(); setSearching(false); } }
      }
      finally { sendLock.current = false; if (current()) setBusy(false); }
    };
    /** Choosing a pack also makes it the preferred one, so AI glyphs follow it (RFC §11.6). */
    const changePack = async (next: string) => {
      setPack(next); setCategory('all'); setSelected(undefined);
      if (next === 'all' || !target || !settings || busy || uncertain || settings.preferred_packs[0] === next) return;
      try {
        const { version, ...preferences } = settings;
        setSettings(await rpc.management(target, 'updateSettings', { version, preferences: { ...preferences, preferred_packs: [next, ...settings.preferred_packs.filter(p => p !== next)] } }));
      } catch (e) {
        setStatus(errorText(e));
        try { setSettings(await rpc.management(target, 'getSettings', {})); } catch {}
      }
    };
    const check = async () => {
      if (!target || !sent?.meta?.messageId) return;
      const owner = lifetime.current; const generation = owner.generation; const frozen = target; const selection = selectionEpoch.current;
      try {
        const rows = await rpc.history(frozen, owner.abort.signal);
        if (owner.abort.signal.aborted || owner.generation !== generation || selection !== selectionEpoch.current) return;
        const row = rows.find(row => row.meta.messageId === sent.meta.messageId && row.host?.requestId === sent.host?.requestId);
        if (row) {
          const pending = pendingSelections.get(frozen);
          if (pending?.requestId === requestId) { if (row.host?.status === 'unknown') pending.sent = row; else pendingSelections.delete(frozen); }
          setSent(row); setUncertain(row.host?.status === 'unknown'); setStatus(deliveryText(row));
        } else setStatus('原消息暂时无法核对，请保留原选择，不要另发一次。');
      } catch (e) { if (!owner.abort.signal.aborted && owner.generation === generation && selection === selectionEpoch.current) setStatus(errorText(e)); }
    };
    useEffect(() => {
      if (!target || !sent?.meta?.messageId || (sent.host?.status === 'observed' && sent.message.signal !== 'queued' && (!sent.effect || ['attached', 'failed', 'cancelled'].includes(sent.effect.status)))) return;
      let remaining = 30;
      const timer = setInterval(() => { if (remaining-- > 0) void check(); else clearInterval(timer); }, 2000);
      return () => clearInterval(timer);
    }, [target, sent?.meta?.messageId, sent?.host?.status, sent?.effect?.status, sent?.message.signal]);
    const recover = async () => {
      if (!target || !rpc.reconnect) return;
      const owner = lifetime.current; const generation = owner.generation;
      setBusy(true);
      try {
        await rpc.reconnect(target, owner.abort.signal);
        if (owner.abort.signal.aborted || owner.generation !== generation) return;
        await load(query, true); await check();
      } catch (e) { if (!owner.abort.signal.aborted && owner.generation === generation) setStatus(errorText(e)); }
      finally { if (!owner.abort.signal.aborted && owner.generation === generation) setBusy(false); }
    };
    const dismiss = (restoreFocus = true) => {
      searchTask.current.generation++; searchTask.current.abort.abort(); selectionEpoch.current++;
      setTarget(undefined);
      if (restoreFocus) anchor.current?.focus({ preventScroll: true });
    };
    const text = selected ? expressionText(selected, locale) : undefined;
    const retry = pendingSelections.get(sessionId);
    return <div className="amoji amoji-composer"><Styles/>
      <button ref={anchor} className="amoji-trigger" type="button" aria-label={t("表情")} aria-haspopup="dialog" aria-expanded={target === sessionId} onClick={() => {
        if (target === sessionId) { dismiss(); return; }
        selectionEpoch.current++; setTarget(sessionId);
        if (uncertain || busy) return;
        setQuery(''); setCategory('all'); setSelected(undefined);
      }}><SmileIcon/><span>{t("表情")}</span></button>
      {target === sessionId && <PickerPopover anchor={anchor} onDismiss={dismiss}>
        <header className="amoji-picker-head"><h2>{t("用表情表达")}</h2><div className="row"><button className="quiet" type="button" onClick={() => { dismiss(false); onMarket(); }}>{t("表情市场")}</button><button className="quiet" type="button" onClick={() => { dismiss(false); onManage(); }}>{t("管理表情")}</button><button className="icon-button" type="button" aria-label={t("关闭")} onClick={() => dismiss()}><CloseIcon/></button></div></header>
        {!!quickEntries.length && <nav className="amoji-quick" aria-label={t("快捷表达")}>{quickEntries.map(act => <button type="button" key={act} disabled={busy || uncertain || unavailable} onClick={() => void send({ act })}>{actGloss(act, 'h2a', locale).text}</button>)}{(settings?.quick_entries.length ?? 0) > 4 && <button className="quiet" type="button" aria-expanded={moreQuick} onClick={() => setMoreQuick(v => !v)}>{moreQuick ? t("收起") : t("更多")}</button>}</nav>}
        {packs.length > 1 && <div className="amoji-appearance" aria-label={t("表情包")}><span className="muted">{t("表情包")}</span>{[...packs].sort((a, b) => (settings?.preferred_packs.indexOf(a.pack_id) ?? -1) - (settings?.preferred_packs.indexOf(b.pack_id) ?? -1)).map(p => <button type="button" key={p.pack_id} aria-pressed={pack === p.pack_id} disabled={busy || uncertain} onClick={() => void changePack(p.pack_id)}>{localizedText(p.name, locale, p.original_locale)}</button>)}<button type="button" aria-pressed={pack === 'all'} disabled={busy || uncertain} onClick={() => void changePack('all')}>{t("全部")}</button></div>}
        <form className="amoji-picker-search" aria-label={t("搜索 Amoji")} onSubmit={event => { event.preventDefault(); setCategory('all'); void load(query); }}>
          <input aria-label={t("搜索表情")} value={query} onInput={event => setQuery(event.currentTarget.value)} placeholder={t("想表达什么？")} />
          <button type="submit" disabled={busy || uncertain}>{searching ? t("搜索中…") : t("搜索")}</button>
          {query && <button className="quiet" type="button" disabled={busy || uncertain} onClick={() => { setQuery(''); void load(''); }}>{t("显示全部")}</button>}
        </form>
        <label className="amoji-note">{t("附一句话（可选）")}<input aria-label={t("附一句话（可选）")} maxLength={140} value={note} disabled={busy || uncertain} onInput={event => setNote(event.currentTarget.value)} placeholder={t("例如：第 3 步没看懂")}/></label>
        {categories.length > 1 && <nav className="amoji-categories" aria-label={t("表情类别")}>{(['all', ...categories] as const).map(c => <button className="quiet" type="button" key={c} aria-pressed={category === c} disabled={busy || uncertain} onClick={() => { setCategory(c); setSelected(undefined); setSent(undefined); setStatus(''); selectionEpoch.current++; }}>{t(c === 'all' ? '全部' : FAMILY_LABELS[c])}</button>)}</nav>}
        <div className="amoji-picker-body" aria-busy={searching}>
          {visibleCatalog.length ? <div className="amoji-expression-grid">{visibleCatalog.map(e => <div className="amoji-expression-choice" key={`${e.asset_id}:${e.revision_id}`}><ExpressionTile rpc={rpc} sessionId={target} expression={e} disabled={busy || unavailable || uncertain} selected={false} onSelect={() => void choose(e)} /><button className="amoji-expression-detail" type="button" aria-label={t('查看 {name} 详情', { name: expressionText(e, locale).name })} disabled={busy || uncertain} onClick={() => void choose(e, true)}>{t("详情")}</button></div>)}</div> : <p className="amoji-empty">{searching ? t("正在打开表情库…") : t(searchStatus) || t("暂无可用表情，可以在管理中添加。")}</p>}
        </div>
        <footer className="amoji-picker-footer">
          {!!receipts.length && <details><summary>{t('协作效果记录')}</summary><button type="button" onClick={() => void refreshReceipts()}>{t('核对协作记录')}</button>{receipts.map(row => <p role="status" key={row.message.message_id}>{actGloss(row.message.act, 'h2a', locale).text} · {t(deliveryText(row))} {row.effect?.reason} {row.effect?.turnStartSeq !== undefined && <> · turn {row.effect.turnStartSeq} · snapshot {row.effect.snapshotSeq ?? '—'}</>}</p>)}</details>}
          {selected && text ? <section className="amoji-selection" aria-label={t("固定语义与精确版本")} lang={text.locale}><strong>{text.name}</strong><small className="muted">{actGloss(selected.realizes, 'h2a', locale).text}</small><p>{text.meaning}</p><details><summary>{t("查看含义与适用场景")}</summary><p>{text.use_when.join('；')}</p><p>{text.avoid_when.join('；')}</p><small>{selected.realizes} · {t('版本 {revision}', { revision: selected.revision_id })}</small></details></section> : <p className="muted">{t("选一张表情，看看它想表达什么。")}</p>}
          {selected && !sent && <section aria-label={t('一次性协作提示')}>
            {effectsLoading && <p role="status">{t('正在读取可选效果…')}</p>}
            {!!choices.length && <><label>{t('一次性协作提示')}<select aria-label={t('选择协作提示')} value={effectIndex} disabled={busy || uncertain} onChange={e => setEffectIndex(Number(e.target.value))}>{choices.map((c, i) => <option key={`${c.selection.release_id}:${c.selection.effect_revision_id}`} value={i}>{localizedText(c.effect.title, locale, c.source.original_locale)}</option>)}</select></label><p>{choices[effectIndex] && localizedText(choices[effectIndex]!.effect.summary, locale, choices[effectIndex]!.source.original_locale)}</p><small>{choices[effectIndex]?.source.origin} · {choices[effectIndex]?.source.release_id} · {choices[effectIndex]?.selection.effect_revision_id}</small><p>{t('仅用于关联消息的一个回合；提示不保证模型遵从。')}</p></>}
            <div className="row"><button type="button" disabled={busy || uncertain || effectsLoading} onClick={() => void send({ ref: selected }, selected, '')}>{t('仅发送')}</button>{!!choices.length && <button type="button" disabled={busy || uncertain || effectsLoading} onClick={() => void send({ ref: selected, effect: choices[effectIndex]!.selection as EffectSelection }, selected, '')}>{t('发送并应用一次')}</button>}</div>
          </section>}
          {!sent && status && <p className="amoji-notice" role="status">{t(status)}</p>}
          {sent && !uncertain && <details className="amoji-notice" open={!!sent.effect}><summary>{t("上次发送记录")}</summary><p role="status">{t(status)}{sent.effect?.reason && <> ({sent.effect.reason})</>}{sent.effect?.turnStartSeq !== undefined && <> · turn {sent.effect.turnStartSeq} · snapshot {sent.effect.snapshotSeq ?? '—'} · {sent.effect.digest ?? ''}</>}</p><button type="button" disabled={busy} onClick={() => void check()}>{t("核对投递状态")}</button></details>}
          {sent && uncertain && <p className="amoji-notice" role="status">{t(status)}</p>}
          {(unavailable || uncertain) && <div className="row">{sent?.meta?.messageId && <button type="button" disabled={busy} onClick={() => void check()}>{t("核对投递状态")}</button>}{rpc.reconnect && <button type="button" disabled={busy} onClick={() => void recover()}>{t("重新连接并核对")}</button>}</div>}
        </footer>
        <div className="amoji-send-row"><span className="muted" aria-live="polite">{catalog.length ? t('{count} 个表情 · 点击即发送', { count: visibleCatalog.length }) : ''}</span>{uncertain && <button className="primary" type="button" disabled={!retry || busy || unavailable} onClick={() => retry && void send(retry.input, retry.selected, retry.requestId)}>{busy ? t("核对中…") : t("重试原请求")}</button>}</div>
      </PickerPopover>}
    </div>;
  }

  function History({ sessionId }: SessionProps) {
    const t = useText();
    const [snapshot, setSnapshot] = useState<{ sessionId: string; rows: HistoryEntry[]; error: TextMessage }>({ sessionId, rows: [], error: '' });
    const rows = snapshot.sessionId === sessionId ? snapshot.rows : [];
    const error = snapshot.sessionId === sessionId ? snapshot.error : '';
    useEffect(() => {
      const abort = new AbortController();
      const refresh = () => void rpc.history(sessionId, abort.signal).then(value => { if (!abort.signal.aborted) setSnapshot({ sessionId, rows: value, error: '' }); }).catch(e => { if (!abort.signal.aborted) setSnapshot(previous => ({ sessionId, rows: previous.sessionId === sessionId ? previous.rows : [], error: errorText(e) })); });
      refresh(); const timer = setInterval(refresh, 2000);
      return () => { abort.abort(); clearInterval(timer); };
    }, [sessionId]);
    return <details><summary>{t('Amoji 历史 · {count}', { count: rows.length })}</summary>{error && <p role="alert">{t(error)}</p>}{rows.map(row => <div key={row.meta.messageId}><MessageMedia rpc={rpc} sessionId={sessionId} meta={row.meta} /><span>{row.message.direction === 'human_to_ai' ? t("用户") : 'AI'} · {row.host ? t({ prepared: '待提交', unknown: '结果待核对', accepted: '已接纳', observed: '已观察到' }[row.host.status]) : t('工具消息')} · {t({ pending: '等待展示', rendered: '图片已展示', fallback: '固定文字回退' }[row.message.presentation])}</span></div>)}</details>;
  }
  function ToolContent({ sessionId, block, useChat }: SessionProps & { useChat?: (selector: (snapshot: { nodes: { values(): readonly { kind: string; data: unknown }[] } }) => boolean) => boolean; block?: { kind?: string; meta?: unknown; isError?: boolean; error?: { name?: string; code?: string }; content?: readonly { type: string; text?: string }[] } }) {
    const t = useText();
    const inFlow = useChat?.(snapshot => snapshot.nodes.values().some(node => node.kind === 'amoji-expressions' && Array.isArray(node.data) && node.data.some(meta => parseMeta(meta)?.messageId === parseMeta(block?.meta)?.messageId))) ?? false;
    if (block?.kind !== 'tool-result') return <span>{t("表情正在发送…")}</span>;
    const text = block.content?.filter(part => part.type === 'text' && typeof part.text === 'string').map(part => part.text).join('\n');
    if (block.isError) return <div role="alert"><p>{t("表情发送失败，可以继续用文字回应。")}</p><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{text || block.error?.code || block.error?.name || t("宿主未提供具体失败原因")}</pre></div>;
    const meta = parseMeta(block.meta);
    if (meta && inFlow) return <span>{t("表情已显示在对话中：")}{meta.alt}</span>;
    if (!meta) {
      const rejected = (() => { try { const value = JSON.parse(text ?? ''); return value?.status === 'rejected' ? String(value.reason) : undefined; } catch { return undefined; } })();
      if (rejected) return <p className="muted">{t('AI 表情未发送：{reason}', { reason: rejected })}</p>;
    }
    return meta ? <MessageMedia key={`${sessionId}:${meta.messageId}`} rpc={rpc} sessionId={sessionId} meta={meta} /> : <div><p>{t("表情结果已返回，但显示信息不可用。可以继续用文字回应。")}</p>{text && <details><summary>{t("查看工具文字结果")}</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{text}</pre></details>}</div>;
  }
  function ToolView(props: React.ComponentProps<typeof ToolContent>) { return <div className="amoji"><Styles/><ToolContent {...props}/></div>; }
  return { Picker, History, ToolView };
}
export const inject = ['slots', 'connection', 'uiConversation', 'locale'];
export function apply(ctx: ClientPort): void {
  const rpc = createRpc(ctx); const views = createComponents(rpc);
  ctx.effect(() => {
    const disposers: Array<() => void> = [];
    const dispose = () => { for (const release of disposers.splice(0).reverse()) release(); };
    try {
      if (ctx.locale) disposers.push(ctx.locale.register(AMOJI_LOCALE, { zh: { ...chinese, ...dictionaries.zh } as Record<keyof typeof english, string>, en: { ...english, ...dictionaries.en } }));
      const localized = (View: React.ComponentType<any>) => (props: any) => <AmojiLocaleProvider locale={ctx.locale} t={props.t}><View {...props}/></AmojiLocaleProvider>;
      const localeOptions = ctx.locale ? { locale: AMOJI_LOCALE } : {};
      if (ctx.uiConversation) disposers.push(ctx.uiConversation.events.register(aiExpressionDefinition));
      disposers.push(ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({ name: 'conversation.chat.node', key: 'amoji-expressions', ...localeOptions }, localized((props: any) => <AiExpressions {...props} rpc={rpc}/>))));
      disposers.push(ctx.slots.inject('conversation.input.left', () => ctx.slots.register({ name: 'conversation.input.left', id: 'amoji-picker', ...localeOptions }, localized(views.Picker))));
      disposers.push(ctx.slots.inject('conversation.chat.node', () => mountUserMessages(ctx.slots, rpc, ctx.locale)));
      disposers.push(ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({ name: 'tool.call.toolview', key: 'amoji_express', ...localeOptions }, localized(views.ToolView))));
    } catch (error) { dispose(); throw error; }
    return dispose;
  }, 'amoji: client slots');
}
