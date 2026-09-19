import { aiExpressionDefinition, AiExpressions } from './ai-messages.js';
import { Manager } from './manager.js';
import { Styles } from './ui.js';
import React, { useEffect, useRef, useState } from 'react';
import type { Expression, ExpressionRef } from '../sample-catalog.js';
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots';
import { PickerPopover } from './picker-popover.js';
import { mountUserMessages } from './messages.js';
import type { DshRpc, HistoryEntry, RpcResult } from './contracts.js';

export interface ClientPort {
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
import { AmojiImage, createRpc, parseMeta, errorText, sameRef } from './media.js';
export { AmojiImage, createRpc, parseMeta } from './media.js';
function deliveryText(row: HistoryEntry): string {
  if (row.host?.status === 'observed') return `已观察到会话用户消息${row.message?.presentation === 'rendered' ? '，图片已展示' : row.message?.presentation === 'fallback' ? '，当前使用固定文字回退' : '，图片展示尚待确认'}`;
  if (row.host?.status === 'accepted') return '宿主已接收入队，尚未确认用户消息落盘';
  if (row.host?.status === 'unknown') return '投递结果尚待核对；不会再次提交，请核对原会话。';
  return '尚未提交到宿主，可保留原选择重试。';
}
export function createComponents(rpc: DshRpc) {
  function Picker({ sessionId }: SessionProps) {
    const [managerSession,setManagerSession]=useState<string>(); const [managerOpen,setManagerOpen]=useState(false); const [refresh,setRefresh]=useState(0);
    return <><PickerSession key={sessionId} sessionId={sessionId} refresh={refresh} onManage={()=>{setManagerSession(v=>v??sessionId);setManagerOpen(true);}}/>{managerSession&&<Manager rpc={rpc} sessionId={managerSession} currentSessionId={sessionId} open={managerOpen} onClose={()=>{setManagerOpen(false);setRefresh(v=>v+1);}} onChanged={()=>setRefresh(v=>v+1)}/>}</>;
  }
  function PickerSession({ sessionId, onManage, refresh }: SessionProps & {onManage:()=>void;refresh:number}) {
    const anchor = useRef<HTMLButtonElement>(null);
    const [target, setTarget] = useState<string>(); const [catalog, setCatalog] = useState<Expression[]>([]); const [selected, setSelected] = useState<Expression>(); const [query, setQuery] = useState(''); const [searching, setSearching] = useState(false); const [searchStatus, setSearchStatus] = useState(''); const [requestId, setRequestId] = useState(''); const [busy, setBusy] = useState(false); const [status, setStatus] = useState('');
    const selectionEpoch = useRef(0);
    const [unavailable, setUnavailable] = useState(false); const [uncertain, setUncertain] = useState(false); const [sent, setSent] = useState<HistoryEntry>();
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
        setUnavailable(false); setCatalog(value); setSelected(previous => uncertain ? previous : previous && value.some(expression => sameRef(expression, previous)) ? previous : undefined);
        setSearchStatus(nextQuery.trim() ? (value.length ? `找到 ${value.length} 个候选。` : '没有合适的表情，可以继续用文字表达。') : `当前可选 ${value.length} 个表情。`);
      } catch (e) { if (current()) { setCatalog([]); setUnavailable(true); setSearchStatus(errorText(e)); } }
      finally { if (current()) setSearching(false); }
    };
    const send = async () => {
      if (!target || !selected || busy || unavailable) return;
      const owner = lifetime.current; const generation = owner.generation; const frozen = target; const signal = owner.abort.signal;
      const current = () => !signal.aborted && owner.generation === generation && owner.sessionId === frozen;
      setBusy(true); setStatus('');
      try {
        const result = await rpc.submit(frozen, { asset_id: selected.asset_id, revision_id: selected.revision_id }, requestId, signal);
        if (current()) { setSent(result); setUncertain(result.host?.status === 'unknown'); setStatus(deliveryText(result)); }
      } catch (e) { if (current()) { setStatus(errorText(e)); if (['CONNECTION_CLOSED', 'SERVICE_OUTCOME_UNKNOWN', 'DSH_OUTCOME_UNKNOWN'].includes((e as {code?:string}).code ?? '')) { setUncertain(true); setUnavailable(true); setCatalog([]); searchTask.current.generation++; searchTask.current.abort.abort(); setSearching(false); } } }
      finally { if (current()) setBusy(false); }
    };
    const check = async () => {
      if (!target || !sent?.meta?.messageId) return;
      const owner = lifetime.current; const generation = owner.generation; const frozen = target; const selection = selectionEpoch.current;
      try {
        const rows = await rpc.history(frozen, owner.abort.signal);
        if (owner.abort.signal.aborted || owner.generation !== generation || selection !== selectionEpoch.current) return;
        const row = rows.find(row => row.meta.messageId === sent.meta.messageId && row.host?.requestId === sent.host?.requestId);
        if (row) { setSent(row); setUncertain(row.host?.status === 'unknown'); setStatus(deliveryText(row)); }
        else setStatus('原消息暂时无法核对，请保留原选择，不要另发一次。');
      } catch (e) { if (!owner.abort.signal.aborted && owner.generation === generation && selection === selectionEpoch.current) setStatus(errorText(e)); }
    };
    useEffect(() => {
      if (!target || !sent?.meta?.messageId || sent.host?.status === 'observed') return;
      let remaining = 30;
      const timer = setInterval(() => { if (remaining-- > 0) void check(); else clearInterval(timer); }, 2000);
      return () => clearInterval(timer);
    }, [target, sent?.meta?.messageId, sent?.host?.status]);
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
    return <div className="amoji" style={{ position: 'relative' }}><Styles/><button ref={anchor} type="button" disabled={busy} onClick={() => { selectionEpoch.current++; setTarget(sessionId); if (uncertain) return; setQuery(''); setSelected(undefined); setSent(undefined); setStatus(''); }}>表情</button>{target === sessionId && <PickerPopover anchor={anchor}>
      <p>发送到当前会话</p>
      <button type="button" onClick={onManage}>管理表情</button>
      <form className="row" aria-label="搜索 Amoji" onSubmit={event => { event.preventDefault(); void load(query); }}>
        <input aria-label="搜索表情" value={query} onInput={event => setQuery(event.currentTarget.value)} placeholder="按名称、标签或语境搜索" />
        <button type="submit" disabled={busy || uncertain}>{searching ? '搜索中…' : '搜索'}</button>
        <button type="button" disabled={busy || uncertain} onClick={() => { setQuery(''); void load(''); }}>显示全部</button>
      </form>
      <p aria-live="polite">{searchStatus}</p>
      <div className="grid">{catalog.map(e => <div className="tile" key={`${e.asset_id}:${e.revision_id}`}><AmojiImage rpc={rpc} sessionId={target} refValue={e} /><button type="button" disabled={busy || unavailable || uncertain} aria-pressed={sameRef(e, selected ?? { asset_id: '', revision_id: '' })} onClick={() => { selectionEpoch.current++; setSelected(e); setRequestId(crypto.randomUUID()); setSent(undefined); setStatus(''); }}>{e.name}</button></div>)}</div>
      {selected && <section aria-label="固定语义与精确版本"><h3>{selected.name}</h3><p>{selected.semantics.meaning}</p>{selected.semantics.tone && <p>{selected.semantics.tone}</p>}{selected.semantics.use_when?.length ? <p>适用于：{selected.semantics.use_when.join('；')}</p> : null}{selected.semantics.avoid_when?.length ? <p>不适用于：{selected.semantics.avoid_when.join('；')}</p> : null}<details><summary>查看完整固定语义与版本</summary><pre>{JSON.stringify({ asset_id: selected.asset_id, revision_id: selected.revision_id, name: selected.name, semantics: selected.semantics }, null, 2)}</pre></details></section>}<button type="button" disabled={!selected || busy || unavailable} onClick={() => void send()}>{busy ? '发送中…' : '发送所选表情'}</button><button type="button" onClick={() => { searchTask.current.generation++; searchTask.current.abort.abort(); selectionEpoch.current++; setTarget(undefined); }}>关闭</button><p role="status">{status}</p>{sent?.meta?.messageId && <button type="button" disabled={busy} onClick={() => void check()}>核对投递状态</button>}{rpc.reconnect && <button type="button" disabled={busy} onClick={() => void recover()}>重新连接并核对</button>}
    </PickerPopover>}</div>;
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
  function ToolView({ sessionId, block, useChat }: SessionProps & { useChat?: (selector: (snapshot: {nodes:{values():readonly {kind:string;data:unknown}[]}}) => boolean) => boolean; block?: { kind?: string; meta?: unknown; isError?: boolean; error?: { name?: string; code?: string }; content?: readonly { type: string; text?: string }[] } }) {
    const inFlow = useChat?.(snapshot => snapshot.nodes.values().some(node => node.kind === 'amoji-expressions' && Array.isArray(node.data) && node.data.some(meta => parseMeta(meta)?.messageId === parseMeta(block?.meta)?.messageId))) ?? false;
    if (block?.kind !== 'tool-result') return <span>表情正在发送…</span>;
    const text = block.content?.filter(part => part.type === 'text' && typeof part.text === 'string').map(part => part.text).join('\n');
    if (block.isError) return <div role="alert"><p>表情发送失败，可以继续用文字回应。</p><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{text || block.error?.code || block.error?.name || '宿主未提供具体失败原因'}</pre></div>;
    const meta = parseMeta(block.meta);
    if (meta && inFlow) return <span>表情已显示在对话中：{meta.alt}</span>;
    return meta ? <AmojiImage key={`${sessionId}:${meta.messageId}`} rpc={rpc} sessionId={sessionId} refValue={meta.ref} meta={meta} /> : <div><p>表情结果已返回，但显示信息不可用。可以继续用文字回应。</p>{text && <details><summary>查看工具文字结果</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{text}</pre></details>}</div>;
  }
  return { Picker, History, ToolView };
}
export const inject = ['slots', 'connection', 'uiConversation'];
export function apply(ctx: ClientPort): void {
  const rpc = createRpc(ctx); const views = createComponents(rpc);
  ctx.effect(() => {
    const disposers: Array<() => void> = [];
    const dispose = () => { for (const release of disposers.splice(0).reverse()) release(); };
    try {
      if (ctx.uiConversation) disposers.push(ctx.uiConversation.events.register(aiExpressionDefinition));
      disposers.push(ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({name:'conversation.chat.node',key:'amoji-expressions'}, (props:any)=><AiExpressions {...props} rpc={rpc}/>)));
      disposers.push(ctx.slots.inject('conversation.input.left', () => ctx.slots.register({ name: 'conversation.input.left', id: 'amoji-picker' }, views.Picker)));
      disposers.push(ctx.slots.inject('conversation.chat.node', () => mountUserMessages(ctx.slots, rpc)));
      disposers.push(ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({ name: 'tool.call.toolview', key: 'amoji_emit' }, views.ToolView)));
    } catch (error) { dispose(); throw error; }
    return dispose;
  }, 'amoji: client slots');
}
