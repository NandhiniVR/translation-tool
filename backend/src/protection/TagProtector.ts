import type { ProtectedToken, ProtectionResult } from '../types/index.js';

/**
 * TagProtector
 *
 * Replaces MemoQ/XLIFF inline XML tags with stable placeholder tokens before
 * sending text to Gemini, then restores the original tags afterward.
 *
 * Supported inline tag types (standard XLIFF):
 *   <bpt>  — Begin paired tag (opening formatting)
 *   <ept>  — End paired tag (closing formatting)
 *   <ph>   — Placeholder (standalone tag)
 *   <g>    — Generic group inline element
 *   <mrk>  — Marked segment (MemoQ uses this for segmentation marks)
 *   <x>    — Standalone element (no content)
 *   <bx>   — Begin paired standalone element
 *   <ex>   — End paired standalone element
 *   <it>   — Isolated tag (not paired)
 *
 * MemoQ-specific patterns also handled:
 *   mq: namespace tags
 *
 * Token format: __TAG_N__ (N starts at 1)
 *
 * IMPORTANT: Tags are matched in document order and stored by token.
 * Restoration verifies that all tokens are present in the translated text
 * before performing any replacement.
 */

// Matches any XLIFF/MemoQ inline tag — both self-closing and with content
const INLINE_TAG_PATTERN =
  /<(?:bpt|ept|ph|g|mrk|x|bx|ex|it|mq:[a-zA-Z]+)[^>]*(?:\/>|>(?:[^<]*(?:<(?!(?:bpt|ept|ph|g|mrk|x|bx|ex|it|mq:[a-zA-Z]+)[^>]*>)[^<]*)*<\/(?:bpt|ept|ph|g|mrk|x|bx|ex|it|mq:[a-zA-Z]+)>)?)/g;

export class TagProtector {
  /**
   * Scans the input text for inline XML tags and replaces each one with
   * a stable placeholder token. Returns the protected text and the token map.
   *
   * @param text - The source text possibly containing inline XML tags
   * @returns ProtectionResult with protected text and token → original mapping
   */
  protect(text: string): ProtectionResult {
    const tokens: ProtectedToken[] = [];
    let counter = 1;

    const protectedText = text.replace(INLINE_TAG_PATTERN, (match) => {
      const token = `__TAG_${counter}__`;
      tokens.push({ token, original: match, type: 'tag' });
      counter++;
      return token;
    });

    return { protectedText, tokens };
  }

  /**
   * Restores original inline XML tags in the translated text using the token map.
   *
   * Validates:
   *   1. All tokens from the original are present in the translated text.
   *   2. No token appears more than once (duplication check).
   *
   * If validation fails, throws a TagRestorationError describing the problem.
   * The caller is responsible for marking the segment as failed.
   *
   * @param translatedText - The translated text with __TAG_N__ placeholders
   * @param tokens - The original token map from protect()
   * @returns The fully restored translated text
   */
  restore(translatedText: string, tokens: ProtectedToken[]): string {
    if (tokens.length === 0) {
      return translatedText;
    }

    // Validate: all tokens must be present
    const missing: string[] = [];
    const duplicated: string[] = [];

    for (const { token } of tokens) {
      const occurrences = this.countOccurrences(translatedText, token);
      if (occurrences === 0) {
        missing.push(token);
      } else if (occurrences > 1) {
        duplicated.push(token);
      }
    }

    if (missing.length > 0 || duplicated.length > 0) {
      const problems: string[] = [];
      if (missing.length > 0) {
        problems.push(`Missing tokens: ${missing.join(', ')}`);
      }
      if (duplicated.length > 0) {
        problems.push(`Duplicated tokens: ${duplicated.join(', ')}`);
      }
      throw new TagRestorationError(problems.join('; '));
    }

    // Restore all tokens
    let result = translatedText;
    for (const { token, original } of tokens) {
      result = result.replace(token, original);
    }

    return result;
  }

  /**
   * Checks whether the input text contains any inline tag patterns.
   * Useful for quickly determining if protection is needed.
   */
  hasTags(text: string): boolean {
    INLINE_TAG_PATTERN.lastIndex = 0;
    return INLINE_TAG_PATTERN.test(text);
  }

  /**
   * Returns all tag tokens found in a piece of translated text.
   * Used for validation without restoring.
   */
  findTokensInText(text: string): string[] {
    return (text.match(/__TAG_\d+__/g) ?? []);
  }

  private countOccurrences(text: string, substring: string): number {
    let count = 0;
    let pos = 0;
    while ((pos = text.indexOf(substring, pos)) !== -1) {
      count++;
      pos += substring.length;
    }
    return count;
  }
}

export class TagRestorationError extends Error {
  constructor(message: string) {
    super(`Tag restoration failed: ${message}`);
    this.name = 'TagRestorationError';
  }
}
