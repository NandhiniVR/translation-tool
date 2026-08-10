import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import type { DocumentAdapter } from './DocumentAdapter.js';
import type { TranslationDocument, TranslationSegment, SupportedFormat } from '../types/index.js';
import { logger } from '../config/logger.js';

export interface DocxNodeRef {
  segmentId: string;
  paragraphIndex: number;
  /** Original plain text extracted from paragraph */
  originalText: string;
}

export interface DocxFormatContext {
  zip: JSZip;
  documentXml: string;
  nodeRefs: DocxNodeRef[];
}

/**
 * DOCXAdapter
 *
 * Extracts translatable text segments from `.docx` files using JSZip and fast-xml-parser.
 * Preserves the original document package, including all styles, images, drawings, headers,
 * footers, and non-text elements untouched.
 */
export class DOCXAdapter implements DocumentAdapter {
  readonly format: SupportedFormat = 'docx';
  private readonly xmlParser: XMLParser;

  constructor() {
    this.xmlParser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      preserveOrder: true,
      parseTagValue: false,
      trimValues: false,
    });
  }

  async parse(fileBuffer: Buffer, fileName: string): Promise<TranslationDocument> {
    logger.info(`[DOCXAdapter] Unpacking DOCX archive: ${fileName}`);

    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(fileBuffer);
    } catch (err) {
      throw new Error(`Invalid DOCX package: ${(err as Error).message}`);
    }

    const documentXmlFile = zip.file('word/document.xml');
    if (!documentXmlFile) {
      throw new Error('Invalid DOCX package: missing word/document.xml');
    }

    const documentXml = await documentXmlFile.async('string');
    const segments: TranslationSegment[] = [];
    const nodeRefs: DocxNodeRef[] = [];

    // Parse document.xml to extract paragraphs (<w:p>)
    const parsed = this.xmlParser.parse(documentXml);

    let segmentIndex = 0;
    this.traverseParagraphs(parsed, (text, _pNode) => {
      const trimmed = text.trim();
      if (!trimmed) return; // Skip empty paragraphs

      const segmentId = `p-${segmentIndex + 1}`;

      // Source text is clean plain text
      const sourceText = trimmed;
      // Source raw preserves raw text structure for translation pipeline
      const sourceRaw = sourceText;

      segments.push({
        id: segmentId,
        index: segmentIndex,
        sourceRaw,
        sourceText,
        status: 'pending',
      });

      nodeRefs.push({
        segmentId,
        paragraphIndex: segmentIndex,
        originalText: sourceText,
      });

      segmentIndex++;
    });

    logger.info(`[DOCXAdapter] Extracted ${segments.length} translatable segments from ${fileName}`);

    const formatContext: DocxFormatContext = {
      zip,
      documentXml,
      nodeRefs,
    };

    return {
      id: fileName,
      sourceFormat: 'docx',
      originalFileName: fileName,
      segments,
      formatContext,
    };
  }

  /**
   * Recursively traverses XML tree looking for <w:p> paragraphs and extracts text.
   */
  private traverseParagraphs(
    nodes: unknown[],
    onParagraph: (text: string, pNode: Record<string, unknown>) => void
  ): void {
    if (!Array.isArray(nodes)) return;

    for (const node of nodes) {
      if (typeof node !== 'object' || node === null) continue;

      const obj = node as Record<string, unknown>;

      if ('w:p' in obj) {
        const text = this.extractTextFromParagraph(obj['w:p'] as unknown[]);
        onParagraph(text, obj);
      } else {
        // Recurse into child element arrays
        for (const [key, value] of Object.entries(obj)) {
          if (key !== ':@' && key !== '#text' && Array.isArray(value)) {
            this.traverseParagraphs(value, onParagraph);
          }
        }
      }
    }
  }

  /**
   * Concatenates all <w:t> text nodes inside a paragraph into a single text string.
   */
  private extractTextFromParagraph(pChildren: unknown[]): string {
    if (!Array.isArray(pChildren)) return '';

    const parts: string[] = [];

    const recurseText = (children: unknown[]): void => {
      for (const child of children) {
        if (typeof child !== 'object' || child === null) continue;
        const obj = child as Record<string, unknown>;

        if ('w:t' in obj) {
          const tChildren = obj['w:t'] as unknown[];
          if (Array.isArray(tChildren)) {
            for (const tItem of tChildren) {
              if (typeof tItem === 'object' && tItem !== null && '#text' in tItem) {
                parts.push(String((tItem as Record<string, unknown>)['#text']));
              } else if (typeof tItem === 'string') {
                parts.push(tItem);
              }
            }
          }
        } else {
          for (const [key, value] of Object.entries(obj)) {
            if (key !== ':@' && key !== '#text' && Array.isArray(value)) {
              recurseText(value);
            }
          }
        }
      }
    };

    recurseText(pChildren);
    return parts.join('');
  }
}
