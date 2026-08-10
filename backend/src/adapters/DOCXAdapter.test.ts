import JSZip from 'jszip';
import { DOCXAdapter } from './DOCXAdapter.js';

describe('DOCXAdapter', () => {
  let adapter: DOCXAdapter;

  beforeEach(() => {
    adapter = new DOCXAdapter();
  });

  async function createMockDocxBuffer(documentXmlContent: string): Promise<Buffer> {
    const zip = new JSZip();
    zip.file('word/document.xml', documentXmlContent);
    return await zip.generateAsync({ type: 'nodebuffer' });
  }

  it('should parse paragraphs from word/document.xml into segments', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:r><w:t>The patient should read this document carefully.</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t>Participation is voluntary.</w:t></w:r>
    </w:p>
  </w:body>
</w:document>`;

    const buffer = await createMockDocxBuffer(xml);
    const doc = await adapter.parse(buffer, 'test.docx');

    expect(doc.sourceFormat).toBe('docx');
    expect(doc.originalFileName).toBe('test.docx');
    expect(doc.segments.length).toBe(2);
    expect(doc.segments[0]!.sourceText).toBe('The patient should read this document carefully.');
    expect(doc.segments[1]!.sourceText).toBe('Participation is voluntary.');
  });

  it('should skip empty paragraphs', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p></w:p>
    <w:p><w:r><w:t>   </w:t></w:r></w:p>
    <w:p><w:r><w:t>Valid paragraph text.</w:t></w:r></w:p>
  </w:body>
</w:document>`;

    const buffer = await createMockDocxBuffer(xml);
    const doc = await adapter.parse(buffer, 'test.docx');

    expect(doc.segments.length).toBe(1);
    expect(doc.segments[0]!.sourceText).toBe('Valid paragraph text.');
  });

  it('should extract text from table cells', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:tbl>
      <w:tr>
        <w:tc><w:p><w:r><w:t>Cell 1 Content</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>Cell 2 Content</w:t></w:r></w:p></w:tc>
      </w:tr>
    </w:tbl>
  </w:body>
</w:document>`;

    const buffer = await createMockDocxBuffer(xml);
    const doc = await adapter.parse(buffer, 'table.docx');

    expect(doc.segments.length).toBe(2);
    expect(doc.segments[0]!.sourceText).toBe('Cell 1 Content');
    expect(doc.segments[1]!.sourceText).toBe('Cell 2 Content');
  });

  it('should throw Error on invalid ZIP buffer', async () => {
    const invalidBuffer = Buffer.from('this is not a zip file');
    await expect(adapter.parse(invalidBuffer, 'corrupted.docx')).rejects.toThrow(/Invalid DOCX package/);
  });

  it('should throw Error if word/document.xml is missing from ZIP', async () => {
    const zip = new JSZip();
    zip.file('something_else.xml', '<xml/>');
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });

    await expect(adapter.parse(buffer, 'missing_doc.docx')).rejects.toThrow(/missing word\/document.xml/);
  });
});
