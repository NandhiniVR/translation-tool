import { TranslationPipeline } from '../translation/TranslationPipeline.js';
import type { TranslationDocument, PipelineProfilerMetrics, TranslationResult } from '../types/index.js';
import { logger } from '../config/logger.js';
import { config } from '../config/index.js';

export interface ProviderBenchmarkSummary {
  provider: 'gemini' | 'groq';
  model: string;
  totalTimeMs: number;
  apiTimeMs: number;
  avgLatencyMs: number;
  maxLatencyMs: number;
  requests: number;
  retries: number;
  completedSegments: number;
  failedSegments: number;
  sampleTranslations: Array<{
    segmentId: string;
    sourceText: string;
    translatedText: string;
  }>;
}

export interface BenchmarkReport {
  documentName: string;
  sourceLanguage: string;
  targetLanguage: string;
  domain: string;
  totalSegments: number;
  batchSize: number;
  concurrency: number;
  gemini: ProviderBenchmarkSummary;
  groq: ProviderBenchmarkSummary;
  fastestProvider: 'gemini' | 'groq' | 'equal';
  mostReliableProvider: 'gemini' | 'groq' | 'equal';
  speedupPercentage: number;
}

export class TranslationBenchmark {
  private readonly pipeline: TranslationPipeline;

  constructor() {
    this.pipeline = new TranslationPipeline();
  }

  /**
   * Runs side-by-side benchmark comparing Gemini vs Groq on an isolated document dataset.
   */
  async compare(
    doc: TranslationDocument,
    sourceLanguage: string,
    targetLanguage: string,
    domain: 'general' | 'medical' | 'legal'
  ): Promise<BenchmarkReport> {
    logger.info(`[Benchmark] Starting side-by-side comparison on ${doc.originalFileName} (${doc.segments.length} segments)`);

    // 1. Run Gemini Translation
    logger.info(`[Benchmark] Running Gemini provider...`);
    const geminiRun = await this.pipeline.runWithMetrics({
      sourceLanguage,
      targetLanguage,
      domain,
      segments: doc.segments,
      jobId: `bench-gemini-${Date.now()}`,
      providerName: 'gemini',
    });

    // 2. Run Groq Translation
    logger.info(`[Benchmark] Running Groq provider...`);
    const groqRun = await this.pipeline.runWithMetrics({
      sourceLanguage,
      targetLanguage,
      domain,
      segments: doc.segments,
      jobId: `bench-groq-${Date.now()}`,
      providerName: 'groq',
    });

    const geminiSummary = this.buildSummary('gemini', geminiRun.metrics, geminiRun.results, doc);
    const groqSummary = this.buildSummary('groq', groqRun.metrics, groqRun.results, doc);

    // Determine fastest & most reliable
    let fastestProvider: 'gemini' | 'groq' | 'equal' = 'equal';
    let speedupPercentage = 0;

    if (geminiSummary.totalTimeMs < groqSummary.totalTimeMs) {
      fastestProvider = 'gemini';
      speedupPercentage = Math.round(((groqSummary.totalTimeMs - geminiSummary.totalTimeMs) / groqSummary.totalTimeMs) * 100);
    } else if (groqSummary.totalTimeMs < geminiSummary.totalTimeMs) {
      fastestProvider = 'groq';
      speedupPercentage = Math.round(((geminiSummary.totalTimeMs - groqSummary.totalTimeMs) / geminiSummary.totalTimeMs) * 100);
    }

    let mostReliableProvider: 'gemini' | 'groq' | 'equal' = 'equal';
    if (geminiSummary.failedSegments < groqSummary.failedSegments) {
      mostReliableProvider = 'gemini';
    } else if (groqSummary.failedSegments < geminiSummary.failedSegments) {
      mostReliableProvider = 'groq';
    }

    const report: BenchmarkReport = {
      documentName: doc.originalFileName,
      sourceLanguage,
      targetLanguage,
      domain,
      totalSegments: doc.segments.length,
      batchSize: geminiRun.metrics.batchSize,
      concurrency: geminiRun.metrics.concurrency,
      gemini: geminiSummary,
      groq: groqSummary,
      fastestProvider,
      mostReliableProvider,
      speedupPercentage,
    };

    logger.info(`[Benchmark] Comparison complete. Fastest: ${fastestProvider} (${speedupPercentage}% speedup)`);
    return report;
  }

  private buildSummary(
    provider: 'gemini' | 'groq',
    m: PipelineProfilerMetrics,
    results: TranslationResult[],
    doc: TranslationDocument
  ): ProviderBenchmarkSummary {
    const completedCount = results.filter((r) => r.status === 'completed').length;
    const failedCount = results.filter((r) => r.status === 'failed').length;

    const samples: Array<{ segmentId: string; sourceText: string; translatedText: string }> = [];
    const maxSamples = Math.min(5, results.length);

    for (let i = 0; i < maxSamples; i++) {
      const res = results[i];
      const srcSeg = doc.segments.find((s) => s.id === res?.segmentId);
      if (res && srcSeg) {
        samples.push({
          segmentId: res.segmentId,
          sourceText: srcSeg.sourceText,
          translatedText: res.translatedText,
        });
      }
    }

    return {
      provider,
      model: provider === 'gemini' ? config.gemini.model : config.groq.model,
      totalTimeMs: m.tTotalMs,
      apiTimeMs: m.tGeminiApiMs,
      avgLatencyMs: m.avgGeminiTimeMs,
      maxLatencyMs: m.maxGeminiTimeMs,
      requests: m.geminiRequests,
      retries: m.totalRetries,
      completedSegments: completedCount,
      failedSegments: failedCount,
      sampleTranslations: samples,
    };
  }
}
