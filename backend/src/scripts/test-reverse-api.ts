import { TranslationPipeline } from '../translation/TranslationPipeline.js';
import type { TranslationSegment } from '../types/index.js';

async function testReverse() {
  const pipeline = new TranslationPipeline();
  
  const segments: TranslationSegment[] = [
    {
      id: 'seg-1',
      index: 0,
      sourceText: 'வணக்கம் உலகமே',
      sourceRaw: 'வணக்கம் உலகமே',
      status: 'pending'
    },
    {
      id: 'seg-2',
      index: 1,
      sourceText: 'இது ஒரு சோதனை ஆவணம்',
      sourceRaw: 'இது ஒரு சோதனை ஆவணம்',
      status: 'pending'
    }
  ];

  console.log('Testing Tamil -> English with real API call...');
  const res = await pipeline.run({
    sourceLanguage: 'ta',
    targetLanguage: 'en',
    domain: 'general',
    segments,
    jobId: 'test-reverse',
    providerName: 'gemini',
  });

  for (const r of res) {
    console.log(`[${r.segmentId}] Status: ${r.status}`);
    console.log(`  Source: ${segments.find(s => s.id === r.segmentId)?.sourceText}`);
    console.log(`  Target: ${r.translatedText}`);
    if (r.errorMessage) console.log(`  Error: ${r.errorMessage}`);
    if (r.validationWarnings?.length) console.log(`  Warnings: ${r.validationWarnings.join(', ')}`);
  }
}

testReverse().catch(console.error);
