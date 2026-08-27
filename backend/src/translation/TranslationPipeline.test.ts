import { jest } from '@jest/globals';
import { TranslationPipeline } from './TranslationPipeline.js';
import { ProviderFactory } from './ProviderFactory.js';
import { PermanentProviderError, RateLimitExhaustedError } from './TranslationProvider.js';
import type { TranslationSegment } from '../types/index.js';
import type { ProviderResponse, TranslationProvider } from './TranslationProvider.js';

/**
 * Fake provider that mirrors the batch/individual contract used by the
 * pipeline without making any real API call.
 */
function createFakeProvider(): TranslationProvider {
  return {
    providerName: 'gemini',
    modelName: 'fake-model',
    async translate(
      _systemPrompt: string,
      userPrompt: string,
      options?: { jsonMode?: boolean }
    ): Promise<ProviderResponse> {
      if (options?.jsonMode) {
        const items = JSON.parse(userPrompt) as Array<{ id: string }>;
        return {
          text: JSON.stringify({
            translations: items.map((item) => ({ id: item.id, translation: 'अनुवादित पाठ' })),
          }),
          wasRetried: false,
          retryCount: 0,
          latencyMs: 1,
          model: 'fake-model',
          provider: 'gemini',
        };
      }
      return {
        text: 'अनुवादित पाठ',
        wasRetried: false,
        retryCount: 0,
        latencyMs: 1,
        model: 'fake-model',
        provider: 'gemini',
      };
    },
  };
}

/**
 * Fake provider recording every request it receives, translating Tamil
 * content and echoing everything else (defensive — the language filter should
 * prevent other-language segments from ever reaching it).
 */
function createRecordingProvider(callLog: string[]): TranslationProvider {
  return {
    providerName: 'gemini',
    modelName: 'fake-model',
    async translate(
      _systemPrompt: string,
      userPrompt: string,
      options?: { jsonMode?: boolean }
    ): Promise<ProviderResponse> {
      if (options?.jsonMode) {
        const items = JSON.parse(userPrompt) as Array<{ id: string; sourceText: string }>;
        for (const item of items) callLog.push(item.sourceText);
        return {
          text: JSON.stringify({
            translations: items.map((item) => ({
              id: item.id,
              translation: /[\u0B80-\u0BFF]/.test(item.sourceText)
                ? 'The patient has a fever.'
                : 'रोगी को बुखार है।',
            })),
          }),
          wasRetried: false,
          retryCount: 0,
          latencyMs: 1,
          model: 'fake-model',
          provider: 'gemini',
        };
      }
      callLog.push(userPrompt);
      return {
        text: 'रोगी को बुखार है।',
        wasRetried: false,
        retryCount: 0,
        latencyMs: 1,
        model: 'fake-model',
        provider: 'gemini',
      };
    },
  };
}

function createPermanentErrorProvider(callLog: number[]): TranslationProvider {
  return {
    providerName: 'gemini',
    modelName: 'fake-model',
    async translate(): Promise<ProviderResponse> {
      callLog.push(1);
      throw new PermanentProviderError('Gemini API failed: 401 UNAUTHENTICATED invalid api key', 401);
    },
  };
}

/**
 * Provider that always throws RateLimitExhaustedError (HTTP 429 persisted).
 * The pipeline must fail the batch WITHOUT falling back to individual requests.
 */
function createRateLimitedProvider(callLog: number[]): TranslationProvider {
  return {
    providerName: 'gemini',
    modelName: 'fake-model',
    async translate(): Promise<ProviderResponse> {
      callLog.push(1);
      throw new RateLimitExhaustedError('Gemini API rate limited after 3 attempts (HTTP 429)', 3, 900);
    },
  };
}

/**
 * Provider whose batch (jsonMode) request fails with a generic error while
 * individual (non-jsonMode) requests succeed — exercises the genuine-failure
 * fallback path that must remain intact.
 */
function createBatchFailureProvider(callLog: string[]): TranslationProvider {
  return {
    providerName: 'gemini',
    modelName: 'fake-model',
    async translate(
      _systemPrompt: string,
      _userPrompt: string,
      options?: { jsonMode?: boolean }
    ): Promise<ProviderResponse> {
      if (options?.jsonMode) {
        callLog.push('batch');
        throw new Error('Malformed JSON in provider response');
      }
      callLog.push('single');
      return {
        text: 'अनुवादित पाठ',
        wasRetried: false,
        retryCount: 0,
        latencyMs: 1,
        model: 'fake-model',
        provider: 'gemini',
      };
    },
  };
}

describe('TranslationPipeline - performance & fail-fast behavior', () => {
  it('fails the whole batch fast on a permanent provider error (no individual fallback requests)', async () => {
    const callLog: number[] = [];
    const spy = jest.spyOn(ProviderFactory, 'getProvider').mockReturnValue(createPermanentErrorProvider(callLog) as never);
    try {
      const pipeline = new TranslationPipeline({ batchSize: 10, concurrency: 3 });
      const segments: TranslationSegment[] = Array.from({ length: 5 }, (_, i) => ({
        id: `s${i}`,
        index: i,
        sourceRaw: 'The patient has a fever.',
        sourceText: 'The patient has a fever.',
        status: 'pending' as const,
      }));

      const run = await pipeline.runWithMetrics({
        sourceLanguage: 'en',
        targetLanguage: 'hi',
        segments,
        jobId: 'permanent-error-job',
      });

      // Exactly ONE request: the batch request. The pipeline must NOT fall back
      // to one individual request per segment for a permanently failing provider.
      expect(callLog).toHaveLength(1);
      expect(run.results).toHaveLength(5);
      for (const res of run.results) {
        expect(res.status).toBe('failed');
        expect(res.errorMessage).toContain('401');
      }
      expect(run.metrics.geminiRequests).toBe(1);
      expect(run.metrics.totalRetries).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it('fails a rate-limited batch WITHOUT falling back to individual requests (no request storm)', async () => {
    const callLog: number[] = [];
    const spy = jest.spyOn(ProviderFactory, 'getProvider').mockReturnValue(createRateLimitedProvider(callLog) as never);
    try {
      // No pipeline-level retries: the provider exhausted its own 429 budget
      // and the batch must fail immediately (never individual fallback).
      const pipeline = new TranslationPipeline({ batchSize: 10, concurrency: 3, batchRateLimitRetries: 0 });
      const segments: TranslationSegment[] = Array.from({ length: 5 }, (_, i) => ({
        id: `s${i}`,
        index: i,
        sourceRaw: 'The patient has a fever.',
        sourceText: 'The patient has a fever.',
        status: 'pending' as const,
      }));

      const run = await pipeline.runWithMetrics({
        sourceLanguage: 'en',
        targetLanguage: 'hi',
        segments,
        jobId: 'rate-limit-job',
      });

      // Exactly ONE request: the batch attempt. No per-segment fallback on 429.
      expect(callLog).toHaveLength(1);
      expect(run.metrics.geminiRequests).toBe(1);
      expect(run.metrics.successfulRequests).toBe(0);
      expect(run.metrics.rateLimitedRequests).toBe(3);
      expect(run.metrics.rateLimitedBatches).toBe(1);
      expect(run.metrics.batchRateLimitRetries).toBe(0);
      // The storm that would have happened without the guard:
      expect(run.metrics.batchFallbackCount).toBe(0);
      // HTTP 429 is an API failure, NOT a linguistic proofreading failure —
      // it must never count toward corrective metrics.
      expect(run.metrics.correctiveRequests).toBe(0);
      expect(run.metrics.segmentsCorrected).toBe(0);
      for (const res of run.results) {
        expect(res.status).toBe('failed');
        expect(res.errorMessage).toContain('rate-limit');
      }
    } finally {
      spy.mockRestore();
    }
  });

  it('retries the SAME batch after a temporary HTTP 429 and completes every segment', async () => {
    let callCount = 0;
    const spy = jest.spyOn(ProviderFactory, 'getProvider').mockReturnValue({
      providerName: 'gemini',
      modelName: 'fake-model',
      async translate(
        _systemPrompt: string,
        userPrompt: string,
        options?: { jsonMode?: boolean }
      ): Promise<ProviderResponse> {
        callCount++;
        // First batch attempt is rate limited; the re-queued SAME batch succeeds.
        if (callCount === 1) {
          throw new RateLimitExhaustedError('Gemini API rate limited after 3 attempts (HTTP 429)', 3, 500);
        }
        if (options?.jsonMode) {
          const items = JSON.parse(userPrompt) as Array<{ id: string }>;
          return {
            text: JSON.stringify({
              translations: items.map((item) => ({ id: item.id, translation: 'अनुवादित पाठ' })),
            }),
            wasRetried: false,
            retryCount: 0,
            latencyMs: 1,
            model: 'fake-model',
            provider: 'gemini',
          };
        }
        return {
          text: 'अनुवादित पाठ',
          wasRetried: false,
          retryCount: 0,
          latencyMs: 1,
          model: 'fake-model',
          provider: 'gemini',
        };
      },
    } as never);
    try {
      const pipeline = new TranslationPipeline({
        batchSize: 10,
        concurrency: 3,
        batchRateLimitRetries: 3,
        batchRateLimitRetryBaseMs: 1,
      });
      const segments: TranslationSegment[] = Array.from({ length: 5 }, (_, i) => ({
        id: `s${i}`,
        index: i,
        sourceRaw: 'The patient has a fever.',
        sourceText: 'The patient has a fever.',
        status: 'pending' as const,
      }));

      const run = await pipeline.runWithMetrics({
        sourceLanguage: 'en',
        targetLanguage: 'hi',
        segments,
        jobId: 'temporary-429-job',
      });

      // 2 calls: 1 rate-limited batch attempt + 1 retry of the SAME batch.
      // No individual-segment fallback, no failed segments.
      expect(callCount).toBe(2);
      expect(run.results.filter((r) => r.status === 'completed')).toHaveLength(5);
      expect(run.results.filter((r) => r.status === 'failed')).toHaveLength(0);
      expect(run.metrics.geminiRequests).toBe(2);
      expect(run.metrics.batchRateLimitRetries).toBe(1);
      expect(run.metrics.rateLimitedRequests).toBe(3);
      expect(run.metrics.rateLimitedBatches).toBe(0); // recovered — never counted as failed
      expect(run.metrics.batchFallbackCount).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it('still falls back to individual processing for genuine batch failures (not rate limits)', async () => {
    const callLog: string[] = [];
    const spy = jest.spyOn(ProviderFactory, 'getProvider').mockReturnValue(createBatchFailureProvider(callLog) as never);
    try {
      const pipeline = new TranslationPipeline({ batchSize: 10, concurrency: 3, enableDeduplication: false });
      const segments: TranslationSegment[] = Array.from({ length: 5 }, (_, i) => ({
        id: `s${i}`,
        index: i,
        sourceRaw: 'The patient has a fever.',
        sourceText: 'The patient has a fever.',
        status: 'pending' as const,
      }));

      const run = await pipeline.runWithMetrics({
        sourceLanguage: 'en',
        targetLanguage: 'hi',
        segments,
        jobId: 'fallback-job',
      });

      // 1 batch request + 5 individual fallback requests, all resolved.
      expect(callLog).toEqual(['batch', 'single', 'single', 'single', 'single', 'single']);
      expect(run.metrics.geminiRequests).toBe(6);
      expect(run.metrics.successfulRequests).toBe(5);
      expect(run.metrics.batchFallbackCount).toBe(1);
      expect(run.metrics.rateLimitedBatches).toBe(0);
      expect(run.results.filter((r) => r.status === 'completed')).toHaveLength(5);
    } finally {
      spy.mockRestore();
    }
  });

  it('honors per-run batch size and concurrency options', async () => {
    const spy = jest.spyOn(ProviderFactory, 'getProvider').mockReturnValue(createFakeProvider() as never);
    try {
      const pipeline = new TranslationPipeline({ batchSize: 25, concurrency: 2 });
      const segments: TranslationSegment[] = Array.from({ length: 50 }, (_, i) => ({
        id: `s${i}`,
        index: i,
        sourceRaw: `The patient has a fever ${i}.`,
        sourceText: `The patient has a fever ${i}.`,
        status: 'pending' as const,
      }));

      const run = await pipeline.runWithMetrics({
        sourceLanguage: 'en',
        targetLanguage: 'hi',
        segments,
        jobId: 'tuning-job',
      });

      expect(run.metrics.batchSize).toBe(25);
      expect(run.metrics.concurrency).toBe(2);
      // 50 segments / 25 per batch = 2 API requests
      expect(run.metrics.geminiRequests).toBe(2);
      expect(run.results.filter((r) => r.status === 'completed')).toHaveLength(50);
    } finally {
      spy.mockRestore();
    }
  });

  it('emits progress events per batch with completed segment counts', async () => {
    const spy = jest.spyOn(ProviderFactory, 'getProvider').mockReturnValue(createFakeProvider() as never);
    try {
      const pipeline = new TranslationPipeline({ batchSize: 10, concurrency: 2 });
      const segments: TranslationSegment[] = Array.from({ length: 20 }, (_, i) => ({
        id: `s${i}`,
        index: i,
        sourceRaw: `The patient has a fever ${i}.`,
        sourceText: `The patient has a fever ${i}.`,
        status: 'pending' as const,
      }));

      const progressEvents: number[] = [];
      await pipeline.run({
        sourceLanguage: 'en',
        targetLanguage: 'hi',
        segments,
        jobId: 'progress-job',
      }, (status) => {
        progressEvents.push(status.completedSegments);
      });

      // One progress event per batch (2 batches), each reporting completed count
      expect(progressEvents.length).toBe(2);
      expect(progressEvents[0]).toBe(10);
      expect(progressEvents[1]).toBe(20);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('TranslationPipeline - universal domain', () => {
  it('translates every segment without requiring a domain selection', async () => {
    const spy = jest.spyOn(ProviderFactory, 'getProvider').mockReturnValue(createFakeProvider() as never);
    try {
      const pipeline = new TranslationPipeline();
      const segments: TranslationSegment[] = [
        { id: '1', index: 0, sourceRaw: 'The patient has a fever.', sourceText: 'The patient has a fever.', status: 'pending' },
        { id: '2', index: 1, sourceRaw: 'Take the medicine daily.', sourceText: 'Take the medicine daily.', status: 'pending' },
      ];

      // NOTE: no `domain` is passed — the request must not depend on one.
      const results = await pipeline.run({
        sourceLanguage: 'en',
        targetLanguage: 'hi',
        segments,
        jobId: 'no-domain-job',
      });

      expect(results).toHaveLength(2);
      for (const result of results) {
        expect(result.status).toBe('completed');
        expect(result.translatedText.length).toBeGreaterThan(0);
      }
      // Segment order and IDs preserved
      expect(results[0]!.segmentId).toBe('1');
      expect(results[1]!.segmentId).toBe('2');
    } finally {
      spy.mockRestore();
    }
  });

  it('skips non-source-language segments without sending them to the model (Tamil + English → Tamil to English)', async () => {
    const callLog: string[] = [];
    const spy = jest.spyOn(ProviderFactory, 'getProvider').mockReturnValue(createRecordingProvider(callLog) as never);
    try {
      const pipeline = new TranslationPipeline();
      const segments: TranslationSegment[] = [
        { id: '1', index: 0, sourceRaw: 'Patient Name: John Smith', sourceText: 'Patient Name: John Smith', status: 'pending' },
        { id: '2', index: 1, sourceRaw: 'நோயாளிக்கு காய்ச்சல் உள்ளது.', sourceText: 'நோயாளிக்கு காய்ச்சல் உள்ளது.', status: 'pending' },
      ];

      const run = await pipeline.runWithMetrics({
        sourceLanguage: 'ta',
        targetLanguage: 'en',
        segments,
        jobId: 'mixed-language-job',
      });
      const results = run.results;

      expect(results).toHaveLength(2);
      // English content in a Tamil → English document is skipped (never sent
      // to the model) and preserved unchanged
      expect(results[0]!.status).toBe('skipped');
      expect(results[0]!.translatedText).toBe('Patient Name: John Smith');
      // Tamil content is translated into English
      expect(results[1]!.status).toBe('completed');
      expect(results[1]!.translatedText).toContain('fever');
      // The provider only ever saw the Tamil segment
      expect(callLog).toHaveLength(1);
      expect(callLog[0]).toContain('நோயாளிக்கு');
      // Metrics report the skip
      expect(run.metrics.skippedSegments).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('skips Hindi segments when translating English → Hindi with Devanagari content present', async () => {
    const callLog: string[] = [];
    const spy = jest.spyOn(ProviderFactory, 'getProvider').mockReturnValue(createRecordingProvider(callLog) as never);
    try {
      const pipeline = new TranslationPipeline();
      const segments: TranslationSegment[] = [
        { id: '1', index: 0, sourceRaw: 'The patient has a fever.', sourceText: 'The patient has a fever.', status: 'pending' },
        { id: '2', index: 1, sourceRaw: 'मरीज़ को बुखार है।', sourceText: 'मरीज़ को बुखार है।', status: 'pending' },
        { id: '3', index: 2, sourceRaw: 'Take the medicine daily.', sourceText: 'Take the medicine daily.', status: 'pending' },
      ];

      const run = await pipeline.runWithMetrics({
        sourceLanguage: 'en',
        targetLanguage: 'hi',
        segments,
        jobId: 'en-hi-mixed-job',
      });
      const results = run.results;

      // English segments are translated; the already-Hindi segment is skipped
      expect(results[0]!.status).toBe('completed');
      expect(results[1]!.status).toBe('skipped');
      expect(results[1]!.translatedText).toBe('मरीज़ को बुखार है।');
      expect(results[2]!.status).toBe('completed');
      expect(run.metrics.skippedSegments).toBe(1);
      // Only the two English segments were ever sent to the model
      expect(callLog).toEqual(['The patient has a fever.', 'Take the medicine daily.']);
    } finally {
      spy.mockRestore();
    }
  });

  it('packs short segments densely with token-aware batching (avg batch size > configured batch count)', async () => {
    const spy = jest.spyOn(ProviderFactory, 'getProvider').mockReturnValue(createFakeProvider() as never);
    try {
      // Tiny token budget forces multiple batches even though batchSize cap is high
      const pipeline = new TranslationPipeline({ batchSize: 20, maxBatchTokens: 500, enableDeduplication: false });
      const segments: TranslationSegment[] = Array.from({ length: 20 }, (_, i) => ({
        id: `s${i}`,
        index: i,
        sourceRaw: 'Short text.',
        sourceText: 'Short text.',
        status: 'pending' as const,
      }));

      const run = await pipeline.runWithMetrics({
        sourceLanguage: 'en',
        targetLanguage: 'hi',
        segments,
        jobId: 'token-batch-job',
      });

      // All segments completed, ordering preserved
      expect(run.results.filter((r) => r.status === 'completed')).toHaveLength(20);
      expect(run.results[0]!.segmentId).toBe('s0');
      expect(run.results[19]!.segmentId).toBe('s19');
      // Token budget (500) forced more than one request for 20 segments
      expect(run.metrics.geminiRequests).toBeGreaterThan(1);
      expect(run.metrics.avgBatchSize).toBeLessThan(20);
      expect(run.metrics.maxBatchTokens).toBe(500);
    } finally {
      spy.mockRestore();
    }
  });

  /**
   * Records every system prompt + user prompt it receives. In batch mode,
   * echoes the source text for `incompleteSegmentId` (forces a completeness
   * failure → corrective pass) and returns valid translations otherwise.
   * Single mode returns a complete translation.
   */
  function createModeRecordingProvider(
    systemPrompts: string[],
    callLog: string[],
    incompleteSegmentId?: string
  ): TranslationProvider {
    return {
      providerName: 'gemini',
      modelName: 'fake-model',
      async translate(
        systemPrompt: string,
        userPrompt: string,
        options?: { jsonMode?: boolean }
      ): Promise<ProviderResponse> {
        systemPrompts.push(systemPrompt);
        if (options?.jsonMode) {
          const items = JSON.parse(userPrompt) as Array<{ id: string; sourceText: string }>;
          for (const item of items) callLog.push(item.sourceText);
          return {
            text: JSON.stringify({
              translations: items.map((item) => {
                if (item.id === incompleteSegmentId) {
                  return { id: item.id, translation: item.sourceText }; // echo → incomplete
                }
                const isTamil = /[\u0B80-\u0BFF]/.test(item.sourceText);
                return { id: item.id, translation: isTamil ? 'The patient has a fever.' : 'रोगी को बुखार है।' };
              }),
            }),
            wasRetried: false,
            retryCount: 0,
            latencyMs: 1,
            model: 'fake-model',
            provider: 'gemini',
          };
        }
        callLog.push(userPrompt);
        return {
          text: 'रोगी को बुखार है।',
          wasRetried: false,
          retryCount: 0,
          latencyMs: 1,
          model: 'fake-model',
          provider: 'gemini',
        };
      },
    };
  }



  it('reports stage timings in profiling metrics', async () => {
    const spy = jest.spyOn(ProviderFactory, 'getProvider').mockReturnValue(createFakeProvider() as never);
    try {
      const pipeline = new TranslationPipeline({ batchSize: 10, concurrency: 2 });
      const segments: TranslationSegment[] = Array.from({ length: 10 }, (_, i) => ({
        id: `s${i}`,
        index: i,
        sourceRaw: 'The patient has a fever.',
        sourceText: 'The patient has a fever.',
        status: 'pending' as const,
      }));

      const run = await pipeline.runWithMetrics({
        sourceLanguage: 'en',
        targetLanguage: 'hi',
        segments,
        jobId: 'timing-job',
      });
      const m = run.metrics;

      // All instrumentation stages present and non-negative
      expect(m.tLanguageFilterMs).toBeGreaterThanOrEqual(0);
      expect(m.tPromptBuildMs).toBeGreaterThanOrEqual(0);
      expect(m.tQueueWaitMs).toBeGreaterThanOrEqual(0);
      expect(m.tRetryWaitMs).toBeGreaterThanOrEqual(0);
      expect(m.tRestoreMs).toBeGreaterThanOrEqual(0);
      expect(m.tGeminiApiMs).toBeGreaterThan(0);
      expect(m.avgBatchSize).toBe(10);
      expect(m.skippedSegments).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });
});
