import type { DocumentAdapter } from './DocumentAdapter.js';
import type { TranslationDocument, SupportedFormat } from '../types/index.js';
import { MemoQParser } from '../parsers/MemoQParser.js';

/**
 * MemoQAdapter
 *
 * Wraps the existing `MemoQParser` to fit the unified `DocumentAdapter` interface.
 * Handles both `.mqxliff` and `.xliff` files seamlessly without modifying any XLIFF logic.
 */
export class MemoQAdapter implements DocumentAdapter {
  readonly format: SupportedFormat;
  private readonly parser: MemoQParser;

  constructor(format: 'mqxliff' | 'xliff' = 'mqxliff') {
    this.format = format;
    this.parser = new MemoQParser();
  }

  parse(fileBuffer: Buffer, fileName: string): TranslationDocument {
    const xmlContent = fileBuffer.toString('utf8');
    const parsedDoc = this.parser.parse(xmlContent);

    return {
      id: fileName,
      sourceFormat: this.format,
      originalFileName: fileName,
      sourceLanguage: parsedDoc.declaredSourceLanguage,
      targetLanguage: parsedDoc.declaredTargetLanguage,
      segments: parsedDoc.segments,
      formatContext: parsedDoc, // Passes original ParsedDocument for MemoQOutputGenerator
    };
  }
}
