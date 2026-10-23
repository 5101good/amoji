import { localized } from './locale.js';
import type { Expression } from './types.js';

export interface ExpressionText {
  locale: string;
  name: string;
  meaning: string;
  fallback: string;
  use_when: string[];
  avoid_when: string[];
  tags: string[];
}

/** One language view of an expression, following the RFC §16.3 fallback chain. */
export function expressionText(e: Pick<Expression, 'name' | 'semantics' | 'tags' | 'original_locale'>, locale?: string): ExpressionText {
  const semantics = localized(e.semantics, locale, e.original_locale)!;
  const name = localized(e.name, semantics.locale, e.original_locale)!;
  const tags = localized(e.tags, semantics.locale, e.original_locale);
  return {
    locale: semantics.locale,
    name: name.value,
    meaning: semantics.value.meaning,
    fallback: semantics.value.fallback,
    use_when: semantics.value.use_when ?? [],
    avoid_when: semantics.value.avoid_when ?? [],
    tags: tags?.value ?? [],
  };
}

/** Every language's searchable text, so a query in any language can match. */
export function searchableText(e: Pick<Expression, 'name' | 'semantics' | 'tags'>): { name: string[]; tags: string[]; meaning: string[]; fallback: string[]; use_when: string[]; avoid_when: string[] } {
  const all = Object.values(e.semantics);
  return {
    name: Object.values(e.name),
    tags: Object.values(e.tags ?? {}).flat(),
    meaning: all.map(s => s.meaning),
    fallback: all.map(s => s.fallback),
    use_when: all.flatMap(s => s.use_when ?? []),
    avoid_when: all.flatMap(s => s.avoid_when ?? []),
  };
}

export function localizedText(value: Record<string, string> | undefined, locale: string | undefined, original: string): string {
  return localized(value, locale, original)?.value ?? '';
}
