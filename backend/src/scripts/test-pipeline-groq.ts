import { DOCXAdapter } from '../adapters/DOCXAdapter.js';
import { TranslationPipeline } from '../translation/TranslationPipeline.js';
import { DOCXOutputGenerator } from '../output/DOCXOutputGenerator.js';
import { SegmentValidator } from '../validation/SegmentValidator.js';
import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';
import os from 'os';

async function buildMockDocx(text: string, outputPath: string) {
  const zip = new JSZip();
  const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
  const docRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`;
  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:r><w:t>${text}</w:t></w:r>
    </w:p>
  </w:body>
</w:document>`;
  zip.file('_rels/.rels', relsXml);
  zip.file('word/_rels/document.xml.rels', docRelsXml);
  zip.file('word/document.xml', docXml);
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  fs.writeFileSync(outputPath, buffer);
}

async function testPipelineGroq() {
  const tmpDir = os.tmpdir();
  const inputPath = path.join(tmpDir, 'test-groq-input.docx');
  const outputPath = path.join(tmpDir, 'test-groq-output.docx');

  // Tamil input text
  const tamilText = "வணக்கம். இது ஒரு சோதனை ஆவணம். இந்த ஆவணம் மொழிபெயர்ப்பு அமைப்பை சோதிக்கிறது.";
  await buildMockDocx(tamilText, inputPath);

  const fileBuffer = fs.readFileSync(inputPath);
  const adapter = new DOCXAdapter();
  const parseResult = await adapter.parse(fileBuffer);
  
  console.log(`[Extracted Segments]: ${parseResult.segments.length}`);
  parseResult.segments.forEach(s => console.log(` - ${s.sourceText}`));

  const pipeline = new TranslationPipeline();
  console.log('\\n[Running Groq Pipeline]...');
  const results = await pipeline.run({
    sourceLanguage: 'ta',
    targetLanguage: 'en',
    domain: 'general',
    segments: parseResult.segments,
    jobId: 'groq-test',
    providerName: 'groq'
  });

  console.log('\\n[Translation Results]:');
  results.forEach(r => {
    console.log(` - ID: ${r.segmentId}`);
    console.log(`   Target: ${r.translatedText}`);
    console.log(`   Status: ${r.status}`);
  });

  const validator = new SegmentValidator();
  const valReport = validator.validate(parseResult.segments, results, 'ta', 'en');
  console.log(`\\n[Validation Report]: Valid=${valReport.valid}`);
  if (!valReport.valid) console.log(valReport.warnings);

  const generator = new DOCXOutputGenerator();
  const mockDoc = { id: 'test', sourceFormat: 'docx' as const, originalFileName: 'test.docx', formatContext: parseResult.context, segments: parseResult.segments };
  const outBuffer = await generator.generate(mockDoc, results, valReport, outputPath);
  fs.writeFileSync(outputPath, outBuffer);
  
  const adapter2 = new DOCXAdapter();
  const finalParse = await adapter2.parse(outBuffer);
  console.log('\\n[Final DOCX Contents]:');
  finalParse.segments.forEach(s => console.log(` - ${s.sourceText}`));
}

testPipelineGroq().catch(console.error);
