import { getLanguageByCode } from './languageRegistry.js';

/**
 * SegmentLanguageFilter
 *
 * Classifies whether a document segment is written in the selected Source
 * Language. Segments that are confidently written in a DIFFERENT language are
 * skipped before they reach the AI model (pass-through unchanged), which is a
 * large speed win for multilingual documents: the model only sees segments it
 * actually has to translate, and the number of API requests drops accordingly.
 *
 * The classifier is intentionally CONSERVATIVE:
 *   - If the segment contains ANY characters of the source language's script,
 *     it is always sent to the model (mixed-script segments are translated by
 *     the model, which already knows how to preserve other languages).
 *   - A segment is only skipped when it contains NO source-language script
 *     characters AND a clear majority of characters from another known script.
 *   - Shared-script families (Urdu/Farsi/Pashto — all Arabic script) cannot be
 *     told apart by script alone, so those segments are sent to the model,
 *     which already has the multilingual preservation rules.
 *   - Short/ambiguous segments are sent to the model (they are cheap and the
 *     model preserves them).
 *
 * Skipping a segment never reduces translation quality: skipped segments are
 * non-source-language content that the multilingual rules require to remain
 * exactly as they appear, so passing them through unchanged is correct.
 */

export type SegmentLanguageDecision = 'source' | 'other' | 'ambiguous';

/** Minimum number of non-source-script characters required to confidently skip. */
const MIN_OTHER_SCRIPT_CHARS = 4;

/**
 * Distinctive characters for Arabic-script languages that share one script
 * family (Urdu/Farsi/Pashto). Used only to SKIP segments of a sibling
 * language; ambiguous segments are still sent to the model.
 */
const URDU_ONLY = /[\u0679\u0691\u06BA\u06BE\u06C1\u06D2]/;
const PASHTO_ONLY = /[\u067C\u0693\u0696\u069A\u06AB\u06BC\u06CD\u06D0\u06D3]/;

/** Unicode script ranges keyed by language code (mirrors the validator's script map). */
const SCRIPT_RANGES: Record<string, RegExp> = {
  en: /[A-Za-z]/g,
  hi: /[\u0900-\u097F]/g,
  mr: /[\u0900-\u097F]/g,
  bn: /[\u0980-\u09FF]/g,
  pa: /[\u0A00-\u0A7F]/g,
  gu: /[\u0A80-\u0AFF]/g,
  ta: /[\u0B80-\u0BFF]/g,
  te: /[\u0C00-\u0C7F]/g,
  ml: /[\u0D00-\u0D7F]/g,
  ur: /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/g,
  fa: /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/g,
  ps: /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/g,
};

const ALL_SCRIPT_PATTERNS = new Set<string>([
  'en', 'hi', 'mr', 'bn', 'pa', 'gu', 'ta', 'te', 'ml', 'ur', 'fa', 'ps',
]);

/**
 * Counts how many characters of each registered script appear in the text.
 */
function countScriptChars(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const code of ALL_SCRIPT_PATTERNS) {
    const regex = SCRIPT_RANGES[code]!;
    regex.lastIndex = 0;
    const m = text.match(regex);
    if (m && m.length > 0) counts.set(code, m.length);
  }
  return counts;
}

/**
 * Returns the script family a segment appears to be written in, or undefined
 * when the segment has no identifiable script characters (numbers, symbols).
 */
function dominantScript(counts: Map<string, number>): string | undefined {
  let best: string | undefined;
  let bestCount = 0;
  for (const [code, count] of counts) {
    if (count > bestCount) {
      best = code;
      bestCount = count;
    }
  }
  return bestCount > 0 ? best : undefined;
}

/**
 * Classifies a segment against the requested source language.
 *
 * Returns:
 *   - 'source'     → contains source-language script; MUST be sent to the model
 *   - 'other'      → confidently written in another language; skip (pass through)
 *   - 'ambiguous'  → cannot tell safely; send to the model (conservative)
 */
export function classifySegmentLanguage(
  text: string,
  sourceLanguage: string
): SegmentLanguageDecision {
  const sourceLang = (sourceLanguage ?? '').toLowerCase();

  // Unknown source language — never skip (be conservative).
  if (!SCRIPT_RANGES[sourceLang]) return 'ambiguous';

  const srcLang = getLanguageByCode(sourceLang);
  if (!srcLang) return 'ambiguous';

  // Strip placeholder tokens (they carry no language information).
  const clean = (text ?? '')
    .replace(/__TAG_\d+__/g, ' ')
    .replace(/__ENTITY_\d+__/g, ' ')
    .trim();

  if (!clean) return 'ambiguous';

  const counts = countScriptChars(clean);
  const srcCount = counts.get(sourceLang) ?? 0;

  // Any source-language script characters → translate (mixed segments included).
  if (srcCount > 0) return 'source';

  const dominant = dominantScript(counts);
  if (!dominant) return 'ambiguous'; // numbers/symbols only

  // If the dominant script is a different, clearly identifiable language,
  // count its chars. Require a meaningful amount so short segments ("OK")
  // are not wrongly skipped.
  const otherCount = counts.get(dominant) ?? 0;
  if (otherCount >= MIN_OTHER_SCRIPT_CHARS) {
    // Shared Arabic script (ur/fa/ps) — distinguish using distinctive
    // characters when possible; otherwise send to the model, which already
    // has the multilingual preservation rules.
    if (['ur', 'fa', 'ps'].includes(dominant) && ['ur', 'fa', 'ps'].includes(sourceLang)) {
      return classifyArabicFamily(clean, sourceLang);
    }
    return 'other';
  }

  return 'ambiguous';
}

/**
 * Tries to tell Urdu/Farsi/Pashto apart using distinctive characters.
 * Only returns 'other' (skip) when the segment clearly belongs to a sibling
 * language; every uncertain case is 'ambiguous' (send to the model).
 */
function classifyArabicFamily(clean: string, sourceLang: string): SegmentLanguageDecision {
  const hasUrdu = URDU_ONLY.test(clean);
  const hasPashto = PASHTO_ONLY.test(clean);

  if (sourceLang === 'ur' && hasPashto && !hasUrdu) return 'other';
  if (sourceLang === 'ps' && hasUrdu && !hasPashto) return 'other';
  // Farsi vs Urdu/Pashto cannot be told apart reliably by these characters.
  return 'ambiguous';
}
