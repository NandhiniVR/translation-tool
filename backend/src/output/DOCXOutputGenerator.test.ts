import * as fs from 'fs';
import * as path from 'path';
import JSZip from 'jszip';
import { DOCXAdapter } from '../adapters/DOCXAdapter.js';
import { DOCXOutputGenerator } from './DOCXOutputGenerator.js';
import type { ValidationReport, TranslationResult } from '../types/index.js';

describe('DOCXOutputGenerator', () => {
  let generator: DOCXOutputGenerator;
  let adapter: DOCXAdapter;

  const tmpOutputDir = path.resolve(__dirname, '../../test-tmp');
  const testOutputPath = path.join(tmpOutputDir, 'output_test.docx');

  beforeAll(() => {
    fs.mkdirSync(tmpOutputDir, { recursive: true });
  });

  afterAll(() => {
    try {
      if (fs.existsSync(testOutputPath)) fs.unlinkSync(testOutputPath);
      if (fs.existsSync(tmpOutputDir)) fs.rmdirSync(tmpOutputDir);
    } catch {
      // ignore cleanup errors
    }
  });

  beforeEach(() => {
    generator = new DOCXOutputGenerator();
    adapter = new DOCXAdapter();
  });

  const validReport: ValidationReport = {
    valid: true,
    segmentCountMatch: true,
    allSegmentsPresent: true,
    failedSegments: [],
    warnings: [],
  };

  it('should replace text in word/document.xml and produce a valid reopenable DOCX file', async () => {
    const originalXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>The patient should read this carefully.</w:t></w:r></w:p>
  </w:body>
</w:document>`;

    const zip = new JSZip();
    zip.file('word/document.xml', originalXml);
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });

    const doc = await adapter.parse(buffer, 'input.docx');

    const results: TranslationResult[] = [
      {
        segmentId: 'p-1',
        segmentIndex: 0,
        translatedText: 'मरीज को इसे ध्यान से पढ़ना चाहिए।',
        translatedRaw: 'मरीज को इसे ध्यान से पढ़ना चाहिए।',
        status: 'completed',
        validationWarnings: [],
      },
    ];

    const result = await generator.generate(doc, results, validReport, testOutputPath);

    expect(result.success).toBe(true);
    expect(fs.existsSync(testOutputPath)).toBe(true);

    // Verify reopenability
    const writtenBuffer = fs.readFileSync(testOutputPath);
    const parsedBack = await adapter.parse(writtenBuffer, 'reopened.docx');

    expect(parsedBack.segments.length).toBe(1);
    expect(parsedBack.segments[0]!.sourceText).toBe('मरीज को इसे ध्यान से पढ़ना चाहिए।');
  });

  it('should block output if critical validation errors exist', async () => {
    const originalXml = `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Text</w:t></w:r></w:p></w:body></w:document>`;
    const zip = new JSZip();
    zip.file('word/document.xml', originalXml);
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    const doc = await adapter.parse(buffer, 'input.docx');

    const invalidReport: ValidationReport = {
      ...validReport,
      valid: false,
      failedSegments: [
        {
          segmentId: 'p-1',
          segmentIndex: 0,
          errorType: 'tag_error',
          message: 'Unrestored tag tokens',
        },
      ],
    };

    const result = await generator.generate(doc, [], invalidReport, testOutputPath);

    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain('DOCX output blocked');
  });
});
