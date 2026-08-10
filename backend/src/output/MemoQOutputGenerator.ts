import type { DocumentOutputGenerator } from './DocumentOutputGenerator.js';
import type {
  TranslationDocument,
  TranslationResult,
  ValidationReport,
  OutputResult,
  ParsedDocument,
} from '../types/index.js';
import { OutputGenerator } from './OutputGenerator.js';

/**
 * MemoQOutputGenerator
 *
 * Wraps existing `OutputGenerator` to fulfill `DocumentOutputGenerator` interface
 * for `.mqxliff` and `.xliff` documents.
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
    outputPath: string
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
