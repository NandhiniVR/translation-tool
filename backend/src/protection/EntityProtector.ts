import type { ProtectedToken, ProtectionResult } from '../types/index.js';

/**
 * EntityProtector
 *
 * Replaces configurable non-translatable entities with stable placeholder tokens.
 *
 * Design principles:
 *   - Only protect entities that are explicitly configured or match clear patterns
 *   - Do NOT automatically protect all person names, organizations, or brands —
 *     many of these have valid transliterations in the target language
 *   - The caller controls which entity types are active via EntityProtectorConfig
 *
 * Protected by default:
 *   - URLs (http, https, ftp)
 *   - Email addresses
 *   - Alphanumeric IDs and codes (e.g. STUDY-2026-X99, NCT12345678)
 *
 * Numbers and measurements are NOT blindly protected here — they are validated
 * by SegmentValidator after translation to catch unintended changes.
 *
 * Token format: __ENTITY_N__ (N starts at 1)
 *
 * Tokens from TagProtector and EntityProtector use different prefixes,
 * so they can be validated and restored independently.
 */

export interface EntityProtectorConfig {
  protectUrls: boolean;
  protectEmails: boolean;
  /** Regex patterns for custom entity types (e.g. study IDs, product codes) */
  customPatterns: Array<{ name: string; pattern: RegExp }>;
}

export const DEFAULT_ENTITY_CONFIG: EntityProtectorConfig = {
  protectUrls: true,
  protectEmails: true,
  customPatterns: [
    // Study IDs: NCT followed by digits (ClinicalTrials.gov format)
    { name: 'nct_id', pattern: /\bNCT\d{8}\b/g },
    // Generic alphanumeric codes: 2+ uppercase letters, digit(s), hyphen pattern
    // e.g. STUDY-2026-X99, DRUG-001, BATCH-ABC-123
    { name: 'code', pattern: /\b[A-Z]{2,}-[A-Z0-9-]{2,}\b/g },
  ],
};

// URL pattern (conservative — avoids matching too aggressively)
const URL_PATTERN = /https?:\/\/[^\s<>"'()[\]{}]+/g;
const FTP_PATTERN = /ftp:\/\/[^\s<>"'()[\]{}]+/g;

// Email pattern
const EMAIL_PATTERN = /\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/g;

export class EntityProtector {
  private readonly config: EntityProtectorConfig;

  constructor(config: EntityProtectorConfig = DEFAULT_ENTITY_CONFIG) {
    this.config = config;
  }

  /**
   * Scans the input text for configurable entity patterns and replaces each
   * match with a stable placeholder token.
   *
   * Entities are extracted in a deterministic order: URLs → emails → custom.
   * This avoids partial overlap issues where one pattern might consume part
   * of another's match.
   *
   * @param text - The source text (after tag protection has already been applied)
   * @returns ProtectionResult with protected text and token map
   */
  protect(text: string): ProtectionResult {
    const tokens: ProtectedToken[] = [];
    let counter = 1;
    let current = text;

    // Helper to apply a single pattern
    const applyPattern = (pattern: RegExp): void => {
      // Reset lastIndex to avoid stateful regex issues
      pattern.lastIndex = 0;
      current = current.replace(pattern, (match) => {
        const token = `__ENTITY_${counter}__`;
        tokens.push({ token, original: match, type: 'entity' });
        counter++;
        return token;
      });
    };

    if (this.config.protectUrls) {
      applyPattern(URL_PATTERN);
      applyPattern(FTP_PATTERN);
    }

    if (this.config.protectEmails) {
      applyPattern(EMAIL_PATTERN);
    }

    for (const { pattern } of this.config.customPatterns) {
      applyPattern(pattern);
    }

    return { protectedText: current, tokens };
  }

  /**
   * Restores original entity values in the translated text.
   *
   * Validates:
   *   1. All entity tokens are present in the translated text.
   *   2. No entity token appears more than once.
   *
   * Throws EntityRestorationError if validation fails.
   *
   * @param translatedText - Translated text with __ENTITY_N__ tokens
   * @param tokens - Token map from protect()
   * @returns The fully restored translated text
   */
  restore(translatedText: string, tokens: ProtectedToken[]): string {
    if (tokens.length === 0) {
      return translatedText;
    }

    const missing: string[] = [];
    const duplicated: string[] = [];

    for (const { token } of tokens) {
      const count = this.countOccurrences(translatedText, token);
      if (count === 0) missing.push(token);
      else if (count > 1) duplicated.push(token);
    }

    if (missing.length > 0 || duplicated.length > 0) {
      const problems: string[] = [];
      if (missing.length > 0) problems.push(`Missing entity tokens: ${missing.join(', ')}`);
      if (duplicated.length > 0) problems.push(`Duplicated entity tokens: ${duplicated.join(', ')}`);
      throw new EntityRestorationError(problems.join('; '));
    }

    let result = translatedText;
    for (const { token, original } of tokens) {
      result = result.replace(token, original);
    }

    return result;
  }

  /**
   * Returns all entity tokens found in a translated text.
   * Used for validation without restoring.
   */
  findTokensInText(text: string): string[] {
    return (text.match(/__ENTITY_\d+__/g) ?? []);
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

export class EntityRestorationError extends Error {
  constructor(message: string) {
    super(`Entity restoration failed: ${message}`);
    this.name = 'EntityRestorationError';
  }
}
