import * as fs from 'fs';
import * as path from 'path';
import { XMLValidator } from 'fast-xml-parser';
import type { DocumentOutputGenerator } from './DocumentOutputGenerator.js';
import type {
  TranslationDocument,
  TranslationResult,
  ValidationReport,
  OutputResult,
  OutputGenerateOptions,
} from '../types/index.js';
import type { DocxFormatContext, DocxNodeRef } from '../adapters/DOCXAdapter.js';
import { DOCXAdapter } from '../adapters/DOCXAdapter.js';
import { OutputGenerator } from './OutputGenerator.js';
import { isRtlLanguage } from '../languages/languageRegistry.js';
import { logger } from '../config/logger.js';

/**
 * DOCXOutputGenerator
 *
 * Replaces source text in `word/document.xml` with translated text,
 * validates XML well-formedness and ZIP package integrity, then writes
 * the translated `.docx` file.
 *
 * Output formats:
 *   - 'translation-only' (default): original paragraphs are replaced by their
 *     translations in place (existing behavior).
 *   - 'bilingual':
 *       - Non-table paragraphs are wrapped in a two-column table
 *         (Original | Translation) so the source and its translation appear
 *         side-by-side.
 *       - Existing tables are preserved EXACTLY as-is (no translation columns
 *         are added) and a separate mirror translation table is inserted
 *         immediately after each original table.
 *     RTL target languages get proper paragraph/run direction.
 */
export class DOCXOutputGenerator implements DocumentOutputGenerator {
  async generate(
    doc: TranslationDocument,
    results: TranslationResult[],
    validationReport: ValidationReport,
    outputPath: string,
    options?: OutputGenerateOptions
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

    const outputFormat = options?.outputFormat ?? 'translation-only';
    const targetIsRtl = options?.targetLanguage ? isRtlLanguage(options.targetLanguage) : false;

    // Count how many segments actually completed translation or were skipped
    // (skipped = written in another language, passed through unchanged)
    const completedResults = results.filter((r) => r.status === 'completed' && r.translatedText);
    const skippedResults = results.filter((r) => r.status === 'skipped' && r.translatedText);
    const apiFailures = validationReport.failedSegments.filter((f) => f.errorType === 'api_error');

    // If EVERY segment failed due to API errors (quota/timeout), block output
    // and surface the cause. Skipped segments are legitimately handled (their
    // content is preserved unchanged), so they do not block output.
    if (completedResults.length === 0 && skippedResults.length === 0 && results.length > 0) {
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

    let updatedXml = context.documentXml;
    let replacedCount = 0;

    if (outputFormat === 'bilingual') {
      // 2a. Bilingual mode: pair every translatable paragraph with its
      //     translation in a two-column (Original | Translation) table.
      //     nodeRefs are in document order, so we pair paragraphs sequentially
      //     to guarantee 1:1 segment ordering (also safe for duplicate texts).
      const replaced = this.buildBilingualXml(context, resultMap, targetIsRtl);
      updatedXml = replaced.updatedXml;
      replacedCount = replaced.replacedCount;
    } else {
      // 2b. Translation-only mode (existing behavior)

      // Map original extracted text to translated text
      const translationByText = new Map<string, string>();
      for (const ref of context.nodeRefs) {
        const res = resultMap.get(ref.segmentId);
        if (res && res.status === 'completed' && res.translatedText) {
          translationByText.set(ref.originalText.trim(), res.translatedText);
        }
      }

      // Perform robust XML paragraph text replacement across split <w:t> runs
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
    }

    logger.info(
      `[DOCXOutputGenerator] Replaced ${replacedCount}/${context.nodeRefs.length} text segments in word/document.xml` +
      (apiFailures.length > 0 ? ` (${apiFailures.length} segment(s) skipped due to API failure)` : '')
    );

    // 3. Validate XML well-formedness of updated word/document.xml.
    //    Use the STRICT validator: fast-xml-parser's lenient `parse()` silently
    //    recovers from unbalanced tags (e.g. a missing `</w:tc>`), which would
    //    produce a file Word refuses to open. XMLValidator rejects such files.
    const validation = XMLValidator.validate(updatedXml);
    if (validation !== true) {
      const detail = typeof validation === 'object' && validation.err ? validation.err.msg : 'unknown XML error';
      const message = `Updated word/document.xml is not well-formed: ${detail}`;
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

  /**
   * Builds the bilingual document XML.
   *
   * Rules:
   *   - Non-table paragraphs are wrapped in a two-column table row
   *     (Original | Translation). The original paragraph markup (including its
   *     pPr/rPr formatting) is kept verbatim in the Original cell; the
   *     Translation cell reuses the same markup with the translated text.
   *   - Existing tables are preserved EXACTLY as-is (no translation columns
   *     are added); a separate mirror translation table is inserted
   *     immediately after each original table.
   *
   * Paragraphs are paired sequentially with `context.nodeRefs` (document
   * order) to preserve 1:1 segment ordering, including paragraphs inside
   * tables. RTL target languages get proper paragraph/run bidi properties.
   */
  private buildBilingualXml(
    context: DocxFormatContext,
    resultMap: Map<string, TranslationResult>,
    targetIsRtl: boolean
  ): { updatedXml: string; replacedCount: number } {
    // Balance-aware block scan: emits complete outermost <w:p> and <w:tbl>
    // spans. A naive `<w:p...>...</w:p>` regex stops at the FIRST `</w:p>`,
    // which breaks on nested paragraphs (e.g. text inside a floating text
    // box), producing unbalanced XML that corrupts the DOCX.
    const blocks = this.scanDocumentBlocks(context.documentXml);

    let refIndex = 0;
    let replacedCount = 0;
    const chunks: string[] = [];
    let cursor = 0;

    for (const block of blocks) {
      // Preserve everything before this block verbatim
      chunks.push(context.documentXml.slice(cursor, block.start));
      cursor = block.end;

      if (block.type === 'table') {
        const built = this.buildBilingualTable(block.xml, context.nodeRefs, resultMap, targetIsRtl, refIndex);
        refIndex = built.refIndex;
        replacedCount += built.replacedCount;
        chunks.push(built.tableXml);
        continue;
      }

      const rawText = this.extractParagraphText(block.xml).trim();
      if (!rawText) {
        chunks.push(block.xml); // e.g. blank separator paragraph — keep verbatim
        continue;
      }

      const ref = context.nodeRefs[refIndex];
      refIndex++;
      if (!ref) {
        chunks.push(block.xml);
        continue;
      }

      const res = resultMap.get(ref.segmentId);
      if (!res || (res.status !== 'completed' && res.status !== 'skipped') || !res.translatedText) {
        // No completed translation — keep the original paragraph untouched
        chunks.push(block.xml);
        continue;
      }

      replacedCount++;
      const translationParagraph = this.buildTranslationParagraph(block.xml, res.translatedText, targetIsRtl);
      chunks.push(this.wrapBilingualRow(block.xml, translationParagraph));
    }

    chunks.push(context.documentXml.slice(cursor));
    return { updatedXml: chunks.join(''), replacedCount };
  }

  /**
   * Scans a fragment for complete outermost `<w:p>` and `<w:tbl>` elements,
   * tracking nesting depth so nested paragraphs (text boxes) and nested
   * tables never split a span. Returns spans in document order. Only elements
   * not contained inside another paragraph/table are emitted, which matches
   * how the DOCXAdapter enumerates segments.
   */
  private scanDocumentBlocks(
    xml: string
  ): Array<{ type: 'paragraph' | 'table'; start: number; end: number; xml: string }> {
    const tagRe = /<w:p(?=[\s>])[^>]*>|<\/w:p>|<w:tbl(?=[\s>])[^>]*>|<\/w:tbl>/g;
    const blocks: Array<{ type: 'paragraph' | 'table'; start: number; end: number; xml: string }> = [];
    const stack: string[] = [];
    let blockStart = -1;
    let blockType: 'paragraph' | 'table' | null = null;
    let match: RegExpExecArray | null;

    while ((match = tagRe.exec(xml)) !== null) {
      const token = match[0];
      const isClose = token[1] === '/';
      const name = isClose
        ? token.slice(2, token.indexOf('>'))
        : token.slice(1, token.indexOf('>')).trim().split(/\s/)[0];

      if (!isClose) {
        // Self-closing element (e.g. `<w:p />`) has no content and no closing
        // tag, so it must not open a block. Without this guard, the phantom
        // open never gets closed and every following block is silently left
        // verbatim, which drops the translations from the bilingual output.
        // (`<w:p/>` without a space is not matched by the regex at all.)
        if (token.endsWith('/>')) continue;
        if (stack.length === 0) {
          blockStart = match.index;
          blockType = name === 'w:p' ? 'paragraph' : 'table';
        }
        stack.push(name);
      } else {
        stack.pop(); // input is well-formed (the adapter parsed it)
        if (stack.length === 0 && blockStart !== -1) {
          blocks.push({
            type: blockType!,
            start: blockStart,
            end: tagRe.lastIndex,
            xml: xml.slice(blockStart, tagRe.lastIndex),
          });
          blockStart = -1;
          blockType = null;
        }
      }
    }

    return blocks;
  }

  /**
   * Scans a fragment for complete balanced `<tagName>` elements (tracking
   * nesting depth), returning spans in document order. Never matches the
   * `Pr` variants (`<w:pPr>`, `<w:tcPr>`, `<w:trPr>`, `<w:tblPr>`).
   */
  private scanBalancedElements(
    xml: string,
    tagName: 'w:p' | 'w:tr' | 'w:tc'
  ): Array<{ start: number; end: number; xml: string }> {
    const openRe = new RegExp(`<${tagName}(?=[\\s>])[^>]*>|<\\/${tagName}>`, 'g');
    const spans: Array<{ start: number; end: number; xml: string }> = [];
    let depth = 0;
    let start = -1;
    let match: RegExpExecArray | null;

    while ((match = openRe.exec(xml)) !== null) {
      if (match[0][1] === '/') {
        depth--;
        if (depth === 0 && start !== -1) {
          spans.push({ start, end: openRe.lastIndex, xml: xml.slice(start, openRe.lastIndex) });
          start = -1;
        }
      } else {
        // Self-closing element (e.g. `<w:tr />`): no content, no closing tag —
        // skip it so it cannot unbalance the depth tracking.
        if (match[0].endsWith('/>')) continue;
        if (depth === 0) start = match.index;
        depth++;
      }
    }

    return spans;
  }

  /**
   * Processes an existing `<w:tbl>` for bilingual output:
   *   - 2-column (or multi-column) rows: keeps Left Cell (Cell 0) untouched as
   *     the original text; populates / replaces Right Cell (Cell 1) with the
   *     translation of Cell 0's segment.
   *   - 1-column rows: keeps Cell 0 untouched as the original text; appends a
   *     new 2nd cell containing the translation right before `</w:tr>`.
   */
  private buildBilingualTable(
    tableXml: string,
    nodeRefs: DocxNodeRef[],
    resultMap: Map<string, TranslationResult>,
    targetIsRtl: boolean,
    startRefIndex: number
  ): { tableXml: string; refIndex: number; replacedCount: number } {
    const rows = this.scanBalancedElements(tableXml, 'w:tr');
    if (rows.length === 0) {
      return { tableXml, refIndex: startRefIndex, replacedCount: 0 };
    }

    let refIndex = startRefIndex;
    let replacedCount = 0;
    const updatedRows: string[] = [];
    let hasExpandedOneCol = false;

    for (const row of rows) {
      const cells = this.scanBalancedElements(row.xml, 'w:tc');
      if (cells.length === 0) {
        updatedRows.push(row.xml);
        continue;
      }

      // Extract raw text of cell 0 to see if it corresponds to the next nodeRef
      const cell0Text = this.extractParagraphText(cells[0].xml).trim();
      let translationText: string | undefined;

      if (cell0Text && refIndex < nodeRefs.length) {
        const ref = nodeRefs[refIndex];
        if (ref) {
          refIndex++;
          const res = resultMap.get(ref.segmentId);
          if (res && (res.status === 'completed' || res.status === 'skipped') && res.translatedText) {
            translationText = res.translatedText;
            replacedCount++;
          }
        }
      }

      if (!translationText) {
        // No translation available — keep row untouched
        updatedRows.push(row.xml);
        continue;
      }

      // Extract just the inner paragraph(s) from cell 0 for building the translation.
      const cell0Blocks = this.scanDocumentBlocks(cells[0].xml);
      const cell0FirstPara = cell0Blocks.find((b) => b.type === 'paragraph');
      const pXmlForTranslation = cell0FirstPara?.xml ?? cells[0].xml;

      const translationParagraph = this.buildTranslationParagraph(
        pXmlForTranslation,
        translationText,
        targetIsRtl
      );

      if (cells.length >= 2) {
        // Case A: 2-column or multi-column table.
        // Keep Cell 0 intact; update Cell 1 content with translationText in-place,
        // preserving Cell 1's original tcPr, pPr, formatting, borders, and cell width.
        for (let i = 1; i < cells.length; i++) {
          const cellIText = this.extractParagraphText(cells[i].xml).trim();
          if (cellIText && refIndex < nodeRefs.length) {
            if (nodeRefs[refIndex]?.originalText.trim() === cellIText) {
              refIndex++;
            }
          }
        }

        const cell1Original = cells[1].xml;
        const cell1Clean = this.stripParagraphIndentation(cell1Original);
        const newCell1Xml = this.buildTranslationParagraph(cell1Clean, translationText, targetIsRtl);

        const beforeCell1 = row.xml.slice(0, cells[1].start);
        const afterCell1 = row.xml.slice(cells[1].end);
        updatedRows.push(`${beforeCell1}${newCell1Xml}${afterCell1}`);
      } else {
        // Case B: 1-column table.
        // Keep Cell 0 intact; append a 2nd cell containing translationParagraph before </w:tr>.
        hasExpandedOneCol = true;
        const colWidth = '4680';
        const cell2Xml = `<w:tc><w:tcPr><w:tcW w:w="${colWidth}" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/></w:tcPr>${translationParagraph}</w:tc>`;
        const closeTrIndex = row.xml.lastIndexOf('</w:tr>');
        if (closeTrIndex > -1) {
          const newRowXml = row.xml.slice(0, closeTrIndex) + cell2Xml + '</w:tr>';
          updatedRows.push(newRowXml);
        } else {
          updatedRows.push(row.xml);
        }
      }
    }

    const openTagEnd = tableXml.indexOf('>') + 1;
    const firstRowStart = rows[0]!.start;
    let headerXml = tableXml.slice(openTagEnd, firstRowStart);
    const openTag = tableXml.slice(0, openTagEnd);

    // If a 1-column table was expanded to 2 columns, update <w:tblGrid> to include a 2nd gridCol
    if (hasExpandedOneCol) {
      if (/<w:tblGrid[\s\S]*?<\/w:tblGrid>/.test(headerXml)) {
        headerXml = headerXml.replace(/(<w:tblGrid[^>]*>[\s\S]*?)(<\/w:tblGrid>)/, `$1<w:gridCol w:w="4680"/>$2`);
      } else {
        headerXml = `${headerXml}<w:tblGrid><w:gridCol w:w="4680"/><w:gridCol w:w="4680"/></w:tblGrid>`;
      }
    }

    const updatedTableXml = `${openTag}${headerXml}${updatedRows.join('')}</w:tbl>`;
    return { tableXml: updatedTableXml, refIndex, replacedCount };
  }

  /**
   * Strips left and firstLine indentation attributes from `<w:ind>` tags inside
   * paragraph properties. When paragraphs are placed inside table cells,
   * page-level left indentations (e.g. `w:left="2160"`) push text far to the
   * right inside the cell, creating a large empty space on the left of the cell.
   */
  private stripParagraphIndentation(pXml: string): string {
    return pXml.replace(/(<w:ind\b[^>]*>)/g, (indTag) => {
      return indTag
        .replace(/\sw:left="[^"]*"/g, '')
        .replace(/\sw:firstLine="[^"]*"/g, '')
        .replace(/\sw:hanging="[^"]*"/g, '');
    });
  }

  /**
   * Builds a separate translation table mirroring an original `<w:tbl>`:
   * same header (tblPr/tblGrid), same row/column structure, with each cell's
   * paragraphs replaced by their translations. Nested tables inside cells are
   * preserved verbatim (their segments still consume refs to stay aligned).
   */
  private buildTranslationTable(
    tableXml: string,
    nodeRefs: DocxNodeRef[],
    resultMap: Map<string, TranslationResult>,
    targetIsRtl: boolean,
    startRefIndex: number
  ): { translationTableXml: string | null; refIndex: number; replacedCount: number } {
    const rows = this.scanBalancedElements(tableXml, 'w:tr');
    if (rows.length === 0) {
      return { translationTableXml: null, refIndex: startRefIndex, replacedCount: 0 };
    }

    // Keep the original opening tag, tblPr, and tblGrid verbatim
    const openTagEnd = tableXml.indexOf('>') + 1;
    const headerXml = tableXml.slice(openTagEnd, rows[0]!.start);
    const openTag = tableXml.slice(0, openTagEnd);

    let refIndex = startRefIndex;
    let replacedCount = 0;
    const translationRows: string[] = [];

    for (const row of rows) {
      const cells = this.scanBalancedElements(row.xml, 'w:tc');
      const translationCells: string[] = [];

      for (const cell of cells) {
        const built = this.buildTranslationCell(cell.xml, nodeRefs, resultMap, targetIsRtl, refIndex);
        refIndex = built.refIndex;
        replacedCount += built.replacedCount;
        translationCells.push(built.cellXml);
      }

      // Keep the row's properties (trPr, table-cell-merge markers) verbatim
      const rowPrEnd = row.xml.search(/<w:tc(?=[\s>])/);
      if (rowPrEnd === -1) {
        // Degenerate row without cells — keep it verbatim
        translationRows.push(row.xml);
        continue;
      }
      const rowPrXml = row.xml.slice(0, rowPrEnd);
      translationRows.push(`${rowPrXml}${translationCells.join('')}</w:tr>`);
    }

    const translationTableXml =
      `${openTag}${headerXml}${translationRows.join('')}</w:tbl>`;

    return { translationTableXml, refIndex, replacedCount };
  }

  /**
   * Builds a single translation-table cell: keeps the cell's properties
   * (tcPr) verbatim and replaces each paragraph with its translation. The
   * cell is shaded light gray so the translation table is visually
   * distinguishable from the original table.
   */
  private buildTranslationCell(
    cellXml: string,
    nodeRefs: DocxNodeRef[],
    resultMap: Map<string, TranslationResult>,
    targetIsRtl: boolean,
    startRefIndex: number
  ): { cellXml: string; refIndex: number; replacedCount: number } {
    // Keep the cell's properties (tcPr) verbatim. Everything before the first
    // block element (paragraph/table) is cell properties; the closing `</w:tc>`
    // is re-appended below, so it must not be included in the prefix.
    let tcPrXml: string;
    const firstBlock = cellXml.search(/<w:p(?=[\s>])|<w:tbl(?=[\s>])/);
    if (firstBlock > -1) {
      tcPrXml = cellXml.slice(0, firstBlock);
    } else {
      const closeTc = cellXml.lastIndexOf('</w:tc>');
      tcPrXml = closeTc > -1 ? cellXml.slice(0, closeTc) : cellXml;
    }

    let refIndex = startRefIndex;
    let replacedCount = 0;
    const parts: string[] = [];

    for (const block of this.scanDocumentBlocks(cellXml)) {
      if (block.type === 'table') {
        // Nested table: build its own mirror translation table recursively so
        // the segments it contains are still paired with their translations
        // instead of being silently discarded.
        const built = this.buildTranslationTable(block.xml, nodeRefs, resultMap, targetIsRtl, refIndex);
        refIndex = built.refIndex;
        replacedCount += built.replacedCount;
        parts.push(built.translationTableXml ?? block.xml);
        continue;
      }

      const rawText = this.extractParagraphText(block.xml).trim();
      if (!rawText) {
        parts.push(block.xml);
        continue;
      }

      const ref = nodeRefs[refIndex];
      refIndex++;
      if (!ref) {
        parts.push(block.xml);
        continue;
      }

      const res = resultMap.get(ref.segmentId);
      if (!res || (res.status !== 'completed' && res.status !== 'skipped') || !res.translatedText) {
        parts.push(block.xml);
        continue;
      }

      replacedCount++;
      parts.push(this.buildTranslationParagraph(block.xml, res.translatedText, targetIsRtl));
    }

    const content = parts.join('');
    const cellWithContent = tcPrXml + (content || '<w:p/>') + '</w:tc>';
    return {
      cellXml: this.addCellShading(cellWithContent),
      refIndex,
      replacedCount,
    };
  }

  /**
   * Adds light-gray shading to a translation-table cell so the translation
   * table is visually distinguishable from the original table.
   */
  private addCellShading(cellXml: string): string {
    const shd = '<w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>';

    if (/<w:tcPr[^>]*\/>/.test(cellXml)) {
      return cellXml.replace(/(<w:tcPr[^>]*\/>)/, `<w:tcPr>${shd}</w:tcPr>`);
    }

    const tcPrMatch = cellXml.match(/(<w:tcPr[^>]*>)([\s\S]*?)(<\/w:tcPr>)/);
    if (tcPrMatch) {
      if (/<w:shd\b/.test(tcPrMatch[2]!)) {
        return cellXml;
      }
      const insertAt = tcPrMatch.index! + tcPrMatch[1]!.length;
      return cellXml.slice(0, insertAt) + shd + cellXml.slice(insertAt);
    }

    return cellXml.replace(/(<w:tc(?=[\s>])[^>]*>)/, `$1<w:tcPr>${shd}</w:tcPr>`);
  }

  /**
   * Concatenates the text of all `<w:t>` elements inside a paragraph span.
   */
  private extractParagraphText(pXml: string): string {
    const parts: string[] = [];
    const tExtractRegex = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
    let match: RegExpExecArray | null;
    while ((match = tExtractRegex.exec(pXml)) !== null) {
      if (match[1]) parts.push(match[1]);
    }
    return parts.join('');
  }

  /**
   * Builds the translation-side paragraph by reusing the original paragraph's
   * markup: first <w:t> gets the translation, remaining runs are emptied so the
   * paragraph keeps its original formatting. Strips drawing anchors, VML shapes,
   * objects, vanished/hidden text tags, and section breaks to prevent duplicate
   * IDs or layout corruption.
   */
  private buildTranslationParagraph(pXml: string, translatedText: string, targetIsRtl: boolean): string {
    const escapedTranslation = OutputGenerator.escapeXml(translatedText);

    // Strip ID-bearing markers, drawings, shapes, objects, vanished text tags, and section breaks from translation copy
    let result = pXml
      .replace(/<w:bookmarkStart[^>]*\/>/g, '')
      .replace(/<w:bookmarkEnd[^>]*\/>/g, '')
      .replace(/<w:commentRangeStart[^>]*\/>/g, '')
      .replace(/<w:commentRangeEnd[^>]*\/>/g, '')
      .replace(/<w:commentReference[^>]*\/>/g, '')
      .replace(/<w:drawing[\s\S]*?<\/w:drawing>/g, '')
      .replace(/<v:shape[\s\S]*?<\/v:shape>/g, '')
      .replace(/<v:group[\s\S]*?<\/v:group>/g, '')
      .replace(/<w:object[\s\S]*?<\/w:object>/g, '')
      .replace(/<mc:AlternateContent[\s\S]*?<\/mc:AlternateContent>/g, '')
      .replace(/<w:vanish[^>]*\/>/g, '')
      .replace(/<w:vanish[\s\S]*?<\/w:vanish>/g, '')
      .replace(/<w:sectPr[\s\S]*?<\/w:sectPr>/g, '')
      .replace(/<w:sectPr[^>]*\/>/g, '')
      .replace(/<w:proofErr[^>]*\/>/g, '');

    // Reset paragraph left/firstLine indentation so text is not pushed far to the right
    result = this.stripParagraphIndentation(result);

    // Make white text visible in target paragraph
    result = result.replace(/<w:color w:val="(?:FFFFFF|ffffff|white)"\/>/g, '<w:color w:val="auto"/>');

    let isFirst = true;
    result = result.replace(/<w:t\b([^>]*)>([\s\S]*?)<\/w:t>/g, (_match, _attrs: string, _content: string) => {
      if (isFirst) {
        isFirst = false;
        return `<w:t xml:space="preserve">${escapedTranslation}</w:t>`;
      }
      return `<w:t></w:t>`;
    });

    if (isFirst) {
      if (/<\/w:p>/.test(result)) {
        result = result.replace(/(<\/w:p>)/, `<w:r><w:t xml:space="preserve">${escapedTranslation}</w:t></w:r>$1`);
      } else {
        result = `<w:p><w:r><w:t xml:space="preserve">${escapedTranslation}</w:t></w:r></w:p>`;
      }
    }

    if (targetIsRtl) {
      result = this.addRtlProperties(result);
    }

    return result;
  }

  /**
   * Injects Word bidi properties into a paragraph for RTL rendering.
   */
  private addRtlProperties(pXml: string): string {
    let result = pXml;

    if (/<w:pPr[^>]*>/.test(result)) {
      result = result.replace(/(<w:pPr[^>]*>)/, '$1<w:bidi w:val="1"/>');
    } else if (/<w:pPr[^>]*\/>/.test(result)) {
      result = result.replace(/(<w:pPr[^>]*\/>)/, '<w:pPr><w:bidi w:val="1"/></w:pPr>');
    } else {
      result = result.replace(/(<w:p(?:\s[^>]*)?>)/, '$1<w:pPr><w:bidi w:val="1"/></w:pPr>');
    }

    if (/<w:rPr[^>]*>/.test(result)) {
      result = result.replace(/(<w:rPr[^>]*>)/, '$1<w:rtl w:val="1"/>');
    } else if (/<w:rPr[^>]*\/>/.test(result)) {
      result = result.replace(/(<w:rPr[^>]*\/>)/, '<w:rPr><w:rtl w:val="1"/></w:rPr>');
    } else {
      result = result.replace(/(<w:r(?:\s[^>]*)?>)/, '$1<w:rPr><w:rtl w:val="1"/></w:rPr>');
    }

    return result;
  }

  /**
   * Wraps the original and translation paragraphs in a two-column table row.
   * Extracts any section break (<w:sectPr>) from original paragraph properties so it is
   * never placed inside a table cell (which violates OpenXML and causes Word layout errors).
   * Strips paragraph left indentation from both cells to avoid empty left margins inside cells.
   */
  private wrapBilingualRow(originalParagraphXml: string, translationParagraphXml: string): string {
    const colWidth = '4680'; // half of page width in twips

    let sectPrXml = '';
    let cleanOriginal = originalParagraphXml.replace(/(<w:sectPr[\s\S]*?<\/w:sectPr>|<w:sectPr[^>]*\/>)/g, (match) => {
      sectPrXml = match;
      return '';
    });
    let cleanTranslation = translationParagraphXml.replace(/(<w:sectPr[\s\S]*?<\/w:sectPr>|<w:sectPr[^>]*\/>)/g, '');

    // Strip paragraph left/firstLine indentation from both cells so text starts at the cell border
    cleanOriginal = this.stripParagraphIndentation(cleanOriginal);
    cleanTranslation = this.stripParagraphIndentation(cleanTranslation);

    const tblXml = (
      `<w:tbl>` +
      `<w:tblPr>` +
      `<w:tblW w:w="0" w:type="auto"/>` +
      `<w:tblBorders>` +
      `<w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/>` +
      `<w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/>` +
      `<w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/>` +
      `<w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/>` +
      `<w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/>` +
      `<w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/>` +
      `</w:tblBorders>` +
      `</w:tblPr>` +
      `<w:tblGrid><w:gridCol w:w="${colWidth}"/><w:gridCol w:w="${colWidth}"/></w:tblGrid>` +
      `<w:tr>` +
      `<w:tc><w:tcPr><w:tcW w:w="${colWidth}" w:type="dxa"/></w:tcPr>${cleanOriginal}</w:tc>` +
      `<w:tc><w:tcPr><w:tcW w:w="${colWidth}" w:type="dxa"/></w:tcPr>${cleanTranslation}</w:tc>` +
      `</w:tr>` +
      `</w:tbl>`
    );

    if (sectPrXml) {
      return `${tblXml}<w:p><w:pPr>${sectPrXml}</w:pPr></w:p>`;
    }
    return tblXml;
  }
}
