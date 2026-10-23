import { useText, useUiLocale, AmojiLocaleProvider, type AmojiLocale, type TextMessage } from './i18n.js';
import { actGloss, expressionText } from '../protocol/index.js';
import React, { useEffect, useState } from 'react';
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots';
import type { ClientPort } from './client.js';
import type { DshRpc, HistoryEntry } from './contracts.js';
import { expressionPresentationContent } from './expression-message.js';
import { Styles } from './ui.js';
import { MessageMedia, errorText } from './media.js';

interface UserProps { sessionId: string; node: { data: { seq?: number; content?: unknown; referenceLabels?: readonly string[]; skillNames?: readonly string[]; source?: { kind?: string; rpcId?: string } } } }
function UserMessage({ rpc, props, messageId, Original }: { rpc: DshRpc; props: UserProps; messageId: string; Original: React.ComponentType<UserProps> }) {
 const t=useText(); const locale=useUiLocale();
  const { sessionId } = props; const seq = props.node.data.seq;
  const [busy, setBusy] = useState(false);
  const [row, setRow] = useState<HistoryEntry>(); const [error, setError] = useState<TextMessage>('');
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
  const visible = row ? { ...props, node: { ...props.node, data: { ...props.node.data, content: expressionPresentationContent(props.node.data.content, row.message) } } } : props;
  if (!row) return error ? <><Original {...props}/><small role="alert">{t(error)}</small></> : <div className="amoji amoji-message amoji-message-human"><Styles/><span className="muted" role="status">{t("正在加载表情…")}</span></div>;
  const content = visible.node.data.content;
  const hasOtherContent = !Array.isArray(content) || content.length > 0 ||
    !!props.node.data.referenceLabels?.length || !!props.node.data.skillNames?.length;
  return <>{hasOtherContent && <Original {...visible}/>}
    <div className="amoji amoji-message amoji-message-human"><Styles/>
      <MessageMedia rpc={rpc} sessionId={sessionId} meta={row.meta}/>
      {row.message.note && <p className="amoji-note-text">{row.message.note}</p>}
      {row.message.anchor?.exact && <blockquote className="amoji-anchor">{row.message.anchor.exact}{row.message.anchor_degraded && <small> · {t("原文已变化，已改为指向整条消息")}</small>}</blockquote>}
      <details className="amoji-message-detail"><summary>{t("表情含义")}</summary><strong>{actGloss(row.message.act,'h2a',locale).text}</strong>{row.message.revision && (() => { const text = expressionText(row.message.revision, locale); return <><p lang={text.locale}>{text.name} · {text.meaning}</p><small>{t('固定版本 {revision}',{revision:row.message.revision.revision_id})}</small></>; })()}</details>
      {row.message.retracted_at ? <small className="muted">{t("已撤回")}</small> : rpc.retract && <button className="quiet" type="button" disabled={busy} onClick={() => { setBusy(true); void rpc.retract!(sessionId, row.message.message_id).then(rows => { const next = rows.find(r => r.message.message_id === row.message.message_id); if (next) setRow(next); }).catch(e => setError(errorText(e))).finally(() => setBusy(false)); }}>{t("撤回")}</button>}
    </div>
  </>;

}

/** Public entry inspection + shadow priority; never copy the host's message UI. */
export function mountUserMessages(slots: ClientPort['slots'], rpc: DshRpc, locale?: AmojiLocale): () => void {
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
        return messageId ? <AmojiLocaleProvider locale={locale}><UserMessage key={`${props.sessionId}:${messageId}:${props.node.data.seq}`} rpc={rpc} props={props} messageId={messageId} Original={Original} /></AmojiLocaleProvider> : <Original {...props} />;
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
