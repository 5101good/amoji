import React, { useEffect, useState } from 'react';
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots';
import type { ClientPort } from './client.js';
import type { DshRpc, VisualMeta } from './contracts.js';
import { AmojiImage, errorText } from './media.js';

interface UserProps { sessionId: string; node: { data: { source?: { kind?: string; rpcId?: string } } } }
function UserImage({ rpc, sessionId, messageId }: { rpc: DshRpc; sessionId: string; messageId: string }) {
  const [meta, setMeta] = useState<VisualMeta>(); const [error, setError] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    void rpc.history(sessionId, abort.signal).then(rows => {
      if (abort.signal.aborted) return;
      const row = rows.find(value => value.message.direction === 'human_to_ai' && value.meta.messageId === messageId && value.host?.status === 'observed');
      if (!row) throw new Error('表情关联不可用，保留原消息');
      setMeta(row.meta);
    }).catch(reason => { if (!abort.signal.aborted) setError(errorText(reason)); });
    return () => abort.abort();
  }, [rpc, sessionId, messageId]);
  return meta ? <AmojiImage rpc={rpc} sessionId={sessionId} refValue={meta.ref} meta={meta} /> : error ? <small role="alert">{error}</small> : <span>表情加载中…</span>;
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
        return <><Original {...props} />{messageId && <div style={{ display: 'flex', justifyContent: 'flex-end' }}><UserImage key={`${props.sessionId}:${messageId}`} rpc={rpc} sessionId={props.sessionId} messageId={messageId} /></div>}</>;
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
