import { localized } from "../../../src/protocol/locale";

/** The marketplace UI language as a BCP 47 tag for RFC §16.3 lookup. */
export const uiLocale = (language: "zh" | "en") => (language === "en" ? "en" : "zh-CN");
/** One language of a localized protocol map, falling back to its original language. */
export function pick(map: Record<string, string> | undefined, language: "zh" | "en", original: string): string {
  return (map && localized(map, uiLocale(language), original)?.value) ?? "";
}
