import * as fs from 'fs';
import * as path from 'path';
import { XMLParser } from 'fast-xml-parser';
import type { DocumentOutputGenerator } from './DocumentOutputGenerator.js';
import type {
  TranslationDocument,
  TranslationResult,
  ValidationReport,
  OutputResult,
} from '../types/index.js';
import type { DocxFormatContext } from '../adapters/DOCXAdapter.js';
import { DOCXAdapter } from '../adapters/DOCXAdapter.js';
import { OutputGenerator } from './OutputGenerator.js';
import { logger } from '../config/logger.js';

/**
 * DOCXOutputGenerator
 *
 * Replaces source text in `word/document.xml` with translated text,
 * validates XML well-formedness and ZIP package integrity, then writes
 * the translated `.docx` file.
 */
export class DOCXOutputGenerator implements DocumentOutputGenerator {
  private readonly xmlParser: XMLParser;

  constructor() {
    this.xmlParser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
    });
  }

  async generate(
    doc: TranslationDocument,
    results: TranslationResult[],
    validationReport: ValidationReport,
    outputPath: string
  ): Promise<OutputResult> {
    // 1. Block output only if critical structural failures (unrestored tokens) exist.
    //    API failures (quota, timeout) are non-structural and allow partial output.
    const criticalFailures = validationReport.failedSegments.filter(
      (f) => f.errorType === 'tag_error' || f.errorType === 'entity_error'
    );

    if (criticalFailures.length > 0) {
      const diagDetails = criticalFailures.map(f => `[ID: ${f.segmentId} | Reason: ${f.message}]`).join(', ');
      const message = `DOCX output blocked: ${criticalFailures.length} segment(s) have unrestored tag or entity tokens. Diagnostics: ${diagDetails}`;
      logger.error(`[DOCXOutputGenerator] ${message}`);
      return {
        success: false,
        outputFilePath: outputPath,
        validationReport,
        errorMessage: message,
      };
    }

    const context = doc.formatContext as DocxFormatContext;
    if (!context || !context.zip || !context.documentXml) {
      const message = 'Invalid DOCX format context for output generation.';
      logger.error(`[DOCXOutputGenerator] ${message}`);
      return {
        success: false,
        outputFilePath: outputPath,
        validationReport,
        errorMessage: message,
      };
    }

    // Count how many segments actually completed translation
    const completedResults = results.filter((r) => r.status === 'completed' && r.translatedText);
    const apiFailures = validationReport.failedSegments.filter((f) => f.errorType === 'api_error');

    // If EVERY segment failed due to API errors (quota/timeout), block output and surface the cause
    if (completedResults.length === 0 && results.length > 0) {
      const firstFailure = results.find((r) => r.status === 'failed');
      const rootCause = firstFailure?.errorMessage ?? 'All API calls failed';
      const apiFailureHint = /(?:model.+not found|not supported for generatecontent)/i.test(rootCause)
        ? 'This is a model configuration error. Select a model supported by the active provider and update its model environment variable.'
        : "This is likely an API quota, authentication, or network error — check the selected provider's API key and rate limits.";
      const message =
        `DOCX output blocked: 0 of ${results.length} segments were translated. ` +
        `Root cause: ${rootCause}. ` +
        (apiFailures.length > 0
          ? apiFailureHint
          : `Check backend logs for details.`);
      logger.error(`[DOCXOutputGenerator] ${message}`);
      return {
        success: false,
        outputFilePath: outputPath,
        validationReport,
        errorMessage: message,
      };
    }

    const resultMap = new Map<string, TranslationResult>(
      results.map((r) => [r.segmentId, r])
    );

    // Map original extracted text to translated text
    const translationByText = new Map<string, string>();
    for (const ref of context.nodeRefs) {
      const res = resultMap.get(ref.segmentId);
      if (res && res.status === 'completed' && res.translatedText) {
        translationByText.set(ref.originalText.trim(), res.translatedText);
      }
    }

    let updatedXml = context.documentXml;
    let replacedCount = 0;

    // 2. Perform robust XML paragraph text replacement across split <w:t> runs
    const pRegex = /<w:p(?:[\s>][\s\S]*?<\/w:p>|>[\s\S]*?<\/w:p>)/g;
    updatedXml = updatedXml.replace(pRegex, (pXml) => {
      // Extract plain text inside this paragraph
      const textParts: string[] = [];
      const tExtractRegex = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
      let match: RegExpExecArray | null;
      while ((match = tExtractRegex.exec(pXml)) !== null) {
        if (match[1]) textParts.push(match[1]);
      }
      const rawText = textParts.join('').trim();
      if (!rawText) return pXml;

      const translatedText = translationByText.get(rawText);
      if (translatedText !== undefined) {
        replacedCount++;
        let isFirst = true;
        const escapedTranslation = OutputGenerator.escapeXml(translatedText);
        return pXml.replace(/<w:t([^>]*)>([\s\S]*?)<\/w:t>/g, () => {
          if (isFirst) {
            isFirst = false;
            return `<w:t xml:space="preserve">${escapedTranslation}</w:t>`;
          }
          return `<w:t></w:t>`;
        });
      }

      return pXml;
    });

    logger.info(
      `[DOCXOutputGenerator] Replaced ${replacedCount}/${context.nodeRefs.length} text segments in word/document.xml` +
      (apiFailures.length > 0 ? ` (${apiFailures.length} segment(s) skipped due to API failure)` : '')
    );

    // 3. Validate XML well-formedness of updated word/document.xml
    try {
      this.xmlParser.parse(updatedXml);
    } catch (xmlErr) {
      const message = `Updated word/document.xml is not well-formed: ${(xmlErr as Error).message}`;
      logger.error(`[DOCXOutputGenerator] ${message}`);
      return {
        success: false,
        outputFilePath: outputPath,
        validationReport,
        errorMessage: message,
      };
    }

    // 4. Update word/document.xml in ZIP archive
    context.zip.file('word/document.xml', updatedXml);

    // 5. Generate output ZIP buffer
    let outputBuffer: Buffer;
    try {
      outputBuffer = await context.zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      });
    } catch (zipErr) {
      const message = `Failed to generate DOCX ZIP package: ${(zipErr as Error).message}`;
      logger.error(`[DOCXOutputGenerator] ${message}`);
      return {
        success: false,
        outputFilePath: outputPath,
        validationReport,
        errorMessage: message,
      };
    }

    // 6. Write file to disk
    try {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, outputBuffer);
      logger.info(`[DOCXOutputGenerator] Output DOCX written to: ${outputPath}`);
    } catch (ioErr) {
      const message = `Failed to write DOCX output file: ${(ioErr as Error).message}`;
      logger.error(`[DOCXOutputGenerator] ${message}`);
      return {
        success: false,
        outputFilePath: outputPath,
        validationReport,
        errorMessage: message,
      };
    }

    // 7. Re-parse generated DOCX to verify ZIP integrity & reopenability
    try {
      const docxAdapter = new DOCXAdapter();
      await docxAdapter.parse(outputBuffer, path.basename(outputPath));
      logger.info(`[DOCXOutputGenerator] Re-parse check passed: Output DOCX is valid and reopenable.`);
    } catch (reparseErr) {
      const message = `Re-openability check failed for generated DOCX: ${(reparseErr as Error).message}`;
      logger.error(`[DOCXOutputGenerator] ${message}`);
      return {
        success: false,
        outputFilePath: outputPath,
        validationReport,
        errorMessage: message,
      };
    }

    return {
      success: true,
      outputFilePath: outputPath,
      validationReport,
    };
  }
}
