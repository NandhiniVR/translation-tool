/**
 * REVERSE TRANSLATION DIAGNOSTIC
 * ================================
 * Tests the complete document pipeline end-to-end for both directions
 * using MOCK translation results — no real API calls needed.
 *
 * Tests:
 *   MOCK-A: English → Tamil  (forward)
 *   MOCK-B: Tamil → English  (reverse)
 *   MOCK-C: Hindi → English
 *   MOCK-D: Gujarati → English
 *   MOCK-E: Tamil → Hindi
 */
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import JSZip from 'jszip';
import { DOCXAdapter } from '../adapters/DOCXAdapter.js';
import { DOCXOutputGenerator } from '../output/DOCXOutputGenerator.js';
import { SegmentValidator } from '../validation/SegmentValidator.js';
import type { TranslationResult, TranslationDocument, TranslationSegment } from '../types/index.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PASS = '✅ PASS';
const FAIL = '❌ FAIL';
const WARN = '⚠️  WARN';

interface TestResult {
  label: string;
  pass: boolean;
  detail?: string;
}

const results: TestResult[] = [];

function check(label: string, pass: boolean, detail?: string): void {
  results.push({ label, pass, detail });
  const icon = pass ? PASS : FAIL;
  console.log(`  ${icon} ${label}${detail ? ` — ${detail}` : ''}`);
}

function section(title: string): void {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(title);
  console.log('═'.repeat(60));
}

// ─── Build a minimal DOCX containing specific text ────────────────────────────

async function buildTestDocx(paragraphs: string[]): Promise<Buffer> {
  const zip = new JSZip();

  // Minimal DOCX structure
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);

  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);

  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`);

  // Build document.xml with paragraphs
  const paras = paragraphs.map(text => {
    // For table-like entries, split on | and build a simple table
    if (text.startsWith('TABLE:')) {
      const cells = text.slice(6).split('|');
      const tcs = cells.map(c => `<w:tc><w:p><w:r><w:t>${c.trim()}</w:t></w:r></w:p></w:tc>`).join('');
      return `<w:tbl><w:tr>${tcs}</w:tr></w:tbl>`;
    }
    // Normal paragraph — split text across two runs to test run merging
    const mid = Math.floor(text.length / 2);
    const part1 = text.slice(0, mid);
    const part2 = text.slice(mid);
    if (part2) {
      return `<w:p><w:r><w:t xml:space="preserve">${part1}</w:t></w:r><w:r><w:t xml:space="preserve">${part2}</w:t></w:r></w:p>`;
    }
    return `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
  }).join('\n');

  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
${paras}
    <w:p><w:pPr><w:sectPr/></w:pPr></w:p>
  </w:body>
</w:document>`);

  return zip.generateAsync({ type: 'nodebuffer' });
}

// ─── Run a mock translation round-trip ────────────────────────────────────────

interface RoundTripConfig {
  testId: string;
  sourceLanguage: string;
  targetLanguage: string;
  paragraphs: string[];
  mockTranslations: Record<string, string>; // sourceText → translatedText
}

async function runRoundTrip(cfg: RoundTripConfig): Promise<void> {
  section(`TEST ${cfg.testId}: ${cfg.sourceLanguage.toUpperCase()} → ${cfg.targetLanguage.toUpperCase()}`);
  console.log(`  Source language code: "${cfg.sourceLanguage}"`);
  console.log(`  Target language code: "${cfg.targetLanguage}"`);

  const adapter = new DOCXAdapter();
  const outputGen = new DOCXOutputGenerator();
  const validator = new SegmentValidator();

  // 1. Build source DOCX
  const docxBuf = await buildTestDocx(cfg.paragraphs);
  check(`${cfg.testId}.1 DOCX built (${docxBuf.length} bytes)`, docxBuf.length > 100);

  // 2. Parse the DOCX
  let doc: TranslationDocument;
  try {
    doc = await adapter.parse(docxBuf, `test_${cfg.testId}.docx`);
    check(
      `${cfg.testId}.2 Document parsed — ${doc.segments.length} segments extracted`,
      doc.segments.length > 0,
      `Expected >0, got ${doc.segments.length}`
    );
  } catch (e) {
    check(`${cfg.testId}.2 Document parsed`, false, (e as Error).message);
    return;
  }

  // 3. Verify extracted segment text
  console.log(`\n  Extracted segments:`);
  for (const seg of doc.segments) {
    const wc = seg.sourceText.split(/\s+/).filter(Boolean).length;
    console.log(`    [${seg.id}] "${seg.sourceText.slice(0, 60)}${seg.sourceText.length > 60 ? '…' : ''}" (${wc} words, ${seg.sourceText.length} chars)`);
  }

  // 4. Create mock TranslationResults
  const mockResults: TranslationResult[] = doc.segments.map((seg) => {
    const translation = cfg.mockTranslations[seg.sourceText.trim()];
    if (!translation) {
      console.log(`    ⚠️  No mock translation for: "${seg.sourceText.slice(0, 40)}"`);
    }
    return {
      segmentId: seg.id,
      segmentIndex: seg.index,
      translatedText: translation ?? `[UNTRANSLATED: ${seg.sourceText}]`,
      translatedRaw: translation ?? `[UNTRANSLATED: ${seg.sourceText}]`,
      status: translation ? 'completed' : 'failed',
      validationWarnings: [],
    };
  });

  const completedCount = mockResults.filter(r => r.status === 'completed').length;
  check(
    `${cfg.testId}.3 Mock translations applied — ${completedCount}/${doc.segments.length} segments`,
    completedCount === doc.segments.length
  );

  // 5. Validate results
  const valReport = validator.validate(doc.segments, mockResults, cfg.sourceLanguage, cfg.targetLanguage);
  check(
    `${cfg.testId}.4 Validation passed`,
    valReport.valid || valReport.failedSegments.every(f => f.errorType === 'validation_error'),
    valReport.valid ? 'clean' : `${valReport.failedSegments.length} failures: ${valReport.failedSegments.map(f => f.message).join('; ').slice(0, 80)}`
  );

  // 6. Generate output DOCX
  const tmpDir = os.tmpdir();
  const outPath = path.join(tmpDir, `diag_${cfg.testId}_output.docx`);
  let outputResult;
  try {
    outputResult = await outputGen.generate(doc, mockResults, valReport, outPath);
    check(
      `${cfg.testId}.5 Output DOCX generated`,
      outputResult.success,
      outputResult.success ? outPath : outputResult.errorMessage
    );
  } catch (e) {
    check(`${cfg.testId}.5 Output DOCX generated`, false, (e as Error).message);
    return;
  }

  if (!outputResult.success) return;

  // 7. Re-parse the output DOCX and verify translated text appears
  const outBuf = fs.readFileSync(outPath);
  let parsedOut: TranslationDocument;
  try {
    parsedOut = await adapter.parse(outBuf, `test_${cfg.testId}_out.docx`);
    check(
      `${cfg.testId}.6 Output DOCX re-parsed — ${parsedOut.segments.length} segments`,
      parsedOut.segments.length > 0
    );
  } catch (e) {
    check(`${cfg.testId}.6 Output DOCX re-parsed`, false, (e as Error).message);
    return;
  }

  // 8. Verify translations are present in output
  console.log(`\n  Re-parsed output segments:`);
  let translationWrittenCount = 0;
  for (const outSeg of parsedOut.segments) {
    const text = outSeg.sourceText.trim();
    console.log(`    [${outSeg.id}] "${text.slice(0, 70)}${text.length > 70 ? '…' : ''}"`);
    // Check if any expected translation appears
    for (const expectedTranslation of Object.values(cfg.mockTranslations)) {
      if (text.includes(expectedTranslation.slice(0, 10))) {
        translationWrittenCount++;
        break;
      }
    }
  }

  // Compare segment texts — source should NOT equal output when translated
  const sourceTexts = doc.segments.map(s => s.sourceText);
  const outputTexts = parsedOut.segments.map(s => s.sourceText);

  let matchedExpected = 0;
  let remainedUntranslated = 0;

  for (const outTxt of outputTexts) {
    const isExpected = Object.values(cfg.mockTranslations).some(t => outTxt.includes(t.slice(0, Math.min(15, t.length))));
    const isSource = sourceTexts.some(s => s === outTxt);
    if (isExpected) matchedExpected++;
    if (isSource) remainedUntranslated++;
  }

  check(
    `${cfg.testId}.7 Translations written to output (${matchedExpected}/${doc.segments.length} segments contain expected text)`,
    matchedExpected >= Math.max(1, doc.segments.length - 1),
    `matched: ${matchedExpected}, untranslated remaining: ${remainedUntranslated}`
  );

  check(
    `${cfg.testId}.8 Source text NOT in output (output contains translated text, not original)`,
    remainedUntranslated === 0,
    remainedUntranslated === 0 ? 'clean' : `${remainedUntranslated} paragraph(s) still contain source text`
  );

  // Clean up
  try { fs.unlinkSync(outPath); } catch { /* ignore */ }
}

// ─── SegmentValidator.checkCompleteness probe ─────────────────────────────────

function testValidatorCompleteness(): void {
  section('VALIDATOR: checkCompleteness() Direction Tests');
  const v = new SegmentValidator();

  // Tamil → English: Tamil source, English output
  const r1 = v.checkCompleteness('வணக்கம் உலகமே இது ஒரு சோதனை', 'Hello world this is a test', 'ta', 'en');
  check('Validator: Tamil→English correct translation → isComplete', r1.isComplete, `status=${r1.status} reason=${r1.reason ?? 'none'}`);

  // Tamil → English: Tamil source, Tamil output (NOT translated)
  const r2 = v.checkCompleteness('வணக்கம் உலகமே இது ஒரு சோதனை', 'வணக்கம் உலகமே இது ஒரு சோதனை', 'ta', 'en');
  check('Validator: Tamil→English SAME text → isComplete=false (should fail)', !r2.isComplete, `status=${r2.status} reason=${r2.reason ?? 'none'}`);

  // Hindi → English: Hindi source, Hindi output (NOT translated)
  const r3 = v.checkCompleteness('नमस्ते दुनिया यह एक परीक्षण है', 'नमस्ते दुनिया यह एक परीक्षण है', 'hi', 'en');
  check('Validator: Hindi→English SAME text → isComplete=false (should fail)', !r3.isComplete, `status=${r3.status} reason=${r3.reason ?? 'none'}`);

  // English → Tamil: English source, Tamil output (correct)
  const r4 = v.checkCompleteness('Hello world this is a test', 'வணக்கம் உலகம் இது ஒரு சோதனை', 'en', 'ta');
  check('Validator: English→Tamil correct translation → isComplete', r4.isComplete, `status=${r4.status} reason=${r4.reason ?? 'none'}`);

  // English → Tamil: English source, English output (NOT translated)
  const r5 = v.checkCompleteness('Hello world this is a test', 'Hello world this is a test', 'en', 'ta');
  check('Validator: English→Tamil SAME text → isComplete=false (should fail)', !r5.isComplete, `status=${r5.status} reason=${r5.reason ?? 'none'}`);

  // Tamil → Hindi: Tamil source, Hindi output (correct)
  const r6 = v.checkCompleteness('வணக்கம் உலகமே இது ஒரு சோதனை', 'नमस्ते दुनिया यह एक परीक्षण है', 'ta', 'hi');
  check('Validator: Tamil→Hindi correct → isComplete', r6.isComplete, `status=${r6.status} reason=${r6.reason ?? 'none'}`);

  // Gujarati → English: Gujarati source, Gujarati output (NOT translated)
  const r7 = v.checkCompleteness('નમસ્તે દુનિયા આ એક પરીક્ષણ છે', 'નમસ્તે દુનિયા આ એક પરીક્ષણ છે', 'gu', 'en');
  check('Validator: Gujarati→English SAME text → isComplete=false (should fail)', !r7.isComplete, `status=${r7.status} reason=${r7.reason ?? 'none'}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\n========================================');
  console.log('REVERSE TRANSLATION DIAGNOSTIC REPORT');
  console.log('========================================');
  console.log(`Timestamp: ${new Date().toISOString()}`);

  // MOCK-A: English → Tamil (forward direction — reference baseline)
  await runRoundTrip({
    testId: 'A (EN→TA)',
    sourceLanguage: 'en',
    targetLanguage: 'ta',
    paragraphs: [
      'Hello world',
      'This is a test document',
      'The patient has high blood pressure',
      'TABLE:Name|Age|City',
    ],
    mockTranslations: {
      'Hello world': 'வணக்கம் உலகமே',
      'This is a test document': 'இது ஒரு சோதனை ஆவணம்',
      'The patient has high blood pressure': 'நோயாளிக்கு உயர் இரத்த அழுத்தம் உள்ளது',
      'Name|Age|City': 'பெயர்|வயது|நகரம்',
      'Name': 'பெயர்',
      'Age': 'வயது',
      'City': 'நகரம்',
    },
  });

  // MOCK-B: Tamil → English (reverse direction — primary test)
  await runRoundTrip({
    testId: 'B (TA→EN)',
    sourceLanguage: 'ta',
    targetLanguage: 'en',
    paragraphs: [
      'வணக்கம் உலகமே',
      'இது ஒரு சோதனை ஆவணம்',
      'நோயாளிக்கு உயர் இரத்த அழுத்தம் உள்ளது',
    ],
    mockTranslations: {
      'வணக்கம் உலகமே': 'Hello world',
      'இது ஒரு சோதனை ஆவணம்': 'This is a test document',
      'நோயாளிக்கு உயர் இரத்த அழுத்தம் உள்ளது': 'The patient has high blood pressure',
    },
  });

  // MOCK-C: Hindi → English
  await runRoundTrip({
    testId: 'C (HI→EN)',
    sourceLanguage: 'hi',
    targetLanguage: 'en',
    paragraphs: [
      'नमस्ते दुनिया',
      'यह एक परीक्षण दस्तावेज़ है',
    ],
    mockTranslations: {
      'नमस्ते दुनिया': 'Hello world',
      'यह एक परीक्षण दस्तावेज़ है': 'This is a test document',
    },
  });

  // MOCK-D: Gujarati → English
  await runRoundTrip({
    testId: 'D (GU→EN)',
    sourceLanguage: 'gu',
    targetLanguage: 'en',
    paragraphs: [
      'નમસ્તે દુનિયા',
      'આ એક પરીક્ષણ દસ્તાવેજ છે',
    ],
    mockTranslations: {
      'નમસ્તે દુનિયા': 'Hello world',
      'આ એક પરીક્ષણ દસ્તાવેજ છે': 'This is a test document',
    },
  });

  // MOCK-E: Tamil → Hindi
  await runRoundTrip({
    testId: 'E (TA→HI)',
    sourceLanguage: 'ta',
    targetLanguage: 'hi',
    paragraphs: [
      'வணக்கம் உலகமே',
      'நோயாளிக்கு உயர் இரத்த அழுத்தம் உள்ளது',
    ],
    mockTranslations: {
      'வணக்கம் உலகமே': 'नमस्ते दुनिया',
      'நோயாளிக்கு உயர் இரத்த அழுத்தம் உள்ளது': 'रोगी को उच्च रक्तचाप है',
    },
  });

  // Validator tests (no API, pure logic)
  testValidatorCompleteness();

  // ─── Summary ────────────────────────────────────────────────────────────────
  section('FINAL DIAGNOSTIC SUMMARY');
  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;

  console.log(`\n  Total checks : ${results.length}`);
  console.log(`  Passed       : ${passed}`);
  console.log(`  Failed       : ${failed}`);

  if (failed > 0) {
    console.log('\n  FAILED CHECKS:');
    for (const r of results.filter(r => !r.pass)) {
      console.log(`    ❌ ${r.label}${r.detail ? ` — ${r.detail}` : ''}`);
    }
  }

  console.log('\n');
}

main().catch(err => {
  console.error('Diagnostic script crashed:', err);
  process.exit(1);
});
