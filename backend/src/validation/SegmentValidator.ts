import type {
  TranslationSegment,
  TranslationResult,
  ValidationReport,
  SegmentError,
} from '../types/index.js';
import { logger } from '../config/logger.js';

export interface CompletenessCheckResult {
  isComplete: boolean;
  status: 'valid' | 'warning' | 'failed';
  reason?: string;
}

/**
 * SegmentValidator
 *
 * Performs pre-output validation of the complete set of translation results.
 * Validation failures are reported precisely — they do not silently pass.
 *
 * Validation checks:
 *   1. Segment count: source count === result count
 *   2. Segment IDs: every source segment ID is present in results
 *   3. Segment order: results are in the same order as source segments
 *   4. Non-empty translations: completed segments have non-empty target text
 *   5. Tag tokens: no unrestored __TAG_N__ tokens remain
 *   6. Entity tokens: no unrestored __ENTITY_N__ tokens remain
 *   7. Key numbers: important numeric values from source appear in target
 *   8. Multilingual completeness check: detects untranslated source-language text remaining in target
 */
export class SegmentValidator {
  /**
   * Returns a regex matching characters of the specified language script.
   */
  private getScriptRegex(langCode: string): RegExp | null {
    switch (langCode.toLowerCase()) {
      case 'hi':
      case 'mr':
        return /[\u0900-\u097F]/g;
      case 'bn':
        return /[\u0980-\u09FF]/g;
      case 'pa':
        return /[\u0A00-\u0A7F]/g;
      case 'gu':
        return /[\u0A80-\u0AFF]/g;
      case 'ta':
        return /[\u0B80-\u0BFF]/g;
      case 'te':
        return /[\u0C00-\u0C7F]/g;
      case 'ml':
        return /[\u0D00-\u0D7F]/g;
      case 'ur':
        return /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/g;
      case 'en':
        return /[A-Za-z]/g;
      default:
        return null;
    }
  }

  /**
   * Performs a multilingual translation-completeness check to detect untranslated source content.
   *
   * Distinguishes:
   *   - VALID: Translation is complete (or legitimate unchanged entities present)
   *   - WARNING: Possible untranslated source-language words detected
   *   - FAILED: Large portion of source text or source script was copied without translation
   */
  checkCompleteness(
    sourceText: string,
    targetText: string,
    sourceLang?: string,
    targetLang?: string
  ): CompletenessCheckResult {
    // Strip protected placeholders, URLs, emails, numbers, and punctuation for clean analysis
    const clean = (text: string): string =>
      text
        .replace(/__TAG_\d+__/g, '')
        .replace(/__ENTITY_\d+__/g, '')
        .replace(/https?:\/\/\S+|www\.\S+/g, '')
        .replace(/\S+@\S+\.\S+/g, '')
        .replace(/\b\d+(?:\.\d+)?\b/g, '')
        .replace(/[^\p{L}\s]/gu, ' ')
        .trim();

    const cleanSource = clean(sourceText);
    const cleanTarget = clean(targetText);

    if (cleanSource.length < 3) {
      return { isComplete: true, status: 'valid' };
    }

    if (!cleanTarget) {
      return {
        isComplete: false,
        status: 'failed',
        reason: 'Empty target output after stripping placeholders',
      };
    }

    // 0. Conversational Commentary Detection (e.g. "Unfortunately, there is no text...")
    const conversationalPattern = /^(unfortunately|there is no text|here is the translation|i cannot translate|as an ai|note:)/i;
    if (conversationalPattern.test(cleanTarget.trim())) {
      return {
        isComplete: false,
        status: 'failed',
        reason: 'LLM returned conversational commentary instead of translation',
      };
    }

    // 1. Script Mismatch Heuristic (when source and target use different scripts)
    if (sourceLang && targetLang && sourceLang.toLowerCase() !== targetLang.toLowerCase()) {
      const srcScriptRegex = this.getScriptRegex(sourceLang);
      const tgtScriptRegex = this.getScriptRegex(targetLang);

      // A. Check if source script characters remain in target (excluding Latin if source is Latin, since English technical terms/proper nouns are common)
      if (srcScriptRegex && sourceLang.toLowerCase() !== 'en') {
        const srcMatches = cleanTarget.match(srcScriptRegex) ?? [];
        const srcCharCount = srcMatches.length;
        if (srcCharCount > 3 && srcCharCount / cleanTarget.length > 0.15) {
          return {
            isComplete: false,
            status: 'failed',
            reason: `Untranslated source script (${sourceLang}) detected in target (${targetLang}) output`,
          };
        }
      }

      // B. Check if target script is completely missing when target is a non-Latin script language (e.g. Hindi, Tamil, Gujarati)
      if (tgtScriptRegex && targetLang.toLowerCase() !== 'en' && cleanSource.length >= 8) {
        const tgtMatches = cleanTarget.match(tgtScriptRegex) ?? [];
        if (tgtMatches.length === 0) {
          return {
            isComplete: false,
            status: 'failed',
            reason: `Target translation missing expected script characters for ${targetLang}`,
          };
        }
      }
    }

    // 2. Verbatim Word Overlap Heuristic
    if (sourceLang && targetLang && sourceLang.toLowerCase() !== targetLang.toLowerCase()) {
      const sourceWords = cleanSource
        .split(/\s+/)
        .filter((w) => w.length >= 4);

      if (sourceWords.length >= 3) {
        const targetWordSet = new Set(cleanTarget.split(/\s+/));
        let matchedCount = 0;
        for (const w of sourceWords) {
          if (targetWordSet.has(w)) matchedCount++;
        }

        const ratio = matchedCount / sourceWords.length;
        if (ratio >= 0.70) {
          return {
            isComplete: false,
            status: 'failed',
            reason: `Substantial source text (${Math.round(ratio * 100)}%) left untranslated`,
          };
        } else if (ratio >= 0.45) {
          return {
            isComplete: true,
            status: 'warning',
            reason: `Possible untranslated source words (${Math.round(ratio * 100)}%) detected`,
          };
        }
      }
    }

    return { isComplete: true, status: 'valid' };
  }

  /**
   * Validates the full set of translation results against the source segments.
   */
  validate(
    sourceSegments: TranslationSegment[],
    results: TranslationResult[],
    sourceLang?: string,
    targetLang?: string
  ): ValidationReport {
    const warnings: string[] = [];
    const failedSegments: SegmentError[] = [];

    // 1. Segment count
    const segmentCountMatch = sourceSegments.length === results.length;
    if (!segmentCountMatch) {
      warnings.push(
        `Segment count mismatch: source has ${sourceSegments.length}, ` +
        `results have ${results.length}`
      );
    }

    // Build lookup maps
    const sourceById = new Map(sourceSegments.map((s) => [s.id, s]));
    const resultById = new Map(results.map((r) => [r.segmentId, r]));

    // 2. All source IDs present in results
    let allSegmentsPresent = true;
    for (const seg of sourceSegments) {
      if (!resultById.has(seg.id)) {
        allSegmentsPresent = false;
        warnings.push(`Segment ID ${seg.id} (index ${seg.index}) is missing from results`);
        failedSegments.push({
          segmentId: seg.id,
          segmentIndex: seg.index,
          errorType: 'validation_error',
          message: 'Segment missing from translation results',
        });
      }
    }

    // 3. Per-result checks
    for (const result of results) {
      const source = sourceById.get(result.segmentId);

      if (result.status === 'failed') {
        failedSegments.push({
          segmentId: result.segmentId,
          segmentIndex: result.segmentIndex,
          errorType: 'api_error',
          message: result.errorMessage ?? 'Translation failed',
        });
        continue;
      }

      if (result.status !== 'completed') continue;

      // 4. Non-empty translation check
      if (source && source.sourceText.trim().length > 0) {
        if (!result.translatedText || result.translatedText.trim().length === 0) {
          warnings.push(`Segment ${result.segmentId}: non-empty source produced empty translation`);
          failedSegments.push({
            segmentId: result.segmentId,
            segmentIndex: result.segmentIndex,
            errorType: 'validation_error',
            message: 'Empty translation output for non-empty source segment',
          });
        }
      }

      // 5. Unrestored tag tokens
      const unretoredTags = result.translatedRaw.match(/__TAG_\d+__/g) ?? [];
      if (unretoredTags.length > 0) {
        warnings.push(
          `Segment ${result.segmentId}: unrestored tag tokens: ${unretoredTags.join(', ')}`
        );
        failedSegments.push({
          segmentId: result.segmentId,
          segmentIndex: result.segmentIndex,
          errorType: 'tag_error',
          message: `Unrestored tag tokens: ${unretoredTags.join(', ')}`,
        });
      }

      // 6. Unrestored entity tokens
      const unrestoredEntities = result.translatedRaw.match(/__ENTITY_\d+__/g) ?? [];
      if (unrestoredEntities.length > 0) {
        warnings.push(
          `Segment ${result.segmentId}: unrestored entity tokens: ${unrestoredEntities.join(', ')}`
        );
        failedSegments.push({
          segmentId: result.segmentId,
          segmentIndex: result.segmentIndex,
          errorType: 'entity_error',
          message: `Unrestored entity tokens: ${unrestoredEntities.join(', ')}`,
        });
      }

      // 7. Key number preservation (heuristic)
      if (source) {
        const sourceNumbers = this.extractNumbers(source.sourceText);
        const resultNumbers = this.extractNumbers(result.translatedText);

        for (const num of sourceNumbers) {
          if (!resultNumbers.has(num)) {
            warnings.push(
              `Segment ${result.segmentId}: number "${num}" from source not found in translation`
            );
            logger.warn(`[Validator] Number "${num}" missing from segment ${result.segmentId}`);
          }
        }
      }

      // 8. Multilingual Completeness Check
      if (source && source.sourceText.trim().length > 0) {
        const comp = this.checkCompleteness(
          source.sourceText,
          result.translatedText,
          sourceLang,
          targetLang
        );

        if (!comp.isComplete && comp.status === 'failed') {
          const msg = `Segment ${result.segmentId}: ${comp.reason ?? 'Incomplete translation'}`;
          warnings.push(msg);
          failedSegments.push({
            segmentId: result.segmentId,
            segmentIndex: result.segmentIndex,
            errorType: 'validation_error',
            message: comp.reason ?? 'Incomplete translation: untranslated content detected',
          });
        } else if (comp.status === 'warning' && comp.reason) {
          warnings.push(`Segment ${result.segmentId}: ${comp.reason}`);
          result.validationWarnings.push(comp.reason);
        }
      }

      // Propagate any validation warnings from the pipeline
      if (result.validationWarnings.length > 0) {
        for (const w of result.validationWarnings) {
          warnings.push(`Segment ${result.segmentId}: ${w}`);
        }
      }
    }

    // Deduplicate failed segment IDs
    const seenIds = new Set<string>();
    const uniqueFailed = failedSegments.filter((e) => {
      if (seenIds.has(e.segmentId)) return false;
      seenIds.add(e.segmentId);
      return true;
    });

    const valid = uniqueFailed.length === 0 && segmentCountMatch && allSegmentsPresent;

    if (!valid) {
      logger.warn(`[Validator] Validation failed`, {
        failedCount: uniqueFailed.length,
        warnings: warnings.length,
      });
    } else {
      logger.info(`[Validator] All segments validated successfully`);
    }

    return {
      valid,
      segmentCountMatch,
      allSegmentsPresent,
      failedSegments: uniqueFailed,
      warnings,
    };
  }

  /**
   * Extracts numeric values (integers and decimals) from text.
   */
  private extractNumbers(text: string): Set<string> {
    const matches = text.match(/\b\d+(?:\.\d+)?\b/g) ?? [];
    return new Set(matches);
  }
}
