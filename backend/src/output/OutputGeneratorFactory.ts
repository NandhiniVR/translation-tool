import type { DocumentOutputGenerator } from './DocumentOutputGenerator.js';
import type { SupportedFormat } from '../types/index.js';
import { MemoQOutputGenerator } from './MemoQOutputGenerator.js';
import { DOCXOutputGenerator } from './DOCXOutputGenerator.js';

/**
 * OutputGeneratorFactory
 *
 * Factory returning the matching DocumentOutputGenerator for a given file format.
 */
export class OutputGeneratorFactory {
  static getOutputGenerator(format: SupportedFormat): DocumentOutputGenerator {
    switch (format) {
      case 'docx':
        return new DOCXOutputGenerator();
      case 'xliff':
      case 'mqxliff':
      default:
        return new MemoQOutputGenerator();
    }
  }
}
