import { aiExpressionDefinition, AiExpressions } from './ai-messages.js';
import { Manager } from './manager.js';
import { Styles, CloseIcon, SmileIcon, ExpressionTile } from './ui.js';
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
  // Keep unresolved identities beyond a keyed PickerSession's lifetime. A UI abort
  // cannot tell us whether the host already accepted the original submission.
  const pendingSelections = new Map<string, {selected: Expression; requestId: string; sent?: HistoryEntry}>();
  function Picker({ sessionId }: SessionProps) {
    const [reopen,setReopen]=useState(0); const [managerSession,setManagerSession]=useState<string>(); const [managerOpen,setManagerOpen]=useState(false); const [refresh,setRefresh]=useState(0);
    return <><PickerSession key={sessionId} sessionId={sessionId} refresh={refresh} reopen={reopen} onManage={()=>{setManagerSession(v=>v??sessionId);setManagerOpen(true);}}/>{managerSession&&<Manager rpc={rpc} sessionId={managerSession} currentSessionId={sessionId} open={managerOpen} onClose={()=>{setManagerOpen(false);setRefresh(v=>v+1);setReopen(v=>v+1);}} onChanged={()=>setRefresh(v=>v+1)}/>}</>;
  }
  function PickerSession({ sessionId, onManage, refresh, reopen }: SessionProps & {onManage:()=>void;refresh:number;reopen:number}) {
    const pending = pendingSelections.get(sessionId);
    const anchor = useRef<HTMLButtonElement>(null);
    const [target, setTarget] = useState<string>(); const [catalog, setCatalog] = useState<Expression[]>([]); const [selected, setSelected] = useState<Expression | undefined>(pending?.selected); const [query, setQuery] = useState(''); const [searching, setSearching] = useState(false); const [searchStatus, setSearchStatus] = useState(''); const [requestId, setRequestId] = useState(pending?.requestId ?? ''); const [busy, setBusy] = useState(false); const [status, setStatus] = useState(pending ? '原投递结果尚待核对，请重新连接并核对原请求。' : '');
    const previousReopen = useRef(reopen);
    useEffect(()=>{if(previousReopen.current !== reopen){previousReopen.current = reopen;setTarget(sessionId);}},[reopen,sessionId]);
    const [category,setCategory]=useState('全部');
    const categoryOf=(e:Expression)=>e.tags?.find(t=>t.startsWith('协作:'))?.slice(3)||'其他';
    const categories=['进度','澄清','方向','反馈','其他'].filter(c=>catalog.some(e=>categoryOf(e)===c));
    const visibleCatalog=category==='全部'?catalog:catalog.filter(e=>categoryOf(e)===category);
    const selectionEpoch = useRef(0);
    const [unavailable, setUnavailable] = useState(!!pending); const [uncertain, setUncertain] = useState(!!pending); const [sent, setSent] = useState<HistoryEntry | undefined>(pending?.sent);
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
      const identity = { selected, requestId, sent };
      pendingSelections.set(frozen, identity);
      setBusy(true); setStatus('');
      try {
        const result = await rpc.submit(frozen, { asset_id: selected.asset_id, revision_id: selected.revision_id }, requestId, signal);
        if (pendingSelections.get(frozen) === identity) {
          if (result.host?.status === 'unknown') identity.sent = result;
          else pendingSelections.delete(frozen);
        }
        if (current()) {
          setSent(result); setUncertain(result.host?.status === 'unknown'); setStatus(deliveryText(result));
          if (result.host?.status === 'accepted' || result.host?.status === 'observed') {
            setSelected(undefined); setTarget(undefined); anchor.current?.focus({ preventScroll: true });
          }
        }
      } catch (e) {
        const unknown = signal.aborted || ['CONNECTION_CLOSED', 'SERVICE_OUTCOME_UNKNOWN', 'DSH_OUTCOME_UNKNOWN'].includes((e as {code?:string}).code ?? '');
        if (!unknown && pendingSelections.get(frozen) === identity) pendingSelections.delete(frozen);
        if (current()) { setStatus(errorText(e)); if (['CONNECTION_CLOSED', 'SERVICE_OUTCOME_UNKNOWN', 'DSH_OUTCOME_UNKNOWN'].includes((e as {code?:string}).code ?? '')) { setUncertain(true); setUnavailable(true); setCatalog([]); searchTask.current.generation++; searchTask.current.abort.abort(); setSearching(false); } } }
      finally { if (current()) setBusy(false); }
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
          setSent(row); setUncertain(row.host?.status === 'unknown'); setStatus(deliveryText(row)); }
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
    const dismiss = (restoreFocus = true) => {
      searchTask.current.generation++; searchTask.current.abort.abort(); selectionEpoch.current++;
      setTarget(undefined);
      if (restoreFocus) anchor.current?.focus({ preventScroll: true });
    };
    return <div className="amoji amoji-composer"><Styles/>
      <button ref={anchor} className="amoji-trigger" type="button" aria-label="表情" aria-haspopup="dialog" aria-expanded={target === sessionId} onClick={() => {
        if (target === sessionId) { dismiss(); return; }
        selectionEpoch.current++; setTarget(sessionId);
        if (uncertain || busy) return;
        setQuery(''); setCategory('全部'); setSelected(undefined);
      }}><SmileIcon/><span>表情</span></button>
      {target === sessionId && <PickerPopover anchor={anchor} onDismiss={dismiss}>
        <header className="amoji-picker-head"><h2>用表情表达</h2><div className="row"><button className="quiet" type="button" onClick={()=>{dismiss(false);onManage();}}>管理表情</button><button className="icon-button" type="button" aria-label="关闭" onClick={()=>dismiss()}><CloseIcon/></button></div></header>
        <form className="amoji-picker-search" aria-label="搜索 Amoji" onSubmit={event => { event.preventDefault(); setCategory('全部'); void load(query); }}>
          <input aria-label="搜索表情" value={query} onInput={event => setQuery(event.currentTarget.value)} placeholder="想表达什么？" />
          <button type="submit" disabled={busy || uncertain}>{searching ? '搜索中…' : '搜索'}</button>
          {query && <button className="quiet" type="button" disabled={busy || uncertain} onClick={() => { setQuery(''); void load(''); }}>显示全部</button>}
        </form>
        {categories.some(c=>c!=='其他') && <nav className="amoji-categories" aria-label="表情场景">{['全部',...categories].map(c=><button className="quiet" type="button" key={c} aria-pressed={category===c} disabled={busy||uncertain} onClick={()=>{setCategory(c);setSelected(undefined);setSent(undefined);setStatus('');selectionEpoch.current++;}}>{c}</button>)}</nav>}
        <div className="amoji-picker-body" aria-busy={searching}>
          {visibleCatalog.length ? <div className="amoji-expression-grid">{visibleCatalog.map(e => <ExpressionTile key={`${e.asset_id}:${e.revision_id}`} rpc={rpc} sessionId={target} expression={e} disabled={busy || unavailable || uncertain} selected={sameRef(e, selected ?? {asset_id:'',revision_id:''})} onSelect={()=>{selectionEpoch.current++;setSelected(e);setRequestId(crypto.randomUUID());setSent(undefined);setStatus('');}} />)}</div> : <p className="amoji-empty">{searching ? '正在打开表情库…' : searchStatus || '暂无可用表情，可以在管理中添加。'}</p>}
        </div>
        <footer className="amoji-picker-footer">
          {selected ? <section className="amoji-selection" aria-label="固定语义与精确版本"><strong>{selected.name}</strong><p>{selected.semantics.meaning}</p><details><summary>查看含义与适用场景</summary><p>{selected.semantics.tone}</p><p>{selected.semantics.use_when?.join('；')}</p><p>{selected.semantics.avoid_when?.join('；')}</p><small>版本 {selected.revision_id}</small></details></section> : <p className="muted">选一张表情，看看它想表达什么。</p>}
          {!sent && status && <p className="amoji-notice" role="status">{status}</p>}
          {sent && !uncertain && <details className="amoji-notice"><summary>上次发送记录</summary><p role="status">{status}</p><button type="button" disabled={busy} onClick={()=>void check()}>核对投递状态</button></details>}
          {sent && uncertain && <p className="amoji-notice" role="status">{status}</p>}
          {(unavailable || uncertain) && <div className="row">{sent?.meta?.messageId && <button type="button" disabled={busy} onClick={()=>void check()}>核对投递状态</button>}{rpc.reconnect && <button type="button" disabled={busy} onClick={()=>void recover()}>重新连接并核对</button>}</div>}
        </footer>
          <div className="amoji-send-row"><span className="muted" aria-live="polite">{catalog.length ? `${visibleCatalog.length} 个表情` : ''}</span><button className="primary" type="button" disabled={!selected || busy || unavailable} onClick={() => void send()}>{busy ? '发送中…' : '发送所选表情'}</button></div>
      </PickerPopover>}
    </div>;
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
  function ToolContent({ sessionId, block, useChat }: SessionProps & { useChat?: (selector: (snapshot: {nodes:{values():readonly {kind:string;data:unknown}[]}}) => boolean) => boolean; block?: { kind?: string; meta?: unknown; isError?: boolean; error?: { name?: string; code?: string }; content?: readonly { type: string; text?: string }[] } }) {
    const inFlow = useChat?.(snapshot => snapshot.nodes.values().some(node => node.kind === 'amoji-expressions' && Array.isArray(node.data) && node.data.some(meta => parseMeta(meta)?.messageId === parseMeta(block?.meta)?.messageId))) ?? false;
    if (block?.kind !== 'tool-result') return <span>表情正在发送…</span>;
    const text = block.content?.filter(part => part.type === 'text' && typeof part.text === 'string').map(part => part.text).join('\n');
    if (block.isError) return <div role="alert"><p>表情发送失败，可以继续用文字回应。</p><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{text || block.error?.code || block.error?.name || '宿主未提供具体失败原因'}</pre></div>;
    const meta = parseMeta(block.meta);
    if (meta && inFlow) return <span>表情已显示在对话中：{meta.alt}</span>;
    return meta ? <AmojiImage key={`${sessionId}:${meta.messageId}`} rpc={rpc} sessionId={sessionId} refValue={meta.ref} meta={meta} /> : <div><p>表情结果已返回，但显示信息不可用。可以继续用文字回应。</p>{text && <details><summary>查看工具文字结果</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{text}</pre></details>}</div>;
  }
  function ToolView(props: React.ComponentProps<typeof ToolContent>) { return <div className="amoji"><Styles/><ToolContent {...props}/></div>; }
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
