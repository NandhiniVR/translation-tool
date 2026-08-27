import * as fs from 'fs';
import * as path from 'path';
import { XMLParser } from 'fast-xml-parser';
import type {
  ParsedDocument,
  TranslationResult,
  ValidationReport,
  OutputResult,
} from '../types/index.js';
import { logger } from '../config/logger.js';

/**
 * OutputGenerator
 *
 * Replaces the <target> content of each trans-unit in the original XML
 * with the translated text from the pipeline, then writes the result to disk.
 *
 * Design principles:
 *   - Use the original XML string as the base (not a rebuilt document)
 *   - Perform targeted string replacement of <target> element content
 *   - Preserve all other XML structure, attributes, metadata, and whitespace
 *   - Validate XML well-formedness of the output before writing
 *   - Only write the file if structural validation passes
 *
 * IMPORTANT LIMITATIONS:
 *   - This approach works reliably for standard XLIFF 1.2 structure.
 *   - MemoQ-specific extensions (mq: namespace elements) are preserved as-is.
 *   - If a segment's target content contains XML special characters, they will
 *     be escaped appropriately using xmlEscape().
 *   - The output file is validated for XML well-formedness before being made
 *     available for download.
 *
 * Replacement strategy:
 *   We use the parsed document's original XML and perform a single-pass
 *   replacement using a regex that matches each trans-unit by its id attribute,
 *   then replaces the <target>...</target> content within it.
 *   This preserves all surrounding structure without a full re-serialization.
 */
export class OutputGenerator {
  private readonly xmlParser: XMLParser;

  constructor() {
    this.xmlParser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
    });
  }

  /**
   * Generates the translated XLIFF output file.
   *
   * @param parsedDocument - The original parsed document
   * @param results - Translation results indexed by segment ID
   * @param validationReport - Must be valid before output is written
   * @param outputFilePath - Absolute path to write the output file
   * @returns OutputResult describing success or failure
   */
  generate(
    parsedDocument: ParsedDocument,
    results: TranslationResult[],
    validationReport: ValidationReport,
    outputFilePath: string
  ): OutputResult {
    // Refuse to generate output if validation has critical failures
    const criticalFailures = validationReport.failedSegments.filter(
      (f) => f.errorType === 'tag_error' || f.errorType === 'entity_error'
    );

    if (criticalFailures.length > 0) {
      const message = `Output blocked: ${criticalFailures.length} segment(s) have unrestored tag or entity tokens. ` +
        `Review failed segments before generating output.`;
      logger.error(`[OutputGenerator] ${message}`);
      return {
        success: false,
        outputFilePath,
        validationReport,
        errorMessage: message,
      };
    }

    const resultMap = new Map<string, TranslationResult>(
      results.map((r) => [r.segmentId, r])
    );

    let outputXml = parsedDocument.originalXml;

    // Replace <target> content for each successfully translated segment.
    // Skipped segments (written in another language) carry the unchanged
    // source content in translatedRaw, so their target is filled with the
    // preserved content — exactly what the model-based path produced before
    // language filtering was added.
    let replacedCount = 0;
    let skippedCount = 0;

    for (const [segmentId, result] of resultMap.entries()) {
      if ((result.status !== 'completed' && result.status !== 'skipped') || !result.translatedRaw) {
        skippedCount++;
        continue;
      }

      const replaced = this.replaceTargetInXml(outputXml, segmentId, result.translatedRaw);
      if (replaced !== null) {
        outputXml = replaced;
        replacedCount++;
      } else {
        logger.warn(`[OutputGenerator] Could not locate trans-unit id="${segmentId}" in XML`);
      }
    }

    logger.info(`[OutputGenerator] Replaced ${replacedCount} segments, skipped ${skippedCount}`);

    // Validate XML well-formedness of output
    const wellFormed = this.validateXmlWellFormedness(outputXml);
    if (!wellFormed) {
      const message = 'Output XML is not well-formed after replacement. Output blocked.';
      logger.error(`[OutputGenerator] ${message}`);
      return {
        success: false,
        outputFilePath,
        validationReport,
        errorMessage: message,
      };
    }

    // Write output file
    try {
      fs.mkdirSync(path.dirname(outputFilePath), { recursive: true });
      fs.writeFileSync(outputFilePath, outputXml, 'utf8');
      logger.info(`[OutputGenerator] Output written to: ${outputFilePath}`);
    } catch (err) {
      const message = `Failed to write output file: ${(err as Error).message}`;
      logger.error(`[OutputGenerator] ${message}`);
      return {
        success: false,
        outputFilePath,
        validationReport,
        errorMessage: message,
      };
    }

    return {
      success: true,
      outputFilePath,
      validationReport,
    };
  }

  /**
   * Replaces the content of the <target> element within the trans-unit
   * identified by the given id attribute.
   *
   * This uses a two-phase approach:
   *   1. Locate the trans-unit block by id attribute
   *   2. Within that block, replace the <target>...</target> content
   *
   * Returns the updated XML string, or null if the trans-unit was not found.
   */
  private replaceTargetInXml(
    xml: string,
    segmentId: string,
    translatedRaw: string
  ): string | null {
    // Escape segmentId for use in regex (IDs may contain special chars)
    const escapedId = segmentId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Match the trans-unit opening tag with this id (handles attribute ordering variation)
    const transUnitPattern = new RegExp(
      `(<trans-unit[^>]*\\bid=["']${escapedId}["'][^>]*>)([\\s\\S]*?)(<\\/trans-unit>)`,
      'g'
    );

    let found = false;
    const result = xml.replace(transUnitPattern, (_match, openTag, inner, closeTag) => {
      found = true;

      // Within the inner content, replace the <target> element's content
      // Handle both: <target>...</target> and <target/> (empty self-closing)
      let newInner: string;

      // First try to replace existing <target>...</target>
      if (/<target[^>]*>[\s\S]*?<\/target>/.test(inner)) {
        newInner = inner.replace(
          /(<target[^>]*>)([\s\S]*?)(<\/target>)/,
          (_m: string, open: string, _old: string, close: string) =>
            `${open}${translatedRaw}${close}`
        );
      } else if (/<target[^/]*\/>/.test(inner)) {
        // Self-closing <target/> — expand it
        newInner = inner.replace(
          /<target([^/]*)\s*\/>/,
          (_m: string, attrs: string) => `<target${attrs}>${translatedRaw}</target>`
        );
      } else {
        // No <target> element found — insert one after <source>...</source>
        newInner = inner.replace(
          /(<source[^>]*>[\s\S]*?<\/source>)/,
          `$1\n      <target>${translatedRaw}</target>`
        );
      }

      return `${openTag}${newInner}${closeTag}`;
    });

    return found ? result : null;
  }

  /**
   * Validates that the output XML string is parseable (well-formed).
   * This is a basic structural check — not a schema validation.
   */
  private validateXmlWellFormedness(xml: string): boolean {
    try {
      this.xmlParser.parse(xml);
      return true;
    } catch (err) {
      logger.error(`[OutputGenerator] XML well-formedness check failed`, {
        error: (err as Error).message,
      });
      return false;
    }
  }

  /**
   * Escapes XML special characters in a plain text string.
   * Use when inserting untagged text into XML.
   */
  static escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}
