import { MemoQParser } from '../parsers/MemoQParser';

const SAMPLE_XLIFF = `<?xml version="1.0" encoding="utf-8"?>
<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">
  <file original="test.docx" source-language="en-US" target-language="hi-IN" datatype="x-memoq-xliff">
    <body>
      <trans-unit id="1">
        <source>The patient should read this document carefully.</source>
        <target/>
      </trans-unit>
      <trans-unit id="2">
        <source>Participation is <bpt id="1">&lt;strong&gt;</bpt>voluntary<ept id="2">&lt;/strong&gt;</ept>.</source>
        <target/>
      </trans-unit>
      <trans-unit id="3">
        <source>Contact us at info@example.com.</source>
        <target>संपर्क करें info@example.com पर।</target>
      </trans-unit>
      <trans-unit id="4" translate="no">
        <source>LOCKED: Do not translate.</source>
        <target>LOCKED: Do not translate.</target>
      </trans-unit>
    </body>
  </file>
</xliff>`;

const EMPTY_FILE = ``;

const INVALID_XML = `<this is not valid xml>>>`;

const NO_TRANS_UNITS = `<?xml version="1.0" encoding="utf-8"?>
<xliff version="1.2">
  <file>
    <body>
    </body>
  </file>
</xliff>`;

describe('MemoQParser', () => {
  let parser: MemoQParser;

  beforeEach(() => {
    parser = new MemoQParser();
  });

  describe('parse()', () => {
    it('should parse a valid XLIFF file and return segments', () => {
      const result = parser.parse(SAMPLE_XLIFF);
      expect(result.segments).toBeDefined();
      expect(Array.isArray(result.segments)).toBe(true);
    });

    it('should extract the correct number of translatable segments (skipping locked)', () => {
      const result = parser.parse(SAMPLE_XLIFF);
      // Segment 4 has translate="no" and should be skipped
      const ids = result.segments.map((s) => s.id);
      expect(ids).not.toContain('4');
    });

    it('should preserve the original XML for output regeneration', () => {
      const result = parser.parse(SAMPLE_XLIFF);
      expect(result.originalXml).toBe(SAMPLE_XLIFF);
    });

    it('should assign sequential index values starting at 0', () => {
      const result = parser.parse(SAMPLE_XLIFF);
      const indices = result.segments.map((s) => s.index);
      for (let i = 0; i < indices.length; i++) {
        expect(indices[i]).toBe(i);
      }
    });

    it('should extract source text (plain) for all segments', () => {
      const result = parser.parse(SAMPLE_XLIFF);
      for (const segment of result.segments) {
        expect(typeof segment.sourceText).toBe('string');
        expect(segment.sourceText.length).toBeGreaterThan(0);
      }
    });

    it('should extract existing target text when present', () => {
      const result = parser.parse(SAMPLE_XLIFF);
      const seg3 = result.segments.find((s) => s.id === '3');
      expect(seg3).toBeDefined();
      // Target text should be present
      expect(seg3!.targetText).toBeTruthy();
    });

    it('should set initial status to "pending" for all segments', () => {
      const result = parser.parse(SAMPLE_XLIFF);
      for (const segment of result.segments) {
        expect(segment.status).toBe('pending');
      }
    });

    it('should throw on an empty file', () => {
      expect(() => parser.parse(EMPTY_FILE)).toThrow();
    });

    it('should throw when no trans-unit elements are found', () => {
      expect(() => parser.parse(NO_TRANS_UNITS)).toThrow(/trans-unit/i);
    });

    it('should handle a segment with inline bpt/ept tags in sourceRaw', () => {
      const result = parser.parse(SAMPLE_XLIFF);
      const seg2 = result.segments.find((s) => s.id === '2');
      expect(seg2).toBeDefined();
      // sourceText should be plain text without XML tags
      expect(seg2!.sourceText).not.toMatch(/<bpt/);
      expect(seg2!.sourceText).not.toMatch(/<ept/);
    });
  });

  describe('stripTags()', () => {
    it('should strip XML tags from a string', () => {
      const result = parser.stripTags('<bpt id="1">Hello</bpt> <ept id="2">world</ept>');
      expect(result).toBe('Hello world');
    });

    it('should return unchanged plain text', () => {
      const result = parser.stripTags('Plain text with no tags.');
      expect(result).toBe('Plain text with no tags.');
    });
  });
});
