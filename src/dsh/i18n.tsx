import React, { createContext, useContext, useMemo, useSyncExternalStore } from 'react';
import type { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client';
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots';
import { errorEnglish } from './i18n-errors.js';
import { english } from './i18n-dictionary.js';

export const AMOJI_LOCALE = 'amoji';
export type AmojiLocale = Pick<LocaleRuntime, 'register' | 'bind' | 'getSnapshot' | 'subscribe'>;
export type TextMessage = string | { key: string; params: Record<string, unknown>; errorCode?: string };
export const message = (key: string, params: Record<string, unknown>): TextMessage => ({ key, params });
export const dictionaries = {zh: {...Object.fromEntries(Object.keys(errorEnglish).map(code => ['error.'+code, '{detail}']))}, en: {...Object.fromEntries(Object.entries(errorEnglish).map(([code,text]) => ['error.'+code, text]))}};
export function errorMessage(error: unknown, raw?: string): TextMessage {
 const e=error as {code?:string;message?:string}|undefined;
 const key=raw ?? (typeof e?.message==='string'?e.message:'操作失败');
 const errorCode=e?.code ?? key.match(/^([A-Z][A-Z_]+)(?:[:：]|$)/)?.[1];
 return errorCode && errorEnglish[errorCode] ? {key,params:{},errorCode} : key;
}
export const chinese = Object.fromEntries(Object.keys(english).map(key => [key, key]));
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { amoji: keyof typeof english }
}
const fallback: Translate = (key, params) => key.replace(/\{(\w+)\}/g, (match, name: string) => String(params?.[name] ?? match));
const TextContext = createContext<Translate>(fallback);
const defaultSnapshot = { revision: 0 };
const noopSubscribe = () => () => {};
/** Observe the native locale without changing the user's host preference. */
export function AmojiLocaleProvider({ locale, t, children }: { locale?: AmojiLocale; t?: Translate; children: React.ReactNode }) {
  const binding = useMemo(() => ({
    subscribe: locale ? (listener: () => void) => locale.subscribe(listener) : noopSubscribe,
    snapshot: locale ? () => locale.getSnapshot() : () => defaultSnapshot,
  }), [locale]);
  const snapshot = useSyncExternalStore(binding.subscribe, binding.snapshot, binding.snapshot);
  const translate = useMemo<Translate>(() => {
    const bound: Translate = t ?? (locale?.bind(AMOJI_LOCALE) as Translate | undefined) ?? fallback;
    return (key, params) => bound(key, params);
  }, [locale, t, snapshot.revision]);
  return <TextContext.Provider value={translate}>{children}</TextContext.Provider>;
}
/** Only UI-owned copy reaches this function; semantic fields remain untouched. */
export function useText() {
  const translate = useContext(TextContext);
  return (value: TextMessage, params?: Record<string, unknown>): string => {
    const key = typeof value === 'string' ? value : value.key;
    const values = typeof value === 'string' ? params : value.params;
    if (typeof value !== 'string' && value.errorCode) {
      const codeKey='error.'+value.errorCode;
      const localized=translate(codeKey,{detail:key});
      if(localized!==codeKey)return localized;
    }
    return translate(key, values);
  };
}
