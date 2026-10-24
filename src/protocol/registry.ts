import registryJson from '../../docs/specs/amoji-0.1.registry.json' with { type: 'json' };
import { fail } from '../errors.js';
import { lookupLocale } from './locale.js';
import type { ActEntry, Direction, Family, Registry } from './types.js';

export const REGISTRY = registryJson as Registry;
export const REGISTRY_REVISION = REGISTRY.revision;
const ACTS = new Map(REGISTRY.acts.map(entry => [entry.act, entry]));
export const FAMILIES: readonly Family[] = ['grounding', 'steering', 'progress', 'epistemic', 'social'];

export function findAct(act: string): ActEntry | undefined { return ACTS.get(act); }
export function actEntry(act: string): ActEntry { return ACTS.get(act) ?? fail('UNKNOWN_ACT', `码位不在注册表 ${REGISTRY_REVISION} 中：${act}`); }
export function actAllows(act: string, direction: Direction): boolean { return !!ACTS.get(act)?.forms[direction]; }

/** Registry glosses fall back to English (RFC §16.3). */
export function actGloss(act: string, direction: Direction, locale?: string): { locale: string; text: string } {
  const entry = actEntry(act);
  const form = entry.forms[direction] ?? entry.forms.h2a ?? entry.forms.a2h!;
  const chosen = lookupLocale(Object.keys(form.gloss), locale, 'en')!;
  return { locale: chosen, text: form.gloss[chosen]! };
}

/** Human, non-social acts may interject while the AI is responding (RFC §8.3). */
export function backchannelEligible(act: string): boolean {
  const entry = ACTS.get(act);
  return !!entry && !!entry.forms.h2a && entry.family !== 'social';
}
/** Whether a person may send this expression: the act has an h2a form and the expression does not limit itself to a2h (RFC §8). */
export function humanSendable(expression: { realizes: string; directions?: readonly Direction[] }): boolean {
  return actAllows(expression.realizes, 'h2a') && (expression.directions ?? ['h2a', 'a2h']).includes('h2a');
}
export function interruptEligible(act: string): boolean { return ACTS.get(act)?.authority === 'reduce' && actAllows(act, 'h2a'); }
export function humanActs(): ActEntry[] { return REGISTRY.acts.filter(entry => entry.forms.h2a && entry.status !== 'deprecated'); }
export function aiActs(): ActEntry[] { return REGISTRY.acts.filter(entry => entry.forms.a2h && entry.status !== 'deprecated'); }
