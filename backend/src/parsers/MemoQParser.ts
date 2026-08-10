import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import type { ParsedDocument, TranslationSegment } from '../types/index.js';
import { logger } from '../config/logger.js';

/**
 * MemoQParser
 *
 * Parses MemoQ bilingual files (.mqxliff) and standard XLIFF 1.2 files (.xliff).
 *
 * Supported format:
 *   XLIFF 1.2 as produced by MemoQ, with the structure:
 *
 *   <xliff version="1.2" ...>
 *     <file ...>
 *       <body>
 *         <trans-unit id="...">
 *           <source>Source text possibly with <bpt>, <ept>, <ph> tags</source>
 *           <target>Existing target text (may be empty)</target>
 *           <seg-source>...</seg-source>  (MemoQ segmentation, may be present)
 *         </trans-unit>
 *         ...
 *       </body>
 *     </file>
 *   </xliff>
 *
 * IMPORTANT NOTES:
 *   - This parser has been developed against standard XLIFF 1.2.
 *   - MemoQ-specific extensions (mq: namespace) are preserved in the raw XML
 *     but not fully interpreted. They pass through to the output unchanged.
 *   - If a real .mqxliff file has a different structure, this parser must be
 *     updated after inspection. Do NOT assume all MemoQ files are identical.
 *   - "Loss-free" regeneration is the goal but cannot be guaranteed for all
 *     MemoQ-specific extensions without real-file testing.
 *
 * Parser configuration:
 *   - preserveOrder: true   — maintains XML node sequence for safe regeneration
 *   - ignoreAttributes: false — captures id, mq:status, etc.
 *   - parseTagValue: false  — treats all values as strings to prevent coercion
 *   - trimValues: false     — preserves leading/trailing whitespace in segments
 */

const PARSER_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  preserveOrder: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  processEntities: true,
  htmlEntities: false,
  // IMPORTANT: We do NOT use stopNodes here because we need to capture the
  // inner XML of <source> and <target> elements including any inline tags.
  // Instead, we work with the parsed tree and reconstruct inner XML as needed.
};

const BUILDER_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  preserveOrder: true,
  processEntities: false,
  format: false, // Do not reformat — preserve original whitespace
};

export class MemoQParser {
  private readonly xmlParser: XMLParser;
  private readonly xmlBuilder: XMLBuilder;

  constructor() {
    this.xmlParser = new XMLParser(PARSER_OPTIONS);
    this.xmlBuilder = new XMLBuilder(BUILDER_OPTIONS);
  }

  /**
   * Parses an XLIFF/MQXLIFF XML string and extracts all translation segments.
   *
   * @param xmlContent - The raw XML string from an uploaded file
   * @returns ParsedDocument containing segments and the original XML for regeneration
   * @throws Error if the XML is malformed or no trans-unit elements are found
   */
  parse(xmlContent: string): ParsedDocument {
    // Validate basic XML structure before attempting parse
    if (!xmlContent.trim()) {
      throw new Error('File is empty.');
    }

    let parsed: unknown;
    try {
      parsed = this.xmlParser.parse(xmlContent);
    } catch (err) {
      throw new Error(`XML parse error: ${(err as Error).message}`);
    }

    // The parser returns an array when preserveOrder is true
    if (!Array.isArray(parsed)) {
      throw new Error('Unexpected parser output structure.');
    }

    const segments: TranslationSegment[] = [];

    // Detect XLIFF version and declared languages
    let xliffVersion: string | undefined;
    let declaredSourceLanguage: string | undefined;
    let declaredTargetLanguage: string | undefined;

    const xliffChildren = this.findNode(parsed as NodeArray, 'xliff');
    if (xliffChildren) {
      const fileChildren = this.findNode(xliffChildren, 'file');
      if (fileChildren) {
        // Find file attributes if present in the tree
        const fileNode = (parsed as NodeArray).find(item => 'file' in item);
        if (fileNode && ':@' in fileNode) {
          const attrs = (fileNode as Record<string, Record<string, string>>)[':@'];
          if (attrs) {
            declaredSourceLanguage = attrs['@_source-language'];
            declaredTargetLanguage = attrs['@_target-language'];
          }
        }
      }
    }

    // Extract all trans-unit nodes from anywhere in the document
    const transUnits = this.findAllNodes(parsed as NodeArray, 'trans-unit');

    if (transUnits.length === 0) {
      throw new Error(
        'No <trans-unit> elements found. ' +
        'Verify the file is a valid XLIFF 1.2 or MemoQ (.mqxliff) bilingual file.'
      );
    }

    logger.info(`[Parser] Found ${transUnits.length} trans-unit elements`);

    let index = 0;
    for (const unit of transUnits) {
      const segment = this.extractSegment(unit, index);
      if (segment) {
        segments.push(segment);
        index++;
      }
    }

    logger.info(`[Parser] Extracted ${segments.length} translatable segments`);

    return {
      originalXml: xmlContent,
      segments,
      xliffVersion,
      declaredSourceLanguage,
      declaredTargetLanguage,
    };
  }

  /**
   * Extracts a TranslationSegment from a parsed trans-unit node.
   * Returns null for locked or non-translatable units.
   */
  private extractSegment(
    unit: Record<string, unknown>,
    index: number
  ): TranslationSegment | null {
    // Extract the id attribute
    const id = String(unit['@_id'] ?? `segment-${index}`);

    // Collect all attributes for preservation
    const attributes: Record<string, string> = {};
    for (const [key, value] of Object.entries(unit)) {
      if (key.startsWith('@_')) {
        attributes[key.slice(2)] = String(value);
      }
    }

    // Skip locked segments (MemoQ sets translate="no")
    if (attributes['translate'] === 'no') {
      logger.debug(`[Parser] Skipping locked segment: ${id}`);
      return null;
    }

    // Get children array of this trans-unit
    const children = (unit['trans-unit'] as NodeArray | undefined) ?? [];

    // Extract source inner content
    const sourceNode = this.findChildNode(children, 'source');
    const sourceRaw = sourceNode ? this.getInnerXml(sourceNode, 'source') : '';
    const sourceText = this.stripTags(sourceRaw);

    // Extract target inner content (may be absent or empty for untranslated segments)
    const targetNode = this.findChildNode(children, 'target');
    const targetRaw = targetNode ? this.getInnerXml(targetNode, 'target') : undefined;
    const targetText = targetRaw ? this.stripTags(targetRaw) : undefined;

    return {
      id,
      index,
      sourceRaw,
      sourceText,
      targetRaw,
      targetText,
      status: 'pending',
      attributes,
    };
  }

  /**
   * Extracts the inner XML content of a named element from its parsed children.
   * Rebuilds the XML for the children of the named element.
   */
  private getInnerXml(
    nodeChildren: NodeArray,
    _tagName: string
  ): string {
    // In preserveOrder mode, each array item is { tagName: [...children] } or { '#text': '...' }
    // The children of our element are the items within the element's array
    if (!nodeChildren || nodeChildren.length === 0) return '';

    // Re-serialize each child node to reconstruct inner XML
    const parts: string[] = [];
    for (const child of nodeChildren) {
      if (typeof child === 'object' && child !== null) {
        // Text node
        if ('#text' in child) {
          parts.push(String(child['#text']));
        } else {
          // Element node — rebuild its XML
          try {
            const rebuilt = this.xmlBuilder.build([child]);
            parts.push(rebuilt);
          } catch {
            // Fallback: skip unserializable nodes (shouldn't happen)
          }
        }
      }
    }
    return parts.join('');
  }

  /**
   * Strips all XML/HTML tags from a string, returning plain text.
   * Used to extract display text for context and logging.
   */
  stripTags(xml: string): string {
    return xml.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  }

  /**
   * Finds a node by tag name in a preserveOrder array.
   * Returns the node's children array, or null if not found.
   */
  private findNode(
    nodes: NodeArray,
    tagName: string
  ): NodeArray | null {
    for (const node of nodes) {
      if (typeof node === 'object' && node !== null && tagName in node) {
        return (node as Record<string, unknown>)[tagName] as NodeArray;
      }
    }
    return null;
  }

  /**
   * Finds a child node by tag name among siblings.
   * Returns the children array of the matching element.
   */
  private findChildNode(
    nodes: NodeArray,
    tagName: string
  ): NodeArray | null {
    return this.findNode(nodes, tagName);
  }

  /**
   * Recursively finds all nodes with the given tag name throughout the tree.
   * Returns each matching node's own object (not just its children) so we can
   * access attributes from the ':@' sibling.
   */
  private findAllNodes(nodes: NodeArray, tagName: string): Record<string, unknown>[] {
    const results: Record<string, unknown>[] = [];

    const recurse = (items: NodeArray): void => {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (typeof item !== 'object' || item === null) continue;

        const obj = item as Record<string, unknown>;

        if (tagName in obj) {
          // In fast-xml-parser preserveOrder mode, attributes are inside obj[':@']
          const attrs = (obj[':@'] as Record<string, unknown> | undefined) ?? {};

          const merged: Record<string, unknown> = {
            ...attrs,
            ...obj,
          };
          // Flatten: put children under the tag name key
          merged['trans-unit'] = obj[tagName] as NodeArray;
          results.push(merged);

          // Also recurse into children
          recurse(obj[tagName] as NodeArray ?? []);
        } else {
          // Recurse into any element's children
          for (const [key, value] of Object.entries(obj)) {
            if (key !== ':@' && key !== '#text' && Array.isArray(value)) {
              recurse(value as NodeArray);
            }
          }
        }
      }
    };

    recurse(nodes);
    return results;
  }
}

// Type alias for the preserveOrder node arrays returned by fast-xml-parser
type NodeArray = Array<Record<string, unknown>>;
