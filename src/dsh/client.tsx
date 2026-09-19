import React, { useEffect, useRef, useState } from 'react';
import type { Expression, ExpressionRef } from '../sample-catalog.js';
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots';
import { mountUserMessages } from './messages.js';
import type { DshRpc, HistoryEntry, RpcResult } from './contracts.js';

export interface ClientPort {
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
import { AmojiImage, createRpc, parseMeta, errorText, sameRef } from './media.js';
export { AmojiImage, createRpc, parseMeta } from './media.js';
export function createComponents(rpc: DshRpc) {
  function Picker({ sessionId }: SessionProps) { return <PickerSession key={sessionId} sessionId={sessionId} />; }
  function PickerSession({ sessionId }: SessionProps) {
    const [target, setTarget] = useState<string>(); const [catalog, setCatalog] = useState<Expression[]>([]); const [selected, setSelected] = useState<Expression>(); const [query, setQuery] = useState(''); const [searching, setSearching] = useState(false); const [searchStatus, setSearchStatus] = useState(''); const [requestId, setRequestId] = useState(''); const [busy, setBusy] = useState(false); const [status, setStatus] = useState(''); const [managementUrl, setManagementUrl] = useState('');
    const lifetime = useRef({ sessionId, generation: 0, abort: new AbortController() });
    const searchTask = useRef({ generation: 0, abort: new AbortController() });
    useEffect(() => {
      const owner = lifetime.current; owner.generation++; owner.abort = new AbortController();
      return () => { owner.generation++; owner.abort.abort(); };
    }, [sessionId]);
    useEffect(() => {
      if (!target) return;
      void load('');
      return () => { searchTask.current.generation++; searchTask.current.abort.abort(); };
    }, [target]);
    const load = async (nextQuery: string) => {
      if (!target) return;
      const owner = lifetime.current; const ownerGeneration = owner.generation; const frozen = target; const task = searchTask.current;
      task.generation++; task.abort.abort(); task.abort = new AbortController();
      const taskGeneration = task.generation; const signal = AbortSignal.any([owner.abort.signal, task.abort.signal]);
      const current = () => !signal.aborted && owner.generation === ownerGeneration && owner.sessionId === frozen && task.generation === taskGeneration;
      setSearching(true); setSearchStatus('');
      try {
        const value = nextQuery.trim() ? await rpc.search(frozen, nextQuery, 5, signal) : await rpc.catalog(frozen, signal);
        if (!current()) return;
        setCatalog(value); setSelected(previous => previous && value.some(expression => sameRef(expression, previous)) ? previous : undefined);
        setSearchStatus(nextQuery.trim() ? (value.length ? `找到 ${value.length} 个候选。` : '没有合适的表情，可以继续用文字表达。') : `当前可选 ${value.length} 个表情。`);
      } catch (e) { if (current()) setSearchStatus(errorText(e)); }
      finally { if (current()) setSearching(false); }
    };
    const manage = async () => {
      if (!target) return;
      const owner = lifetime.current; const generation = owner.generation; const frozen = target; const signal = owner.abort.signal;
      setManagementUrl('');
      try {
        const result = await rpc.manage(frozen, signal);
        if (!signal.aborted && owner.generation === generation && owner.sessionId === frozen) setManagementUrl(result.url);
      } catch (error) { if (!signal.aborted && owner.generation === generation) setStatus(errorText(error)); }
    };
    const send = async () => {
      if (!target || !selected || busy) return;
      const owner = lifetime.current; const generation = owner.generation; const frozen = target; const signal = owner.abort.signal;
      const current = () => !signal.aborted && owner.generation === generation && owner.sessionId === frozen;
      setBusy(true); setStatus('');
      try {
        const result = await rpc.submit(frozen, { asset_id: selected.asset_id, revision_id: selected.revision_id }, requestId, signal);
        if (current()) setStatus(result.host?.status === 'observed' ? '已观察到会话用户消息' : '宿主已接收入队，尚未确认用户消息落盘');
      } catch (e) { if (current()) setStatus(errorText(e)); }
      finally { if (current()) setBusy(false); }
    };
    return <div style={{ position: 'relative' }}><button type="button" onClick={() => { setTarget(sessionId); setQuery(''); setSelected(undefined); setStatus(''); }}>表情</button>{target === sessionId && <section aria-label="Amoji 表情选择" style={{ position: 'absolute', bottom: '100%', left: 0, zIndex: 30, width: 'min(420px, 80vw)', maxHeight: '65vh', overflow: 'auto', padding: 16, borderRadius: 12, border: '1px solid var(--dsw-alias-border-l, #8886)', background: 'var(--dsw-alias-bg-module-platform, Canvas)', color: 'inherit', boxShadow: '0 8px 32px #0002' }}>
      <p>发送到当前会话</p>
      <button type="button" onClick={() => void manage()}>创建自己的表情</button>
      {managementUrl && <p><a aria-label="打开创建面板" href={managementUrl} target="_blank" rel="noreferrer">打开创建面板</a> · 确认后返回这里，点击“显示全部”刷新共享库。</p>}
      <form aria-label="搜索 Amoji" onSubmit={event => { event.preventDefault(); void load(query); }}>
        <input aria-label="搜索表情" value={query} onInput={event => setQuery(event.currentTarget.value)} placeholder="按名称、标签或语境搜索" />
        <button type="submit">{searching ? '搜索中…' : '搜索'}</button>
        <button type="button" onClick={() => { setQuery(''); void load(''); }}>显示全部</button>
      </form>
      <p aria-live="polite">{searchStatus}</p>
      <div style={{ display: 'flex', flexWrap: 'wrap' }}>{catalog.map(e => <div key={`${e.asset_id}:${e.revision_id}`}><AmojiImage rpc={rpc} sessionId={target} refValue={e} /><button type="button" disabled={busy} aria-pressed={sameRef(e, selected ?? { asset_id: '', revision_id: '' })} onClick={() => { setSelected(e); setRequestId(crypto.randomUUID()); setStatus(''); }}>{e.name}</button></div>)}</div>
      {selected && <section aria-label="固定语义与精确版本"><h3>{selected.name}</h3><p>{selected.semantics.meaning}</p>{selected.semantics.tone && <p>{selected.semantics.tone}</p>}{selected.semantics.use_when?.length ? <p>适用于：{selected.semantics.use_when.join('；')}</p> : null}{selected.semantics.avoid_when?.length ? <p>不适用于：{selected.semantics.avoid_when.join('；')}</p> : null}<details><summary>查看完整固定语义与版本</summary><pre>{JSON.stringify({ asset_id: selected.asset_id, revision_id: selected.revision_id, name: selected.name, semantics: selected.semantics }, null, 2)}</pre></details></section>}<button type="button" disabled={!selected || busy} onClick={() => void send()}>{busy ? '发送中…' : '发送所选表情'}</button><button type="button" onClick={() => { searchTask.current.generation++; searchTask.current.abort.abort(); setTarget(undefined); }}>关闭</button><p role="status">{status}</p>
    </section>}</div>;
  }
  function History({ sessionId }: SessionProps) {
    const [snapshot, setSnapshot] = useState<{ sessionId: string; rows: HistoryEntry[]; error: string }>({ sessionId, rows: [], error: '' });
    const rows = snapshot.sessionId === sessionId ? snapshot.rows : [];
    const error = snapshot.sessionId === sessionId ? snapshot.error : '';
    useEffect(() => {
      const abort = new AbortController();
      const refresh = () => void rpc.history(sessionId, abort.signal).then(value => { if (!abort.signal.aborted) setSnapshot({ sessionId, rows: value, error: '' }); }).catch(e => { if (!abort.signal.aborted) setSnapshot(previous => ({ sessionId, rows: previous.sessionId === sessionId ? previous.rows : [], error: errorText(e) })); });
      refresh(); const timer = setInterval(refresh, 2000);
      return () => { abort.abort(); clearInterval(timer); };
    }, [sessionId]);
    return <details><summary>Amoji 历史 · {rows.length}</summary>{error && <p role="alert">{error}</p>}{rows.map(row => <div key={row.meta.messageId}><AmojiImage rpc={rpc} sessionId={sessionId} refValue={row.meta.ref} meta={row.meta} /><span>{row.message.direction === 'human_to_ai' ? '用户' : 'AI'} · {row.host?.status ?? '工具消息'} · {row.message.presentation}</span></div>)}</details>;
  }
  function ToolView({ sessionId, block }: SessionProps & { block?: { kind?: string; meta?: unknown } }) { const meta = block?.kind === 'tool-result' ? parseMeta(block.meta) : undefined; return meta ? <AmojiImage key={`${sessionId}:${meta.messageId}`} rpc={rpc} sessionId={sessionId} refValue={meta.ref} meta={meta} /> : <span>表情等待结果或元数据不合法</span>; }
  return { Picker, History, ToolView };
}
export const inject = ['slots', 'connection'];
export function apply(ctx: ClientPort): void {
  const rpc = createRpc(ctx); const views = createComponents(rpc);
  ctx.effect(() => {
    const disposers: Array<() => void> = [];
    const dispose = () => { for (const release of disposers.splice(0).reverse()) release(); };
    try {
      disposers.push(ctx.slots.inject('conversation.input.left', () => ctx.slots.register({ name: 'conversation.input.left', id: 'amoji-picker' }, views.Picker)));
      disposers.push(ctx.slots.inject('conversation.chat.node', () => mountUserMessages(ctx.slots, rpc)));
      disposers.push(ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({ name: 'tool.call.toolview', key: 'amoji_emit' }, views.ToolView)));
    } catch (error) { dispose(); throw error; }
    return dispose;
  }, 'amoji: client slots');
}
