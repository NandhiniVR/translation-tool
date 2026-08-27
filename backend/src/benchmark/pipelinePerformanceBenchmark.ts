/**
 * Pipeline Profiling Benchmark
 *
 * Measures where time is spent in the CURRENT translation pipeline — no config,
 * batching, concurrency, prompt, or logic changes — using a latency-simulating
 * mock provider so it runs WITHOUT any real API keys or network calls.
 *
 * Usage:
 *   npx tsx src/benchmark/pipelinePerformanceBenchmark.ts [segmentCount...]
 *   npx tsx src/benchmark/pipelinePerformanceBenchmark.ts --profile
 *
 * Example:
 *   npx tsx src/benchmark/pipelinePerformanceBenchmark.ts 100 500 1000
 *
 * Env vars:
 *   BENCH_LATENCY_MS           simulated per-request latency (default 300)
 *   BENCH_OTHER_LANG_RATIO     fraction of segments written in another language
 *                              (default 0.3) — demonstrates language filtering
 *   BENCH_OTHER_LANG           language code of the "other" segments (default 'ta')
 *   BENCH_RATE_LIMIT_RATIO     fraction of batch requests that get a simulated
 *                              HTTP 429 (default 0). When > 0, adds an extra row
 *                              proving the pipeline does NOT fall back to
 *                              individual requests on rate limits (no storm).
 *
 * Default mode compares BEFORE (old config: batch 10, conc 3, 8k token budget)
 * vs AFTER (optimized config: batch 30, conc 4, 12k token budget) at
 * 100/500/1000 segments, reporting total time, AI elapsed, request count,
 * average batch size, concurrency, tokens, retries, and failures.
 *
 * `--profile` runs the pipeline exactly as production configures it and prints
 * the per-request [AI] lines, the TRANSLATION PERFORMANCE summary block, and
 * the detailed stage breakdown.
 */
import { TranslationPipeline } from '../translation/TranslationPipeline.js';
import { ProviderFactory } from '../translation/ProviderFactory.js';
import { logger } from '../config/logger.js';
import { RateLimitExhaustedError } from '../translation/TranslationProvider.js';
import type { PipelineProfilerMetrics, TranslationSegment } from '../types/index.js';
import type { ProviderResponse, TranslationProvider } from '../translation/TranslationProvider.js';

// Keep benchmark output clean — suppress noisy pipeline logs.
logger.silent = true;

const ARGS = process.argv.slice(2);
// Default mode compares BEFORE vs AFTER configs; `--profile` prints the full
// stage breakdown of the current production configuration.
const PROFILE_MODE = ARGS.includes('--profile');
const COUNT_ARGS = ARGS.filter((a) => !a.startsWith('--'));
const SEGMENT_COUNTS: number[] = (COUNT_ARGS.length > 0
  ? COUNT_ARGS.map(Number)
  : [100, 500, 1000]
).filter((n) => !isNaN(n) && n > 0);

const LATENCY_MS = Number(process.env['BENCH_LATENCY_MS'] ?? 300);
const OTHER_LANG_RATIO = Math.min(0.9, Math.max(0, Number(process.env['BENCH_OTHER_LANG_RATIO'] ?? 0.3)));
const OTHER_LANG = process.env['BENCH_OTHER_LANG'] ?? 'ta';
const RATE_LIMIT_RATIO = Math.min(0.9, Math.max(0, Number(process.env['BENCH_RATE_LIMIT_RATIO'] ?? 0)));

const SAMPLE_SENTENCES = [
  'The patient should take the medicine twice a day after meals.',
  'Please attach the completed form to your application.',
  'The meeting has been rescheduled to next Tuesday at 10 AM.',
  'Our organization is committed to improving community health services.',
  'Kindly review the attached document and provide your feedback.',
  'The laboratory results will be available within three working days.',
  'All employees must complete the annual safety training module.',
  'The invoice amount includes applicable taxes and delivery charges.',
  'Please confirm your appointment at least 24 hours in advance.',
  'This policy applies to all regional offices and field teams.',
];

const OTHER_LANG_SENTENCES: Record<string, string[]> = {
  ta: [
    'நோயாளி உணவுக்குப் பிறகு ஒரு நாளைக்கு இரண்டு முறை மருந்து உட்கொள்ள வேண்டும்.',
    'முடிக்கப்பட்ட படிவத்தை உங்கள் விண்ணப்பத்துடன் இணைக்கவும்.',
    'கூட்டம் அடுத்த செவ்வாய்க்கிழமை காலை 10 மணிக்கு மாற்றப்பட்டுள்ளது.',
    'எங்கள் நிறுவனம் சமூக சுகாதார சேவைகளை மேம்படுத்த உறுதிபூண்டுள்ளது.',
    'இணைக்கப்பட்ட ஆவணத்தை மதிப்பாய்வு செய்து உங்கள் கருத்தை வழங்கவும்.',
  ],
  hi: [
    'रोगी को भोजन के बाद दिन में दो बार दवा लेनी चाहिए।',
    'कृपया पूरा किया हुआ फ़ॉर्म अपने आवेदन के साथ संलग्न करें।',
    'बैठक अगले मंगलवार को सुबह 10 बजे पुनर्निर्धारित की गई है।',
    'हमारा संगठन सामुदायिक स्वास्थ्य सेवाओं को बेहतर बनाने के लिए प्रतिबद्ध है।',
    'कृपया संलग्न दस्तावेज़ की समीक्षा करें और अपनी प्रतिक्रिया दें।',
  ],
  en: SAMPLE_SENTENCES,
};

function buildSegments(count: number): TranslationSegment[] {
  const segments: TranslationSegment[] = [];
  const otherSentences = OTHER_LANG_SENTENCES[OTHER_LANG] ?? OTHER_LANG_SENTENCES['ta']!;
  for (let i = 0; i < count; i++) {
    // Deterministic pseudo-random interleaving so every run sees the same doc
    const isOther = (i % 10) / 10 < OTHER_LANG_RATIO;
    const pool = isOther ? otherSentences : SAMPLE_SENTENCES;
    const text = pool[i % pool.length]!;
    segments.push({
      id: `seg-${i + 1}`,
      index: i,
      sourceRaw: text,
      sourceText: text,
      status: 'pending',
    });
  }
  return segments;
}

function createLatencyProvider(latencyMs: number, rateLimitRatio = 0): TranslationProvider {
  // Simulate a TEMPORARY HTTP 429 on the FIRST attempt of every Nth distinct
  // batch (deterministic). The pipeline re-queues the SAME batch with backoff,
  // so the retry succeeds — demonstrating that temporary rate limits no longer
  // turn batches into failed segments, and no individual fallback happens.
  const rateLimitEvery = rateLimitRatio > 0 ? Math.max(1, Math.round(1 / rateLimitRatio)) : 0;
  const attemptsByPrompt = new Map<string, number>();
  let firstAttemptCount = 0;
  return {
    providerName: 'gemini',
    modelName: 'bench-model',
    async translate(
      _systemPrompt: string,
      userPrompt: string,
      options?: { jsonMode?: boolean }
    ): Promise<ProviderResponse> {
      const key = userPrompt;
      const attempts = (attemptsByPrompt.get(key) ?? 0) + 1;
      attemptsByPrompt.set(key, attempts);
      if (rateLimitEvery > 0 && attempts === 1) {
        firstAttemptCount++;
        if (firstAttemptCount % rateLimitEvery === 0) {
          throw new RateLimitExhaustedError('bench simulated temporary HTTP 429 rate limit', 1, 0);
        }
      }
      await new Promise((resolve) => setTimeout(resolve, latencyMs));
      if (options?.jsonMode) {
        const items = JSON.parse(userPrompt) as Array<{ id: string; sourceText: string }>;
        const inputTokens = items.reduce(
          (sum, item) => sum + Math.ceil(item.sourceText.length / 4) + 30,
          0
        );
        return {
          text: JSON.stringify({
            translations: items.map((item) => ({ id: item.id, translation: 'अनुवादित पाठ' })),
          }),
          wasRetried: false,
          retryCount: 0,
          latencyMs,
          usage: {
            inputTokens,
            outputTokens: items.length * 8,
          },
          model: 'bench-model',
          provider: 'gemini',
        };
      }
      return {
        text: 'अनुवादित पाठ',
        wasRetried: false,
        retryCount: 0,
        latencyMs,
        usage: { inputTokens: 100, outputTokens: 8 },
        model: 'bench-model',
        provider: 'gemini',
      };
    },
  };
}

function printSummaryBlock(m: PipelineProfilerMetrics): void {
  // Segment processing: everything between parsing and the AI/validation stages
  // (extraction, glossary, language filter, protection, prompt build, restore).
  const segmentProcessingMs =
    m.tSegmentationMs +
    m.tGlossaryMs +
    m.tLanguageFilterMs +
    m.tProtectionMs +
    m.tPromptBuildMs +
    m.tRestoreMs;
  // AI waiting/request time: wall-clock span from the first request start to
  // the last request end (includes concurrency overlap, queue wait, and retry
  // backoff). Falls back to the summed stages when the span wasn't recorded.
  const aiWaitRequestMs = m.tAiElapsedMs ?? (m.tQueueWaitMs + m.tGeminiApiMs + m.tRetryWaitMs);

  console.log('========== TRANSLATION PERFORMANCE ==========');
  console.log(`Total time:              ${m.tTotalMs} ms`);
  console.log(`DOCX parsing:            ${m.tParsingMs} ms`);
  console.log(`Segment processing:      ${segmentProcessingMs} ms`);
  console.log(`AI waiting/request time: ${aiWaitRequestMs} ms`);
  console.log(`Validation:              ${m.tValidationMs} ms`);
  console.log(`DOCX generation:         ${m.tOutputGenerationMs} ms`);
  console.log(`Number of AI requests:   ${m.geminiRequests}`);
  console.log(`Total input tokens:      ${m.totalInputTokens}`);
  console.log(`Total output tokens:     ${m.totalOutputTokens}`);
  console.log(`Retries:                 ${m.totalRetries}`);
  console.log('==============================================');
}

function printStageBreakdown(m: PipelineProfilerMetrics): void {
  const pct = (ms: number) => `${ms} ms (${m.tTotalMs > 0 ? Math.round((ms / m.tTotalMs) * 100) : 0}%)`;
  console.log('  ┌ Stage breakdown ─────────────────────────────────────────');
  console.log(`  │ Parsing:               ${pct(m.tParsingMs)}`);
  console.log(`  │ Segmentation:          ${pct(m.tSegmentationMs)}`);
  console.log(`  │ Glossary:              ${pct(m.tGlossaryMs)}`);
  console.log(`  │ Language filter:       ${pct(m.tLanguageFilterMs)}`);
  console.log(`  │ Protection:            ${pct(m.tProtectionMs)}`);
  console.log(`  │ Prompt construction:   ${pct(m.tPromptBuildMs)}`);
  console.log(`  │ Queue/wait:            ${pct(m.tQueueWaitMs)}`);
  console.log(`  │ AI API processing:     ${pct(m.tGeminiApiMs)}`);
  console.log(`  │ Retry backoff:         ${pct(m.tRetryWaitMs)}`);
  console.log(`  │ Validation:            ${pct(m.tValidationMs)}`);
  console.log(`  │ Placeholder restore:   ${pct(m.tRestoreMs)}`);
  console.log(`  │ Output generation:     ${pct(m.tOutputGenerationMs)}`);
  console.log(`  │ Total:                 ${pct(m.tTotalMs)}`);
  console.log('  └──────────────────────────────────────────────────────────');
  console.log('  (summed stage times include concurrent request overlap, so percentages may exceed 100%)');
}

async function withMockProvider<T>(fn: () => Promise<T>, rateLimited = false): Promise<T> {
  const originalGetProvider = ProviderFactory.getProvider;
  ProviderFactory.getProvider = (() => createLatencyProvider(LATENCY_MS, rateLimited ? RATE_LIMIT_RATIO : 0)) as typeof ProviderFactory.getProvider;
  try {
    return await fn();
  } finally {
    ProviderFactory.getProvider = originalGetProvider;
  }
}

/**
 * Default mode: run the pipeline exactly as production configures it
 * (no PipelineOptions overrides) and print the per-request [AI] log plus the
 * TRANSLATION PERFORMANCE summary block for each segment count.
 */
async function profileCurrentConfig(segments: TranslationSegment[]): Promise<void> {
  const run = await withMockProvider(async () => {
    const pipeline = new TranslationPipeline(); // production defaults
    const startedAt = Date.now();
    const res = await pipeline.runWithMetrics({
      sourceLanguage: 'en',
      targetLanguage: 'hi',
      segments,
      jobId: `bench-profile-${Date.now()}`,
      providerName: 'gemini',
    });
    return { res, totalMs: Date.now() - startedAt };
  });

  const m = run.res.metrics;
  const completed = run.res.results.filter((r) => r.status === 'completed').length;
  const failed = run.res.results.filter((r) => r.status === 'failed').length;
  const skipped = run.res.results.filter((r) => r.status === 'skipped').length;

  console.log('');
  printSummaryBlock(m);
  console.log('');
  printStageBreakdown(m);
  console.log('');
  console.log(`  ${completed}/${segments.length} segments completed, ${skipped} skipped (other language), ${failed} failed`);
  console.log(`  wall: ${run.totalMs} ms | API requests: ${m.geminiRequests} | avg batch: ${m.avgBatchSize} | retries: ${m.totalRetries}`);
}

async function runCompareMode(): Promise<void> {
  interface Row {
    label: string;
    totalMs: number;
    apiMs: number;
    requests: number;
    concurrency: number;
    avgBatch: number;
    successful: number;
    rateLimited: number;
    rlRetries: number;
    batchFallbacks: number;
    inputTokens: number;
    outputTokens: number;
    retries: number;
    completed: number;
    skipped: number;
    failed: number;
    segments: number;
  }
  const pad = (s: string, width: number) => s.padEnd(width);

  console.log('\nBEFORE (old config: batch 10, conc 3, 8k token budget) vs AFTER (optimized: batch 30, conc 4, 12k token budget)\n');
  for (const count of SEGMENT_COUNTS) {
    const segments = buildSegments(count);
    const runs: Array<{ label: string; opts: { batchSize?: number; concurrency?: number; maxBatchTokens?: number; filterOtherLanguages?: boolean }; rateLimited?: boolean }> = [
      { label: 'BEFORE (old config)', opts: { batchSize: 10, concurrency: 3, maxBatchTokens: 8000, filterOtherLanguages: true } },
      { label: 'AFTER (optimized)', opts: { batchSize: 30, concurrency: 4, maxBatchTokens: 12000, filterOtherLanguages: true } },
    ];
    if (RATE_LIMIT_RATIO > 0) {
      runs.push({
        label: `AFTER + ${Math.round(RATE_LIMIT_RATIO * 100)}% temp 429s`,
        opts: { batchSize: 30, concurrency: 4, maxBatchTokens: 12000, filterOtherLanguages: true },
        rateLimited: true,
      });
    }

    console.log(`=== ${count} segments (${Math.round(count * (1 - OTHER_LANG_RATIO))} source-lang + ${Math.round(count * OTHER_LANG_RATIO)} other-lang) ===`);
    console.log(
      [
        pad('Config', 22),
        pad('Total ms', 10),
        pad('API ms', 9),
        pad('Req', 5),
        pad('Conc', 5),
        pad('Avg batch', 10),
        pad('OK req', 6),
        pad('429s', 5),
        pad('RL retr', 7),
        pad('Fallbk', 7),
        pad('In tok', 8),
        pad('Out tok', 8),
        pad('Retr', 5),
        pad('Done', 6),
        pad('Skip', 6),
        pad('Fail', 6),
      ].join('|')
    );
    console.log('-'.repeat(148));

    const rows: Row[] = [];
    for (const run of runs) {
      const row = await withMockProvider(async () => {
        const pipeline = new TranslationPipeline(run.opts);
        const startedAt = Date.now();
        const res = await pipeline.runWithMetrics({
          sourceLanguage: 'en',
          targetLanguage: 'hi',
          segments,
          jobId: `bench-cmp-${Date.now()}`,
          providerName: 'gemini',
        });
        const m = res.metrics;
        return {
          label: run.label,
          totalMs: Date.now() - startedAt,
          apiMs: m.tGeminiApiMs,
          requests: m.geminiRequests,
          concurrency: m.concurrency,
          avgBatch: m.avgBatchSize,
          successful: m.successfulRequests,
          rateLimited: m.rateLimitedRequests,
          rlRetries: m.batchRateLimitRetries,
          batchFallbacks: m.batchFallbackCount,
          inputTokens: m.totalInputTokens,
          outputTokens: m.totalOutputTokens,
          retries: m.totalRetries,
          completed: res.results.filter((r) => r.status === 'completed').length,
          skipped: res.results.filter((r) => r.status === 'skipped').length,
          failed: res.results.filter((r) => r.status === 'failed').length,
          segments: segments.length,
        } satisfies Row;
      }, run.rateLimited ?? false);
      rows.push(row);
      console.log(
        [
          pad(row.label, 22),
          pad(String(row.totalMs), 10),
          pad(String(row.apiMs), 9),
          pad(String(row.requests), 5),
          pad(String(row.concurrency), 5),
          pad(String(row.avgBatch), 10),
          pad(String(row.successful), 6),
          pad(String(row.rateLimited), 5),
          pad(String(row.rlRetries), 7),
          pad(String(row.batchFallbacks), 7),
          pad(String(row.inputTokens), 8),
          pad(String(row.outputTokens), 8),
          pad(String(row.retries), 5),
          pad(String(row.completed), 6),
          pad(String(row.skipped), 6),
          pad(String(row.failed), 6),
        ].join('|')
      );
    }
    if (rows.length === 2) {
      const before = rows[0]!;
      const after = rows[1]!;
      const timeReduction = before.totalMs > 0
        ? Math.round(((before.totalMs - after.totalMs) / before.totalMs) * 100)
        : 0;
      const requestReduction = before.requests > 0
        ? Math.round(((before.requests - after.requests) / before.requests) * 100)
        : 0;
      console.log(
        `\n  Summary: ${timeReduction}% faster, ${requestReduction}% fewer API requests, ` +
        `${after.skipped} segments skipped (not sent to the model), ${after.completed}/${after.segments} completed, ${after.failed} failed`
      );
      console.log(`  429s: ${after.rateLimited} | batch rate-limit retries: ${after.rlRetries} | batch fallbacks: ${after.batchFallbacks}`);
      console.log(`  100% completion: ${after.failed === 0 ? 'YES' : 'NO'}`);
    }
    console.log('');
  }
}

async function main(): Promise<void> {
  console.log('Pipeline Performance Benchmark');
  console.log(`  mock latency: ${LATENCY_MS}ms/request | other-language ratio: ${OTHER_LANG_RATIO} (${OTHER_LANG}) | simulated 429 ratio: ${RATE_LIMIT_RATIO}`);
  console.log(`  mode: ${PROFILE_MODE ? 'profile current production config' : 'compare (BEFORE vs AFTER configs)'}`);
  console.log('  NOTE: this harness feeds segments directly to the pipeline, so DOCX parsing /');
  console.log('        output-generation stages read 0 ms here; the controller measures those');
  console.log('        stages on real uploaded documents.\n');

  if (PROFILE_MODE) {
    for (const count of SEGMENT_COUNTS) {
      const segments = buildSegments(count);
      console.log(`=== ${count} segments (${Math.round(count * (1 - OTHER_LANG_RATIO))} source-lang + ${Math.round(count * OTHER_LANG_RATIO)} other-lang) ===`);
      await profileCurrentConfig(segments);
    }
    return;
  }

  await runCompareMode();
}

void main();
