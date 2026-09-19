import React, { useEffect, useState } from 'react';
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots';
import type { ClientPort } from './client.js';
import type { DshRpc, HistoryEntry } from './contracts.js';
import { expressionPresentationContent } from './expression-message.js';
import { modelProjection } from '../projection.js';
import { AmojiImage, errorText } from './media.js';

interface UserProps { sessionId: string; node: { data: { seq?: number; content?: unknown; source?: { kind?: string; rpcId?: string } } } }
function UserMessage({ rpc, props, messageId, Original }: { rpc: DshRpc; props: UserProps; messageId: string; Original: React.ComponentType<UserProps> }) {
  const { sessionId } = props; const seq = props.node.data.seq;
  const [row, setRow] = useState<HistoryEntry>(); const [error, setError] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    void rpc.history(sessionId, abort.signal).then(rows => {
      if (abort.signal.aborted) return;
      const found = rows.find(value => value.message.direction === 'human_to_ai' && value.meta.messageId === messageId && value.host?.status === 'observed' && value.host.requestId === `amoji:${messageId}` && value.host.seq === seq);
      if (!found) throw new Error('表情关联不可用，保留原消息');
      setRow(found);
    }).catch(reason => { if (!abort.signal.aborted) setError(errorText(reason)); });
    return () => abort.abort();
  }, [rpc, sessionId, messageId, seq]);
  const visible = row ? { ...props, node: { ...props.node, data: { ...props.node.data, content: expressionPresentationContent(props.node.data.content, row.message.revision) } } } : props;
  return <><Original {...visible} />{row ? <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
    <AmojiImage rpc={rpc} sessionId={sessionId} refValue={row.meta.ref} meta={row.meta} />
    <details><summary>固定语义与版本详情</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(JSON.parse(modelProjection(row.message.revision)), null, 2)}</pre></details>
  </div> : error ? <small role="alert">{error}</small> : <span>表情加载中…</span>}</>;
}

/** Public entry inspection + shadow priority; never copy the host's message UI. */
export function mountUserMessages(slots: ClientPort['slots'], rpc: DshRpc): () => void {
  const name = 'conversation.chat.node'; const owners = new Map<string, { original: StoredEntry; component: React.ComponentType<any>; dispose(): void }>();
  let active = true;
  const refresh = () => {
    if (!active) return;
    for (const key of ['user', 'steering']) {
      const ours = owners.get(key);
      const original = slots.entries(name).filter(entry => entry.options.key === key && entry.component !== ours?.component).sort((a, b) => (a.options.priority ?? 0) - (b.options.priority ?? 0))[0];
      if (original === ours?.original) continue;
      ours?.dispose(); owners.delete(key);
      if (!original) continue; // Declaration may arrive before its shipped renderer.
      if (original.children) throw new Error('Amoji cannot safely wrap a user renderer declaring child slots');
      const Original = original.component as React.ComponentType<UserProps>;
      const Wrapped = (props: UserProps) => {
        const source = props.node.data.source;
        const messageId = source?.kind === 'user' && source.rpcId?.startsWith('amoji:') ? source.rpcId.slice(6) : undefined;
        return messageId ? <UserMessage key={`${props.sessionId}:${messageId}:${props.node.data.seq}`} rpc={rpc} props={props} messageId={messageId} Original={Original} /> : <Original {...props} />;
      };
      const dispose = slots.register({ name, key, priority: (original.options.priority ?? 0) - 1, ...(original.locale ? { locale: original.locale } : {}), ...(original.inject ? { inject: original.inject } : {}), ...(original.store ? { store: original.store } : {}) }, Wrapped);
      owners.set(key, { original, component: Wrapped, dispose });
    }
  };
  const unsubscribe = slots.subscribe(name, refresh);
  const dispose = () => { active = false; unsubscribe(); for (const owner of owners.values()) owner.dispose(); owners.clear(); };
  try { refresh(); } catch (error) { dispose(); throw error; }
  return dispose;
}
