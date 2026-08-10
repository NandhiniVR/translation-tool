import * as path from 'path';
import type { DocumentAdapter } from './DocumentAdapter.js';
import type { SupportedFormat } from '../types/index.js';
import { MemoQAdapter } from './MemoQAdapter.js';
import { DOCXAdapter } from './DOCXAdapter.js';

/**
 * AdapterFactory
 *
 * Returns the appropriate DocumentAdapter for a given file name or extension.
 */
export class AdapterFactory {
  /**
   * Resolves supported format from file extension.
   */
  static getFormat(fileName: string): SupportedFormat {
    const ext = path.extname(fileName).toLowerCase();

    if (ext === '.docx') {
      return 'docx';
    }
    if (ext === '.xliff') {
      return 'xliff';
    }
    if (ext === '.mqxliff' || ext === '.xml') {
      return 'mqxliff';
    }

    throw new Error(`Unsupported file extension: ${ext}. Supported formats: .mqxliff, .xliff, .docx`);
  }

  /**
   * Instantiates the matching DocumentAdapter.
   */
  static getAdapter(fileName: string): DocumentAdapter {
    const format = AdapterFactory.getFormat(fileName);

    switch (format) {
      case 'docx':
        return new DOCXAdapter();
      case 'xliff':
        return new MemoQAdapter('xliff');
      case 'mqxliff':
      default:
        return new MemoQAdapter('mqxliff');
    }
  }
}
