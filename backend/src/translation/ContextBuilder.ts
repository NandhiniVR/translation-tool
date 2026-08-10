import type { TranslationSegment, SegmentContext } from '../types/index.js';

/**
 * ContextBuilder
 *
 * Assembles the previous/current/next segment context for each segment
 * to improve translation quality by helping Gemini resolve:
 *   - Pronoun references (e.g. "it", "they", "this")
 *   - Sentence continuations
 *   - Domain and topic coherence across segments
 *
 * CRITICAL RULE: Gemini must translate ONLY the current segment.
 * Previous and next are provided as context only.
 *
 * Context truncation:
 *   Long previous/next segments are truncated to maxChars characters to avoid
 *   consuming excessive tokens. The current segment is never truncated.
 *   Truncation adds an ellipsis suffix so the model knows the context is partial.
 */
export class ContextBuilder {
  private readonly maxChars: number;

  constructor(maxChars = 500) {
    this.maxChars = maxChars;
  }

  /**
   * Builds a SegmentContext for the segment at the given index.
   *
   * @param segments - All segments in the document
   * @param currentIndex - Zero-based index of the current segment
   * @returns SegmentContext with previous, current, and next plain text
   */
  build(segments: TranslationSegment[], currentIndex: number): SegmentContext {
    if (currentIndex < 0 || currentIndex >= segments.length) {
      throw new Error(
        `Invalid segment index: ${currentIndex}. Total segments: ${segments.length}`
      );
    }

    const previous = currentIndex > 0
      ? this.truncate(segments[currentIndex - 1]!.sourceText)
      : '';

    const current = segments[currentIndex]!.sourceText;

    const next = currentIndex < segments.length - 1
      ? this.truncate(segments[currentIndex + 1]!.sourceText)
      : '';

    return { previousText: previous, currentText: current, nextText: next };
  }

  /**
   * Truncates a string to maxChars, appending '...' if truncated.
   */
  private truncate(text: string): string {
    if (text.length <= this.maxChars) return text;
    return text.slice(0, this.maxChars).trimEnd() + '...';
  }
}
