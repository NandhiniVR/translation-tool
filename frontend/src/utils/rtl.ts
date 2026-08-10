import type { Language } from '../types';

export function isRtl(langCode: string, languages: Language[]): boolean {
  const match = languages.find((l) => l.code === langCode);
  return match?.direction === 'rtl';
}
