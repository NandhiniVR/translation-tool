import type { DocumentOutputGenerator } from './DocumentOutputGenerator.js';
import type {
  TranslationDocument,
  TranslationResult,
  ValidationReport,
  OutputResult,
  ParsedDocument,
  OutputGenerateOptions,
} from '../types/index.js';
import { OutputGenerator } from './OutputGenerator.js';

/**
 * MemoQOutputGenerator
 *
 * Wraps existing `OutputGenerator` to fulfill `DocumentOutputGenerator` interface
 * for `.mqxliff` and `.xliff` documents.
 *
 * XLIFF/mqxliff files are inherently bilingual (each trans-unit carries both
 * <source> and <target> side-by-side), so both output formats share the same
 * XML generation; only the output filename distinguishes the mode.
 */
export class MemoQOutputGenerator implements DocumentOutputGenerator {
  private readonly generator: OutputGenerator;

  constructor() {
    this.generator = new OutputGenerator();
  }

  generate(
    doc: TranslationDocument,
    results: TranslationResult[],
    validationReport: ValidationReport,
    outputPath: string,
    _options?: OutputGenerateOptions
  ): OutputResult {
    const parsedDocument = doc.formatContext as ParsedDocument;

    if (!parsedDocument || !parsedDocument.originalXml) {
      return {
        success: false,
        outputFilePath: outputPath,
        validationReport,
        errorMessage: 'Invalid format context for MemoQ document generation.',
      };
    }

    return this.generator.generate(parsedDocument, results, validationReport, outputPath);
  }
}
