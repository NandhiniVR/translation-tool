import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import JSZip from 'jszip';
import { DOCXAdapter } from '../adapters/DOCXAdapter.js';
import { DOCXOutputGenerator } from './DOCXOutputGenerator.js';
import type { ValidationReport, TranslationResult } from '../types/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function readDocumentXml(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const file = zip.file('word/document.xml');
  if (!file) throw new Error('missing word/document.xml');
  return file.async('string');
}

describe('DOCXOutputGenerator', () => {
  let generator: DOCXOutputGenerator;
  let adapter: DOCXAdapter;

  const tmpOutputDir = path.resolve(__dirname, '../../test-tmp');
  const testOutputPath = path.join(tmpOutputDir, 'output_test.docx');
  const bilingualOutputPath = path.join(tmpOutputDir, 'output_bilingual.docx');

  beforeAll(() => {
    fs.mkdirSync(tmpOutputDir, { recursive: true });
  });

  afterAll(() => {
    try {
      for (const file of [testOutputPath, bilingualOutputPath]) {
        if (fs.existsSync(file)) fs.unlinkSync(file);
      }
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

  it('should generate a bilingual DOCX pairing each original with its translation side-by-side', async () => {
    const originalXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>First Tamil sentence.</w:t></w:r></w:p>
    <w:p><w:r><w:t>Second Tamil sentence.</w:t></w:r></w:p>
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
        translatedText: 'First English sentence.',
        translatedRaw: 'First English sentence.',
        status: 'completed',
        validationWarnings: [],
      },
      {
        segmentId: 'p-2',
        segmentIndex: 1,
        translatedText: 'Second English sentence.',
        translatedRaw: 'Second English sentence.',
        status: 'completed',
        validationWarnings: [],
      },
    ];

    const result = await generator.generate(doc, results, validReport, bilingualOutputPath, {
      outputFormat: 'bilingual',
      sourceLanguage: 'ta',
      targetLanguage: 'en',
    });

    expect(result.success).toBe(true);
    expect(fs.existsSync(bilingualOutputPath)).toBe(true);

    const updatedXml = await readDocumentXml(fs.readFileSync(bilingualOutputPath));

    // Two-column tables are present, with source and translation paired
    expect((updatedXml.match(/<w:tbl>/g) ?? []).length).toBe(2);
    expect(updatedXml).toContain('First Tamil sentence.');
    expect(updatedXml).toContain('First English sentence.');
    expect(updatedXml).toContain('Second Tamil sentence.');
    expect(updatedXml).toContain('Second English sentence.');

    // Original text must be preserved exactly and appear before its translation
    const firstPairStart = updatedXml.indexOf('First Tamil sentence.');
    const firstPairEnd = updatedXml.indexOf('First English sentence.');
    const secondPairStart = updatedXml.indexOf('Second Tamil sentence.');
    const secondPairEnd = updatedXml.indexOf('Second English sentence.');
    expect(firstPairStart).toBeGreaterThan(-1);
    expect(firstPairEnd).toBeGreaterThan(firstPairStart);
    expect(secondPairStart).toBeGreaterThan(firstPairEnd);
    expect(secondPairEnd).toBeGreaterThan(secondPairStart);

    // Reopenability: parsing the generated DOCX must succeed
    const parsedBack = await adapter.parse(fs.readFileSync(bilingualOutputPath), 'reopened.docx');
    expect(parsedBack.segments.length).toBe(4);
  });

  it('should keep non-source-language content unchanged in bilingual mode', async () => {
    // Mixed-language doc: English + Tamil + Hindi, source = Tamil, target = English
    const originalXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Patient Information</w:t></w:r></w:p>
    <w:p><w:r><w:t>நோயாளியின் பெயர்</w:t></w:r></w:p>
    <w:p><w:r><w:t>आवश्यक जानकारी</w:t></w:r></w:p>
  </w:body>
</w:document>`;

    const zip = new JSZip();
    zip.file('word/document.xml', originalXml);
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    const doc = await adapter.parse(buffer, 'input.docx');

    // Pipeline semantics: non-source-language content is completed unchanged
    const results: TranslationResult[] = [
      {
        segmentId: 'p-1',
        segmentIndex: 0,
        translatedText: 'Patient Information',
        translatedRaw: 'Patient Information',
        status: 'completed',
        validationWarnings: [],
      },
      {
        segmentId: 'p-2',
        segmentIndex: 1,
        translatedText: "Patient's Name",
        translatedRaw: "Patient's Name",
        status: 'completed',
        validationWarnings: [],
      },
      {
        segmentId: 'p-3',
        segmentIndex: 2,
        translatedText: 'आवश्यक जानकारी',
        translatedRaw: 'आवश्यक जानकारी',
        status: 'completed',
        validationWarnings: [],
      },
    ];

    const result = await generator.generate(doc, results, validReport, bilingualOutputPath, {
      outputFormat: 'bilingual',
      sourceLanguage: 'ta',
      targetLanguage: 'en',
    });

    expect(result.success).toBe(true);

    const updatedXml = await readDocumentXml(fs.readFileSync(bilingualOutputPath));

    // Tamil translated to English; English and Hindi preserved unchanged.
    // The apostrophe is XML-escaped in the raw document.xml.
    expect(updatedXml).toContain('Patient Information');
    expect(updatedXml).toContain('Patient&apos;s Name');
    expect(updatedXml).toContain('நோயாளியின் பெயர்');
    expect(updatedXml).toContain('आवश्यक जानकारी');
  });

  it('should not corrupt the document when paragraphs contain nested paragraphs (text boxes)', async () => {
    // A floating text box embeds <w:p> elements inside <w:txbxContent> within an
    // outer paragraph. The bilingual transformation must keep the XML balanced.
    const originalXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="Normal"/></w:pPr>
      <w:r>
        <w:drawing>
          <wp:inline distT="0" distB="0" distL="0" distR="0">
            <a:graphic>
              <a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
                <wps:wsp>
                  <wps:txbx>
                    <w:txbxContent>
                      <w:p><w:r><w:t>Text box paragraph one</w:t></w:r></w:p>
                      <w:p><w:r><w:t>Text box paragraph two</w:t></w:r></w:p>
                    </w:txbxContent>
                  </wps:txbx>
                </wps:wsp>
              </a:graphicData>
            </a:graphic>
          </wp:inline>
        </w:drawing>
      </w:r>
      <w:r><w:t>Trailing text after the text box.</w:t></w:r>
    </w:p>
    <w:p><w:r><w:t>நோயாளியின் பெயர்</w:t></w:r></w:p>
  </w:body>
</w:document>`;

    const zip = new JSZip();
    zip.file('word/document.xml', originalXml);
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    const doc = await adapter.parse(buffer, 'input.docx');

    const results: TranslationResult[] = doc.segments.map((seg) => ({
      segmentId: seg.id,
      segmentIndex: seg.index,
      translatedText: `T[${seg.sourceText}]`,
      translatedRaw: `T[${seg.sourceText}]`,
      status: 'completed' as const,
      validationWarnings: [],
    }));

    const result = await generator.generate(doc, results, validReport, bilingualOutputPath, {
      outputFormat: 'bilingual',
      sourceLanguage: 'ta',
      targetLanguage: 'en',
    });

    expect(result.success).toBe(true);

    const updatedXml = await readDocumentXml(fs.readFileSync(bilingualOutputPath));

    // The transformed XML must stay balanced (equal w:p open/close tags)
    const opens = (updatedXml.match(/<w:p(?=[\s>])/g) ?? []).length;
    const closes = (updatedXml.match(/<\/w:p>/g) ?? []).length;
    expect(opens).toBe(closes);

    // The whole outer textbox paragraph is paired as one segment
    expect(updatedXml).toContain('T[Text box paragraph oneText box paragraph twoTrailing text after the text box.]');

    // Output must reopen successfully
    await adapter.parse(fs.readFileSync(bilingualOutputPath), 'reopened.docx');
  });

  it('should populate cell 1 with translation in an existing 2-column table (in-place bilingual)', async () => {
    const originalXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:tbl>
      <w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>
      <w:tblGrid><w:gridCol w:w="4680"/><w:gridCol w:w="4680"/></w:tblGrid>
      <w:tr>
        <w:tc><w:tcPr><w:tcW w:w="4680" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>Name</w:t></w:r></w:p></w:tc>
        <w:tc><w:tcPr><w:tcW w:w="4680" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>Description</w:t></w:r></w:p></w:tc>
      </w:tr>
      <w:tr>
        <w:tc><w:tcPr><w:tcW w:w="4680" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>தமிழ்</w:t></w:r></w:p></w:tc>
        <w:tc><w:tcPr><w:tcW w:w="4680" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>தமிழ் விளக்கம்</w:t></w:r></w:p></w:tc>
      </w:tr>
    </w:tbl>
  </w:body>
</w:document>`;

    const zip = new JSZip();
    zip.file('word/document.xml', originalXml);
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    const doc = await adapter.parse(buffer, 'input.docx');

    // English headers are non-source-language (unchanged); Tamil cells translated
    const results: TranslationResult[] = [
      { segmentId: 'p-1', segmentIndex: 0, translatedText: 'Name', translatedRaw: 'Name', status: 'completed', validationWarnings: [] },
      { segmentId: 'p-2', segmentIndex: 1, translatedText: 'Description', translatedRaw: 'Description', status: 'completed', validationWarnings: [] },
      { segmentId: 'p-3', segmentIndex: 2, translatedText: 'Tamil', translatedRaw: 'Tamil', status: 'completed', validationWarnings: [] },
      { segmentId: 'p-4', segmentIndex: 3, translatedText: 'Tamil description', translatedRaw: 'Tamil description', status: 'completed', validationWarnings: [] },
    ];

    const result = await generator.generate(doc, results, validReport, bilingualOutputPath, {
      outputFormat: 'bilingual',
      sourceLanguage: 'ta',
      targetLanguage: 'en',
    });

    expect(result.success).toBe(true);

    const updatedXml = await readDocumentXml(fs.readFileSync(bilingualOutputPath));

    // In-place bilingual: the existing table is modified (1 table, not 2)
    expect((updatedXml.match(/<w:tbl>/g) ?? []).length).toBe(1);

    // Cell 0 of each row preserves the original source text (left column = source)
    expect(updatedXml).toContain('தமிழ்');
    // Cell 1 of row 1 is replaced with translation of cell 0's content ("Name" → "Name")
    expect(updatedXml).toContain('>Name</w:t>');
    // Cell 1 of row 2 is replaced with translation of cell 0's "தமிழ்" → "Tamil"
    expect(updatedXml).toContain('>Tamil</w:t>');
    // Cell 1 contents from original (Description, தமிழ் விளக்கம்) are replaced by the in-place logic

    // Output must reopen successfully
    await adapter.parse(fs.readFileSync(bilingualOutputPath), 'reopened.docx');
  });

  it('should handle mixed documents: paragraphs side-by-side and tables modified in-place', async () => {
    const originalXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>நோயாளியின் பெயர்</w:t></w:r></w:p>
    <w:tbl>
      <w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>
      <w:tblGrid><w:gridCol w:w="4680"/><w:gridCol w:w="4680"/></w:tblGrid>
      <w:tr>
        <w:tc><w:tcPr><w:tcW w:w="4680" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>தமிழ்</w:t></w:r></w:p></w:tc>
        <w:tc><w:tcPr><w:tcW w:w="4680" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>தமிழ் விளக்கம்</w:t></w:r></w:p></w:tc>
      </w:tr>
    </w:tbl>
  </w:body>
</w:document>`;

    const zip = new JSZip();
    zip.file('word/document.xml', originalXml);
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    const doc = await adapter.parse(buffer, 'input.docx');

    const results: TranslationResult[] = [
      { segmentId: 'p-1', segmentIndex: 0, translatedText: "Patient's Name", translatedRaw: "Patient's Name", status: 'completed', validationWarnings: [] },
      { segmentId: 'p-2', segmentIndex: 1, translatedText: 'Tamil', translatedRaw: 'Tamil', status: 'completed', validationWarnings: [] },
      { segmentId: 'p-3', segmentIndex: 2, translatedText: 'Tamil description', translatedRaw: 'Tamil description', status: 'completed', validationWarnings: [] },
    ];

    const result = await generator.generate(doc, results, validReport, bilingualOutputPath, {
      outputFormat: 'bilingual',
      sourceLanguage: 'ta',
      targetLanguage: 'en',
    });

    expect(result.success).toBe(true);

    const updatedXml = await readDocumentXml(fs.readFileSync(bilingualOutputPath));

    // Paragraph wrapped in its own bilingual row (1 table) + existing table modified in-place (1 table) = 2 tables total
    expect((updatedXml.match(/<w:tbl>/g) ?? []).length).toBe(2);

    // Paragraph side-by-side: original + translation both present
    expect(updatedXml).toContain('நோயாளியின் பெயர்');
    expect(updatedXml).toContain('Patient&apos;s Name');

    // Existing table modified in-place: source text stays in cell 0, translation of cell 0 placed in cell 1
    expect(updatedXml).toContain('தமிழ்');
    expect(updatedXml).toContain('>Tamil</w:t>');
  });

  it('should apply RTL bidi properties to the translation table for an RTL target', async () => {
    const originalXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:tbl>
      <w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>
      <w:tblGrid><w:gridCol w:w="4680"/><w:gridCol w:w="4680"/></w:tblGrid>
      <w:tr>
        <w:tc><w:tcPr><w:tcW w:w="4680" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>நோயாளிக்கு காய்ச்சல் உள்ளது.</w:t></w:r></w:p></w:tc>
      </w:tr>
    </w:tbl>
  </w:body>
</w:document>`;

    const zip = new JSZip();
    zip.file('word/document.xml', originalXml);
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    const doc = await adapter.parse(buffer, 'input.docx');

    const results: TranslationResult[] = [
      { segmentId: 'p-1', segmentIndex: 0, translatedText: 'بیمار تب دارد.', translatedRaw: 'بیمار تب دارد.', status: 'completed', validationWarnings: [] },
    ];

    const result = await generator.generate(doc, results, validReport, bilingualOutputPath, {
      outputFormat: 'bilingual',
      sourceLanguage: 'ta',
      targetLanguage: 'fa',
    });

    expect(result.success).toBe(true);

    const updatedXml = await readDocumentXml(fs.readFileSync(bilingualOutputPath));

    // Original preserved, translation present with RTL paragraph/run properties
    expect(updatedXml).toContain('நோயாளிக்கு காய்ச்சல் உள்ளது.');
    expect(updatedXml).toContain('بیمار تب دارد.');
    expect(updatedXml).toContain('<w:bidi w:val="1"/>');
    expect(updatedXml).toContain('<w:rtl w:val="1"/>');

    // Output must remain reopenable
    await adapter.parse(fs.readFileSync(bilingualOutputPath), 'reopened.docx');
  });

  it('should preserve blank paragraphs and untranslated paragraphs verbatim', async () => {
    const originalXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>முதல் வாக்கியம்</w:t></w:r></w:p>
    <w:p><w:pPr><w:rPr><w:rFonts w:ascii="Calibri"/></w:rPr></w:pPr></w:p>
    <w:p><w:r><w:t>இரண்டாம் வாக்கியம்</w:t></w:r></w:p>
    <w:p><w:r><w:t>மூன்றாம் வாக்கியம்</w:t></w:r></w:p>
  </w:body>
</w:document>`;

    const zip = new JSZip();
    zip.file('word/document.xml', originalXml);
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    const doc = await adapter.parse(buffer, 'input.docx');

    // 3 segments: first translated, second FAILED (untranslated), third translated
    const results: TranslationResult[] = [
      { segmentId: 'p-1', segmentIndex: 0, translatedText: 'First sentence', translatedRaw: 'First sentence', status: 'completed', validationWarnings: [] },
      { segmentId: 'p-2', segmentIndex: 1, translatedText: '', translatedRaw: '', status: 'failed', errorMessage: 'API error', validationWarnings: [] },
      { segmentId: 'p-3', segmentIndex: 2, translatedText: 'Third sentence', translatedRaw: 'Third sentence', status: 'completed', validationWarnings: [] },
    ];

    const result = await generator.generate(doc, results, validReport, bilingualOutputPath, {
      outputFormat: 'bilingual',
      sourceLanguage: 'ta',
      targetLanguage: 'en',
    });

    expect(result.success).toBe(true);

    const updatedXml = await readDocumentXml(fs.readFileSync(bilingualOutputPath));

    // Blank separator paragraph preserved verbatim (with its pPr)
    expect(updatedXml).toContain('<w:p><w:pPr><w:rPr><w:rFonts w:ascii="Calibri"/></w:rPr></w:pPr></w:p>');

    // Translated paragraphs wrapped side-by-side
    expect(updatedXml).toContain('முதல் வாக்கியம்');
    expect(updatedXml).toContain('First sentence');
    expect(updatedXml).toContain('மூன்றாம் வாக்கியம்');
    expect(updatedXml).toContain('Third sentence');

    // Failed (untranslated) paragraph preserved verbatim, not wrapped
    expect(updatedXml).toContain('<w:p><w:r><w:t>இரண்டாம் வாக்கியம்</w:t></w:r></w:p>');

    // Balance is preserved
    const opens = (updatedXml.match(/<w:p(?=[\s>])/g) ?? []).length;
    const closes = (updatedXml.match(/<\/w:p>/g) ?? []).length;
    expect(opens).toBe(closes);
  });

  it('should apply RTL bidi properties for an RTL target language in bilingual mode', async () => {
    const originalXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>நோயாளிக்கு காய்ச்சல் உள்ளது.</w:t></w:r></w:p>
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
        translatedText: 'بیمار تب دارد.',
        translatedRaw: 'بیمار تب دارد.',
        status: 'completed',
        validationWarnings: [],
      },
    ];

    const result = await generator.generate(doc, results, validReport, bilingualOutputPath, {
      outputFormat: 'bilingual',
      sourceLanguage: 'ta',
      targetLanguage: 'fa',
    });

    expect(result.success).toBe(true);

    const updatedXml = await readDocumentXml(fs.readFileSync(bilingualOutputPath));

    // Original cell keeps the source; translation cell gets RTL properties
    expect(updatedXml).toContain('நோயாளிக்கு காய்ச்சல் உள்ளது.');
    expect(updatedXml).toContain('بیمار تب دارد.');
    expect(updatedXml).toContain('<w:bidi w:val="1"/>');
    expect(updatedXml).toContain('<w:rtl w:val="1"/>');

    // Output must remain reopenable
    await adapter.parse(fs.readFileSync(bilingualOutputPath), 'reopened.docx');
  });

  it('should populate right cell in existing 2-column chat tables in bilingual mode', async () => {
    const originalXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:tbl>
      <w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>
      <w:tblGrid><w:gridCol w:w="4680"/><w:gridCol w:w="4680"/></w:tblGrid>
      <w:tr>
        <w:tc><w:tcPr><w:tcW w:w="4680" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>Halo, apa kabar?</w:t></w:r></w:p></w:tc>
        <w:tc><w:tcPr><w:tcW w:w="4680" w:type="dxa"/></w:tcPr><w:p/></w:tc>
      </w:tr>
    </w:tbl>
  </w:body>
</w:document>`;

    const zip = new JSZip();
    zip.file('word/document.xml', originalXml);
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    const doc = await adapter.parse(buffer, 'input_2col.docx');

    const results: TranslationResult[] = [
      { segmentId: 'p-1', segmentIndex: 0, translatedText: 'Hello, how are you?', translatedRaw: 'Hello, how are you?', status: 'completed', validationWarnings: [] },
    ];

    const result = await generator.generate(doc, results, validReport, bilingualOutputPath, {
      outputFormat: 'bilingual',
      sourceLanguage: 'id',
      targetLanguage: 'en',
    });

    expect(result.success).toBe(true);

    const updatedXml = await readDocumentXml(fs.readFileSync(bilingualOutputPath));
    expect(updatedXml).toContain('Halo, apa kabar?');
    expect(updatedXml).toContain('Hello, how are you?');

    await adapter.parse(fs.readFileSync(bilingualOutputPath), 'reopened.docx');
  });

  it('should expand existing 1-column chat table to 2 columns in bilingual mode', async () => {
    const originalXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:tbl>
      <w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>
      <w:tblGrid><w:gridCol w:w="4680"/></w:tblGrid>
      <w:tr>
        <w:tc><w:tcPr><w:tcW w:w="4680" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>Selamat pagi</w:t></w:r></w:p></w:tc>
      </w:tr>
    </w:tbl>
  </w:body>
</w:document>`;

    const zip = new JSZip();
    zip.file('word/document.xml', originalXml);
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    const doc = await adapter.parse(buffer, 'input_1col.docx');

    const results: TranslationResult[] = [
      { segmentId: 'p-1', segmentIndex: 0, translatedText: 'Good morning', translatedRaw: 'Good morning', status: 'completed', validationWarnings: [] },
    ];

    const result = await generator.generate(doc, results, validReport, bilingualOutputPath, {
      outputFormat: 'bilingual',
      sourceLanguage: 'id',
      targetLanguage: 'en',
    });

    expect(result.success).toBe(true);

    const updatedXml = await readDocumentXml(fs.readFileSync(bilingualOutputPath));
    expect(updatedXml).toContain('Selamat pagi');
    expect(updatedXml).toContain('Good morning');
    expect((updatedXml.match(/<w:tc\b/g) ?? []).length).toBe(2);

    await adapter.parse(fs.readFileSync(bilingualOutputPath), 'reopened.docx');
  });
});
