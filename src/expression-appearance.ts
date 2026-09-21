import type { Expression } from './sample-catalog.js';

export type Appearance = 'classic' | 'office';

export function expressionAppearance(expression: Expression): Appearance | undefined {
  const value = expression.tags?.find(tag => tag.startsWith('amoji:appearance:'))?.slice('amoji:appearance:'.length);
  return value === 'classic' || value === 'office' ? value : undefined;
}

export function expressionFamily(expression: Expression): string | undefined {
  return expression.tags?.find(tag => tag.startsWith('amoji:family:'))?.slice('amoji:family:'.length);
}
