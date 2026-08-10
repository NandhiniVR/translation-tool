import { MemoQParser } from './parsers/MemoQParser.js';
import { TranslationPipeline } from './translation/TranslationPipeline.js';

function createXliffSample(segmentCount: number): string {
  const units: string[] = [];
  for (let i = 1; i <= segmentCount; i++) {
    units.push(`
      <trans-unit id="${i}">
        <source>This is test sentence number ${i} for benchmarking translation speed.</source>
        <target/>
      </trans-unit>`);
  }
  return `<?xml version="1.0" encoding="utf-8"?>
<xliff version="1.2">
  <file original="benchmark.docx" source-language="en" target-language="hi">
    <body>
      ${units.join('\n')}
    </body>
  </file>
</xliff>`;
}

async function runBenchmark() {
  console.log('============================================================');
  console.log('TRANSLATION PIPELINE BENCHMARK (BATCHED vs SEQUENTIAL)');
  console.log('============================================================\n');

  const parser = new MemoQParser();
  const pipeline = new TranslationPipeline();

  const segmentCounts = [10, 25, 50];

  for (const count of segmentCounts) {
    const xml = createXliffSample(count);
    const parsedDoc = parser.parse(xml);

    console.log(`\n--- Benchmarking ${count} segments ---`);
    const start = Date.now();

    const { metrics } = await pipeline.runWithMetrics({
      sourceLanguage: 'English',
      targetLanguage: 'Hindi',
      domain: 'general',
      segments: parsedDoc.segments,
      jobId: `bench-${count}`,
    });

    const elapsed = Date.now() - start;
    console.log(`Result for ${count} segments:`);
    console.log(`  Total Elapsed Time: ${(elapsed / 1000).toFixed(2)} seconds`);
    console.log(`  Total Gemini Requests: ${metrics.geminiRequests}`);
    console.log(`  Average Gemini Request Time: ${metrics.avgGeminiTimeMs} ms`);
  }
}

runBenchmark().catch(console.error);
