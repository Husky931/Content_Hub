/** Pick the Chinese value when locale is "zh" and a Chinese value exists, otherwise fall back to English. */
export function localized(locale: string, en: string, cn?: string | null): string {
  return locale === "zh" && cn ? cn : en;
}
