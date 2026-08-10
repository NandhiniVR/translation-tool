import type { TranslationDocument, SupportedFormat } from '../types/index.js';

/**
 * DocumentAdapter Interface
 *
 * Common contract for all file format parsers (.mqxliff, .xliff, .docx).
 * Formats are converted into a unified `TranslationDocument` holding
 * standardized `TranslationSegment[]`.
 */
export interface DocumentAdapter {
  /**
   * The format handled by this adapter.
   */
  readonly format: SupportedFormat;

  /**
   * Parses raw file buffer into a common `TranslationDocument`.
   *
   * @param fileBuffer - Raw buffer of uploaded file
   * @param fileName - Original file name
   * @returns Unified TranslationDocument
   */
  parse(fileBuffer: Buffer, fileName: string): Promise<TranslationDocument> | TranslationDocument;
}
