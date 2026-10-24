import type { Localized } from './types.js';

/**
 * RFC 4647 Lookup with a final fallback to the source language (RFC §16.3).
 * Truncation never crosses scripts: zh-Hant can reach zh, never zh-CN.
 */
export function lookupLocale(available: Iterable<string>, wanted: string | undefined, fallback?: string): string | undefined {
  const keys = [...available];
  const find = (tag: string) => keys.find(key => key.toLowerCase() === tag.toLowerCase());
  if (wanted) {
    const parts = wanted.split('-');
    while (parts.length) {
      const match = find(parts.join('-'));
      if (match) return match;
      parts.pop();
      // A trailing singleton (such as -x or -u) is removed together with its extension.
      if (parts.length > 1 && parts[parts.length - 1]!.length === 1) parts.pop();
    }
  }
  return fallback === undefined ? undefined : find(fallback);
}

export function localized<T>(value: Localized<T> | undefined, wanted: string | undefined, fallback: string): { locale: string; value: T } | undefined {
  if (!value) return undefined;
  const locale = lookupLocale(Object.keys(value), wanted, fallback) ?? Object.keys(value)[0];
  return locale === undefined ? undefined : { locale, value: value[locale]! };
}
