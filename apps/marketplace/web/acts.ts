import registry from "../../../docs/specs/amoji-0.1.registry.json";
import { pick, uiLocale } from "../src/localized";
import type { Locale } from "./ui";

/** Registry acts (RFC Appendix A) for filters and labels. */
export const ACTS = registry.acts.filter((a) => a.status !== "deprecated");
/** The localized gloss of an act, preferring the human-to-AI form. */
export function actLabel(act: string, locale: Locale): string {
  const entry = registry.acts.find((a) => a.act === act);
  const forms = entry?.forms as Record<string, { gloss: Record<string, string> }> | undefined;
  const form = forms?.h2a ?? forms?.a2h;
  return form ? pick(form.gloss, locale, "en") || act : act;
}
export { pick, uiLocale };
