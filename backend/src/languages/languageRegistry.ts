import type { LanguageConfig } from '../types/index.js';

/**
 * Language Registry
 *
 * Central configurable list of supported languages.
 * Adding a new language requires only a new entry here —
 * no changes to the translation engine, parser, or output generator.
 *
 * Rules should only be added when they are:
 *   1. Verified to improve translation quality for that language
 *   2. Specific to that language (not general translation advice)
 *
 * Do not add speculative or invented rules.
 */
const LANGUAGE_REGISTRY: LanguageConfig[] = [
  {
    code: 'en',
    name: 'English',
    nativeName: 'English',
    direction: 'ltr',
  },
  {
    code: 'hi',
    name: 'Hindi',
    nativeName: 'हिन्दी',
    direction: 'ltr',
  },
  {
    code: 'gu',
    name: 'Gujarati',
    nativeName: 'ગુજરાતી',
    direction: 'ltr',
  },
  {
    code: 'pa',
    name: 'Punjabi',
    nativeName: 'ਪੰਜਾਬੀ',
    direction: 'ltr',
  },
  {
    code: 'ur',
    name: 'Urdu',
    nativeName: 'اردو',
    direction: 'rtl',
  },
  {
    code: 'ta',
    name: 'Tamil',
    nativeName: 'தமிழ்',
    direction: 'ltr',
  },
  {
    code: 'te',
    name: 'Telugu',
    nativeName: 'తెలుగు',
    direction: 'ltr',
  },
  {
    code: 'ml',
    name: 'Malayalam',
    nativeName: 'മലയാളം',
    direction: 'ltr',
  },
  {
    code: 'mr',
    name: 'Marathi',
    nativeName: 'मराठी',
    direction: 'ltr',
  },
  {
    code: 'bn',
    name: 'Bengali',
    nativeName: 'বাংলা',
    direction: 'ltr',
  },
];

/**
 * Returns all registered languages.
 */
export function getAllLanguages(): LanguageConfig[] {
  return [...LANGUAGE_REGISTRY];
}

/**
 * Returns a language config by BCP-47 code, or undefined if not found.
 */
export function getLanguageByCode(code: string): LanguageConfig | undefined {
  return LANGUAGE_REGISTRY.find((lang) => lang.code === code);
}

/**
 * Returns only the prompt-injectable rules for a given language code.
 * Returns an empty array if the language has no configured rules,
 * or if the language code is not found.
 */
export function getLanguageRules(code: string): string[] {
  const lang = getLanguageByCode(code);
  return lang?.rules ?? [];
}

/**
 * Returns true if the language is RTL.
 * Defaults to LTR for unknown languages.
 */
export function isRtlLanguage(code: string): boolean {
  const lang = getLanguageByCode(code);
  return lang?.direction === 'rtl';
}

/**
 * Returns a human-readable display label for a language code.
 * E.g. "ta" -> "Tamil (ta)", "hi" -> "Hindi (hi)".
 * If the code is not in the registry, returns the code itself.
 */
export function getLanguageLabel(code: string): string {
  const lang = getLanguageByCode(code);
  if (!lang) return code;
  return `${lang.name} (${lang.code})`;
}

