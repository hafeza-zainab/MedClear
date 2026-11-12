export const LANGUAGES = [
  { code: "en", label: "English", promptName: "English" },
  { code: "es", label: "Español", promptName: "Spanish" },
  { code: "fr", label: "Français", promptName: "French" },
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]["code"];
export const LANGUAGE_CODES = LANGUAGES.map(({ code }) => code) as [LanguageCode, ...LanguageCode[]];

export function getLanguage(code: unknown) {
  return LANGUAGES.find((language) => language.code === code) ?? LANGUAGES[0];
}

export function isLanguageCode(code: unknown): code is LanguageCode {
  return LANGUAGES.some((language) => language.code === code);
}
