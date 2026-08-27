import type {
  TranslationDocument,
  TranslationResult,
  ValidationReport,
  OutputResult,
  OutputGenerateOptions,
} from '../types/index.js';

/**
 * DocumentOutputGenerator Interface
 *
 * Contract for format-specific output generators (.mqxliff, .xliff, .docx).
 * Reconstructs the translated target file while preserving original document structure.
 */
export interface DocumentOutputGenerator {
  /**
   * Generates the translated output file.
   *
   * @param doc - The parsed TranslationDocument
   * @param results - Translation results from the pipeline
   * @param validationReport - Pre-output validation report
   * @param outputPath - Destination file path
   * @param options - Optional output presentation options (outputFormat, languages)
   * @returns OutputResult describing success or failure
   */
  generate(
    doc: TranslationDocument,
    results: TranslationResult[],
    validationReport: ValidationReport,
    outputPath: string,
    options?: OutputGenerateOptions
  ): Promise<OutputResult> | OutputResult;
}
