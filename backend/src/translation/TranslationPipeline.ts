import type { TranslationProvider } from './TranslationProvider.js';
import { PermanentProviderError, RateLimitExhaustedError } from './TranslationProvider.js';
import type { AIProviderName } from './TranslationProvider.js';
import { ProviderFactory } from './ProviderFactory.js';
import { ContextBuilder } from './ContextBuilder.js';
import { PromptBuilder } from './PromptBuilder.js';
import { TagProtector } from '../protection/TagProtector.js';
import { EntityProtector } from '../protection/EntityProtector.js';
import { GlossaryService } from '../glossary/glossaryService.js';
import { SegmentValidator } from '../validation/SegmentValidator.js';
import { getLanguageRules } from '../languages/languageRegistry.js';
import { getDomainConfig } from '../domains/domainRegistry.js';
import { classifySegmentLanguage } from '../languages/segmentLanguageFilter.js';
import { config } from '../config/index.js';
import { logger } from '../config/logger.js';
import type {
  TranslationSegment,
  TranslationResult,
  PipelineProfilerMetrics,
  TranslationJobStatus,
  SegmentError,
  BatchSegmentInputItem,
  BatchPromptInput,
  GlossaryTerm,
  TranslationDomain,
  TranslationType,
} from '../types/index.js';

export type ProgressCallback = (status: TranslationJobStatus) => void;

/**
 * Optional per-run tuning. Overrides config values and per-provider overrides.
 */
export interface PipelineOptions {
  /** Maximum concurrent in-flight batch requests */
  concurrency?: number;
  /** Maximum segments per batch (token-aware batching may pack fewer) */
  batchSize?: number;
  batchDelayMs?: number;
  /** Token budget per API request; 0 disables token-aware batching */
  maxBatchTokens?: number;
  /** Skip segments written in a language other than the source language */
  filterOtherLanguages?: boolean;
  /** Deduplicate identical text segments during job execution (default: true) */
  enableDeduplication?: boolean;
  /**
   * Pipeline-level retries for a batch whose HTTP 429 budget was exhausted
   * inside the provider. The SAME batch is re-queued with jittered exponential
   * backoff — never individual-segment fallback — before its segments fail.
   */
  batchRateLimitRetries?: number;
  /** Base delay (ms) for the pipeline-level 429 backoff (doubles per retry) */
  batchRateLimitRetryBaseMs?: number;
}

export interface PipelineInput {
  sourceLanguage: string;
  targetLanguage: string;
  domain?: TranslationDomain;
  segments: TranslationSegment[];
  jobId: string;
  providerName?: AIProviderName;
  modelName?: string;
  translationType?: TranslationType;
  customInstructions?: string;
}

export interface PipelineRunResult {
  results: TranslationResult[];
  metrics: PipelineProfilerMetrics;
}

/** Maximum number of errors attached to a single progress event (keeps progress cheap on large failed documents). */
const MAX_PROGRESS_ERRORS = 100;

/** Approximate token overhead per segment in the batch JSON prompt (id, keys, quotes, whitespace). */
const ITEM_JSON_OVERHEAD_TOKENS = 40;

/**
 * Cap on how many tokens the previous/next context contributes to a single
 * item's batch-packing estimate. Context is bounded (CONTEXT_MAX_CHARS) and
 * largely duplicated across neighboring batches, so counting it fully would
 * starve batch packing for documents with long paragraphs — unnecessarily
 * small batches. The real payload is still sent in full; only the estimate
 * used to size batches is capped.
 */
const CONTEXT_ESTIMATE_CAP_TOKENS = 120;

/**
 * Rough token estimator used for token-aware batching. ASCII text is ~4 chars
 * per token; Indic/Arabic scripts typically need more tokens per character.
 * This is a heuristic for prompt sizing, not an exact tokenizer.
 */
function estimateTextTokens(text: string): number {
  if (!text) return 0;
  let ascii = 0;
  let nonAscii = 0;
  for (const ch of text) {
    if (ch.charCodeAt(0) < 128) ascii++;
    else nonAscii++;
  }
  return Math.ceil(ascii / 4 + nonAscii * 0.75);
}

export class TranslationPipeline {
  private readonly contextBuilder: ContextBuilder;
  private readonly promptBuilder: PromptBuilder;
  private readonly tagProtector: TagProtector;
  private readonly entityProtector: EntityProtector;
  private readonly glossaryService: GlossaryService;
  private readonly segmentValidator: SegmentValidator;
  private readonly baseConcurrency: number;
  private readonly baseBatchSize: number;
  private readonly baseBatchDelayMs: number;
  private readonly baseMaxBatchTokens: number;
  private readonly baseFilterOtherLanguages: boolean;
  private readonly baseBatchRateLimitRetries: number;
  private readonly options: PipelineOptions;

  constructor(options: PipelineOptions = {}) {
    this.options = options;
    this.contextBuilder = new ContextBuilder(config.context.maxChars);
    this.promptBuilder = new PromptBuilder();
    this.tagProtector = new TagProtector();
    this.entityProtector = new EntityProtector();
    this.glossaryService = new GlossaryService();
    this.segmentValidator = new SegmentValidator();
    this.baseConcurrency = config.translation.concurrency;
    this.baseBatchSize = config.translation.batchSize;
    this.baseBatchDelayMs = config.translation.batchDelayMs;
    this.baseMaxBatchTokens = config.translation.maxBatchTokens;
    this.baseFilterOtherLanguages = config.translation.filterOtherLanguages;
    this.baseBatchRateLimitRetries = config.translation.batchRateLimitRetries;
  }

  /**
   * Runs the optimized batched translation pipeline.
   */
  async run(
    input: PipelineInput,
    onProgress?: ProgressCallback
  ): Promise<TranslationResult[]> {
    const runResult = await this.runWithMetrics(input, onProgress);
    return runResult.results;
  }

  /**
   * Runs translation pipeline and returns both results and profiling metrics.
   */
  async runWithMetrics(
    input: PipelineInput,
    onProgress?: ProgressCallback
  ): Promise<PipelineRunResult> {
    const { segments, sourceLanguage, targetLanguage, jobId, providerName, modelName } = input;
    const requestedDomain = input.domain;
    const domain: TranslationDomain = 'universal';
    const startTime = Date.now();
    const provider = ProviderFactory.getProvider(providerName, modelName);

    // Resolve effective batching settings: per-run options take precedence,
    // then provider-specific overrides (GEMINI_BATCH_SIZE etc.), then globals.
    const providerOverrides = config.translation.providerOverrides[provider.providerName];
    const batchSize = this.options.batchSize ?? providerOverrides?.batchSize ?? this.baseBatchSize;
    const concurrency = this.options.concurrency ?? providerOverrides?.concurrency ?? this.baseConcurrency;
    const batchDelayMs = this.options.batchDelayMs ?? this.baseBatchDelayMs;
    const maxBatchTokens = this.options.maxBatchTokens ?? providerOverrides?.maxBatchTokens ?? this.baseMaxBatchTokens;
    const filterOtherLanguages = this.options.filterOtherLanguages ?? this.baseFilterOtherLanguages;

    const results: TranslationResult[] = new Array(segments.length);
    const errors: SegmentError[] = [];

    let completedCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    let cacheHitsCount = 0;
    let totalRetries = 0;
    let geminiRequests = 0;
    let successfulRequests = 0;
    let rateLimitedRequests = 0;
    let tRateLimitWaitMs = 0;
    let rateLimitedBatches = 0;
    let batchFallbackCount = 0;
    let batchRateLimitRetries = 0;
    let correctiveRequests = 0;
    let segmentsCorrected = 0;
    let tCorrectiveAiMs = 0;
    const geminiDurationsMs: number[] = [];

    let tGlossaryTotalMs = 0;
    let tLanguageFilterTotalMs = 0;
    let tProtectionTotalMs = 0;
    let tPromptBuildTotalMs = 0;
    let tGeminiTotalMs = 0;
    let tRetryWaitTotalMs = 0;
    let tValidationTotalMs = 0;
    let tRestoreTotalMs = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let aiSpanStartMs = 0;
    let aiSpanEndMs = 0;

    logger.info(`[Pipeline] Starting translation`, {
      jobId,
      totalSegments: segments.length,
      sourceLanguage,
      targetLanguage,
      domain,
      requestedDomain,
      provider: provider.providerName,
      model: provider.modelName,
      concurrency,
      batchSize,
      batchDelayMs,
      maxBatchTokens,
      filterOtherLanguages,
    });

    const domainConfig = getDomainConfig(domain);
    const languageRules = getLanguageRules(targetLanguage);

    // 1. Pre-process Glossary (computed once per job, reused by every batch)
    const tGlossStart = Date.now();
    const glossaryTerms = this.glossaryService.getTerms(sourceLanguage, targetLanguage, domain);
    tGlossaryTotalMs += Date.now() - tGlossStart;

    // 2. Language/segment filtering
    const tLangFilterStart = Date.now();
    let toTranslate: TranslationSegment[];

    // In-memory job-scoped segment cache and duplicate mapping for recurring chat/text segments
    const segmentCache = new Map<string, { translatedText: string; translatedRaw: string; validationWarnings: string[] }>();
    const duplicateMap = new Map<string, TranslationSegment[]>();
    const uniqueToTranslate: TranslationSegment[] = [];

    if (filterOtherLanguages) {
      toTranslate = [];
      for (const seg of segments) {
        if (!seg.sourceText.trim()) {
          toTranslate.push(seg);
          continue;
        }
        const decision = classifySegmentLanguage(seg.sourceText, sourceLanguage);
        if (decision === 'other') {
          skippedCount++;
          results[seg.index] = {
            segmentId: seg.id,
            segmentIndex: seg.index,
            translatedText: seg.sourceText,
            translatedRaw: seg.sourceRaw,
            status: 'skipped',
            validationWarnings: [
              'Segment is written in a language other than the selected source language; preserved unchanged',
            ],
          };
        } else {
          toTranslate.push(seg);
        }
      }
      logger.info(`[Pipeline] Language filter: ${segments.length - skippedCount}/${segments.length} segments sent for translation, ${skippedCount} skipped (written in another language)`);
    } else {
      toTranslate = segments;
    }

    // In-memory deduplication: group duplicate segments by source text
    const enableDeduplication = this.options.enableDeduplication ?? true;
    for (const seg of toTranslate) {
      const key = seg.sourceText.trim();
      if (!key || !enableDeduplication) {
        uniqueToTranslate.push(seg);
        continue;
      }
      const cached = segmentCache.get(key);
      if (cached) {
        cacheHitsCount++;
        completedCount++;
        results[seg.index] = {
          segmentId: seg.id,
          segmentIndex: seg.index,
          translatedText: cached.translatedText,
          translatedRaw: cached.translatedRaw,
          status: 'completed',
          validationWarnings: cached.validationWarnings,
        };
      } else if (duplicateMap.has(key)) {
        duplicateMap.get(key)!.push(seg);
      } else {
        duplicateMap.set(key, []);
        uniqueToTranslate.push(seg);
      }
    }

    if (cacheHitsCount > 0) {
      logger.info(`[Pipeline] Segment cache: ${cacheHitsCount} duplicate segments satisfied instantly from in-memory job cache`);
    }

    tLanguageFilterTotalMs += Date.now() - tLangFilterStart;

    // 3. Pre-build prompts that are identical across all batches/segments.
    //    The system prompts depend only on languages/domain/glossary/rules, so
    //    they are built once instead of once per batch (avoids repeated work).
    const tPromptStart = Date.now();
    const batchPromptBase: BatchPromptInput = {
      sourceLanguage,
      targetLanguage,
      domain,
      items: [],
      glossaryTerms,
      languageRules,
      domainInstructions: domainConfig.promptInstructions,
      translationType: input.translationType,
      customInstructions: input.customInstructions,
    };
    const batchSystemPrompt = this.promptBuilder.buildBatchSystemPrompt(batchPromptBase, undefined);
    const singleSystemPrompt = this.promptBuilder.buildSystemPrompt({
      sourceLanguage,
      targetLanguage,
      domain,
      context: { previousText: '', currentText: '', nextText: '' },
      protectedText: '',
      glossaryTerms,
      languageRules,
      domainInstructions: domainConfig.promptInstructions,
      translationType: input.translationType,
      customInstructions: input.customInstructions,
    }, undefined);
    tPromptBuildTotalMs += Date.now() - tPromptStart;

    // 4. Partition unique segments into batches. Token-aware: pack as many segments
    //    as fit under the token budget (capped by maxBatchSize) instead of a
    //    fixed count — short segments pack densely, long segments never blow
    //    the prompt size. Order is preserved.
    const batches: TranslationSegment[][] = [];
    {
      let current: TranslationSegment[] = [];
      let currentTokens = 0;
      for (const seg of uniqueToTranslate) {
        const itemTokens = ITEM_JSON_OVERHEAD_TOKENS + estimateTextTokens(seg.sourceText);

        if (
          current.length > 0 &&
          (current.length >= batchSize || (maxBatchTokens > 0 && currentTokens + itemTokens > maxBatchTokens))
        ) {
          batches.push(current);
          current = [];
          currentTokens = 0;
        }
        current.push(seg);
        currentTokens += itemTokens;
      }
      if (current.length > 0) batches.push(current);
    }

    const totalBatches = batches.length;

    // 5. Process batches concurrently with a bounded worker pool. Each worker
    //    pulls the next batch from a shared queue, so a slow batch never blocks
    //    other batches from starting (a fixed window of N batches would wait
    //    for its slowest member before the next window could begin). At most
    //    `concurrency` requests are in flight at once, which bounds provider
    //    load and avoids rate-limit storms. Results are placed by segmentIndex,
    //    so the final output is always in the original document order no
    //    matter which batches finish first.
    let nextBatchIndex = 0;

    const emitProgress = (batchIndex: number): void => {
      if (!onProgress) return;
      onProgress({
        jobId,
        status: 'running',
        totalSegments: segments.length,
        completedSegments: completedCount,
        failedSegments: failedCount,
        skippedSegments: skippedCount,
        currentSegmentIndex: Math.min((batchIndex + 1) * batchSize - 1, segments.length - 1),
        currentBatch: batchIndex + 1,
        totalBatches,
        batchSize,
        // Progress events fire per batch; ship a bounded error list so
        // serializing progress stays cheap even with many failures.
        errors: errors.slice(0, MAX_PROGRESS_ERRORS),
      });
    };

    const processBatchAtIndex = async (batchIndex: number): Promise<void> => {
      const batch = batches[batchIndex]!;

      const batchRes = await this.processBatch(
        batch,
        batchIndex + 1,
        segments,
        sourceLanguage,
        targetLanguage,
        domain,
        domainConfig.promptInstructions,
        languageRules,
        glossaryTerms,
        batchSystemPrompt,
        singleSystemPrompt,
        provider
      ).catch((err) => {
        // Unexpected failure — mark batch segments as failed. The single
        // batch request that threw is still counted for accurate metrics.
        geminiRequests += 1;
        for (const seg of batch) {
          results[seg.index] = {
            segmentId: seg.id,
            segmentIndex: seg.index,
            translatedText: '',
            translatedRaw: '',
            status: 'failed',
            errorMessage: (err as Error)?.message ?? 'Batch pipeline error',
            validationWarnings: [],
          };
          failedCount++;
          errors.push({
            segmentId: seg.id,
            segmentIndex: seg.index,
            errorType: 'unknown',
            message: (err as Error)?.message ?? 'Batch pipeline error',
          });

          const key = seg.sourceText.trim();
          if (key) {
            const dups = duplicateMap.get(key);
            if (dups && dups.length > 0) {
              for (const dupSeg of dups) {
                results[dupSeg.index] = {
                  segmentId: dupSeg.id,
                  segmentIndex: dupSeg.index,
                  translatedText: '',
                  translatedRaw: '',
                  status: 'failed',
                  errorMessage: (err as Error)?.message ?? 'Batch pipeline error',
                  validationWarnings: [],
                };
                failedCount++;
              }
              duplicateMap.delete(key);
            }
          }
        }
        return null;
      });

      if (batchRes === null) {
        emitProgress(batchIndex);
        return;
      }          tProtectionTotalMs += batchRes.tProtectionMs;
          tPromptBuildTotalMs += batchRes.tPromptBuildMs;
          tGeminiTotalMs += batchRes.tGeminiMs;
          tRetryWaitTotalMs += batchRes.retryWaitMs;
          tValidationTotalMs += batchRes.tValidationMs;
          tRestoreTotalMs += batchRes.tRestoreMs;
          geminiRequests += batchRes.requests;
          successfulRequests += batchRes.successfulRequests;
          totalRetries += batchRes.retries;
          rateLimitedRequests += batchRes.rateLimitedRequests;
          tRateLimitWaitMs += batchRes.rateLimitWaitMs;
          if (batchRes.rateLimited) rateLimitedBatches++;
          if (batchRes.fallbackUsed) batchFallbackCount++;
          batchRateLimitRetries += batchRes.rateLimitRetries;
          correctiveRequests += batchRes.correctiveRequests;
          segmentsCorrected += batchRes.correctedSegments;
          tCorrectiveAiMs += batchRes.tCorrectiveAiMs;
      geminiDurationsMs.push(...batchRes.geminiDurations);
      totalInputTokens += batchRes.inputTokens;
      totalOutputTokens += batchRes.outputTokens;
      if (batchRes.aiFirstStartMs > 0) {
        aiSpanStartMs = aiSpanStartMs === 0
          ? batchRes.aiFirstStartMs
          : Math.min(aiSpanStartMs, batchRes.aiFirstStartMs);
        aiSpanEndMs = Math.max(aiSpanEndMs, batchRes.aiLastEndMs);
      }

      for (const res of batchRes.results) {
        results[res.segmentIndex] = res;
        if (res.status === 'completed') {
          completedCount++;
          const segObj = segments[res.segmentIndex];
          const key = segObj?.sourceText.trim();
          if (key) {
            segmentCache.set(key, {
              translatedText: res.translatedText,
              translatedRaw: res.translatedRaw,
              validationWarnings: res.validationWarnings,
            });
            const dups = duplicateMap.get(key);
            if (dups && dups.length > 0) {
              for (const dupSeg of dups) {
                results[dupSeg.index] = {
                  segmentId: dupSeg.id,
                  segmentIndex: dupSeg.index,
                  translatedText: res.translatedText,
                  translatedRaw: res.translatedRaw,
                  status: 'completed',
                  validationWarnings: res.validationWarnings,
                };
                completedCount++;
                cacheHitsCount++;
              }
              duplicateMap.delete(key);
            }
          }
        } else {
          failedCount++;
          errors.push({
            segmentId: res.segmentId,
            segmentIndex: res.segmentIndex,
            errorType: 'unknown',
            message: res.errorMessage ?? 'Batch segment translation failed',
          });
          const segObj = segments[res.segmentIndex];
          const key = segObj?.sourceText.trim();
          if (key) {
            const dups = duplicateMap.get(key);
            if (dups && dups.length > 0) {
              for (const dupSeg of dups) {
                results[dupSeg.index] = {
                  segmentId: dupSeg.id,
                  segmentIndex: dupSeg.index,
                  translatedText: '',
                  translatedRaw: '',
                  status: 'failed',
                  errorMessage: res.errorMessage ?? 'Unique segment batch translation failed',
                  validationWarnings: [],
                };
                failedCount++;
              }
              duplicateMap.delete(key);
            }
          }
        }
      }

      emitProgress(batchIndex);
    };

    const worker = async (): Promise<void> => {
      while (true) {
        const batchIndex = nextBatchIndex++;
        if (batchIndex >= batches.length) return;
        // Optional stagger between batch starts (default 0). Providers already
        // back off on 429/5xx, so an unconditional sleep only adds idle time.
        if (batchDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, batchDelayMs));
        }
        await processBatchAtIndex(batchIndex);
      }
    };

    // At least one worker (handles the zero-batch edge case), never more than
    // the batch count or the configured concurrency limit.
    const poolSize = Math.max(1, Math.min(concurrency, batches.length));
    await Promise.all(Array.from({ length: poolSize }, () => worker()));

    const tTotalMs = Date.now() - startTime;

    // Queue/wait time is the residual: wall-clock time in the concurrency loop
    // not accounted for by any measured stage (scheduling, inter-window waits).
    const accountedMs =
      tGlossaryTotalMs +
      tLanguageFilterTotalMs +
      tProtectionTotalMs +
      tPromptBuildTotalMs +
      tGeminiTotalMs +
      tValidationTotalMs +
      tRestoreTotalMs;
    const tQueueWaitMs = Math.max(0, tTotalMs - accountedMs);

    const avgGeminiTimeMs = geminiDurationsMs.length > 0
      ? Math.round(geminiDurationsMs.reduce((a, b) => a + b, 0) / geminiDurationsMs.length)
      : 0;
    const maxGeminiTimeMs = geminiDurationsMs.length > 0 ? Math.max(...geminiDurationsMs) : 0;
    const avgBatchSize = geminiRequests > 0
      ? Math.round((toTranslate.length / geminiRequests) * 10) / 10
      : 0;

    const metrics: PipelineProfilerMetrics = {
      tParsingMs: 0,
      tSegmentationMs: 0,
      tGlossaryMs: tGlossaryTotalMs,
      tLanguageFilterMs: tLanguageFilterTotalMs,
      tProtectionMs: tProtectionTotalMs,
      tPromptBuildMs: tPromptBuildTotalMs,
      tQueueWaitMs: tQueueWaitMs,
      tGeminiApiMs: tGeminiTotalMs,
      tAiElapsedMs: aiSpanEndMs > aiSpanStartMs ? aiSpanEndMs - aiSpanStartMs : 0,
      tRetryWaitMs: tRetryWaitTotalMs,
      tValidationMs: tValidationTotalMs,
      tRestoreMs: tRestoreTotalMs,
      tOutputGenerationMs: 0,
      tTotalMs,
      totalSegments: segments.length,
      skippedSegments: skippedCount,
      cacheHits: cacheHitsCount,
      geminiRequests,
      totalRetries,
      avgGeminiTimeMs,
      maxGeminiTimeMs,
      avgBatchSize,
      concurrency,
      batchSize,
      maxBatchTokens,
      totalInputTokens,
      totalOutputTokens,
      successfulRequests,
      rateLimitedRequests,
      rateLimitedBatches,
      batchFallbackCount,
      batchRateLimitRetries,
      tRateLimitWaitMs,
      correctiveRequests,
      segmentsCorrected,
      tCorrectiveAiMs,
    };

    logger.info(`[Pipeline] Translation complete`, {
      jobId,
      completed: completedCount,
      failed: failedCount,
      skipped: skippedCount,
      total: segments.length,
      tTotalMs,
    });

    return { results, metrics };
  }

  /**
   * Helper to robustly parse JSON batch array from provider response.
   * Handles root arrays and root objects wrapping arrays (e.g. { "segments": [...] }).
   */
  private extractBatchArray(rawJson: string): Array<{ id: string; translation: string }> | null {
    try {
      const cleaned = rawJson
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();

      const parsed = JSON.parse(cleaned);

      // New format: { translations: [...] } — produced by the current batch prompt
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        // Check preferred key first
        for (const key of ['translations', 'segments', 'items', 'data', 'results']) {
          const arr = (parsed as Record<string, unknown>)[key];
          if (Array.isArray(arr)) {
            return arr as Array<{ id: string; translation: string }>;
          }
        }
      }

      // Fallback: root array (legacy / Gemini format)
      if (Array.isArray(parsed)) {
        return parsed as Array<{ id: string; translation: string }>;
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Processes a batch of segments using structured JSON translation.
   * If batch execution or completeness checks fail, falls back to targeted individual segment retries.
   */
  private async processBatch(
    batch: TranslationSegment[],
    batchNumber: number,
    allSegments: TranslationSegment[],
    sourceLanguage: string,
    targetLanguage: string,
    domain: TranslationDomain,
    domainInstructions: string,
    languageRules: string[],
    glossaryTerms: GlossaryTerm[],
    batchSystemPrompt: string,
    singleSystemPrompt: string,
    provider: TranslationProvider
  ): Promise<{
    results: TranslationResult[];
    tProtectionMs: number;
    tPromptBuildMs: number;
    tGeminiMs: number;
    tValidationMs: number;
    tRestoreMs: number;
    retryWaitMs: number;
    requests: number;
    retries: number;
    geminiDurations: number[];
    inputTokens: number;
    outputTokens: number;
    aiFirstStartMs: number;
    aiLastEndMs: number;
    successfulRequests: number;
    rateLimitedRequests: number;
    rateLimitWaitMs: number;
    rateLimited: boolean;
    fallbackUsed: boolean;
    rateLimitRetries: number;
    correctiveRequests: number;
    correctedSegments: number;
    tCorrectiveAiMs: number;
  }> {
    let tProtectionMs = 0;
    let tPromptBuildMs = 0;
    let tGeminiMs = 0;
    let tValidationMs = 0;
    let tRestoreMs = 0;
    let retryWaitMs = 0;
    let requests = 0;
    let retries = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let aiFirstStartMs = 0;
    let aiLastEndMs = 0;
    let successfulRequests = 0;
    let rateLimitedRequests = 0;
    let rateLimitWaitMs = 0;
    let correctiveRequests = 0;
    let correctedSegments = 0;
    let tCorrectiveAiMs = 0;
    const geminiDurations: number[] = [];

    // Step 1: Protection & Context Building for each segment in batch
    const tProtStart = Date.now();
    const batchInputItems: BatchSegmentInputItem[] = [];
    const protectionMetaMap = new Map<string, { entityTokens: unknown[]; tagTokens: unknown[] }>();

    for (const segment of batch) {
      if (!segment.sourceText.trim()) continue;

      const context = this.contextBuilder.build(allSegments, segment.index);
      const entityResult = this.entityProtector.protect(segment.sourceRaw);
      const tagResult = this.tagProtector.protect(entityResult.protectedText);

      protectionMetaMap.set(segment.id, {
        entityTokens: entityResult.tokens,
        tagTokens: tagResult.tokens,
      });

      batchInputItems.push({
        id: segment.id,
        previousText: context.previousText || undefined,
        sourceText: tagResult.protectedText,
        nextText: context.nextText || undefined,
      });
    }
    tProtectionMs += Date.now() - tProtStart;

    // Handle empty batch
    if (batchInputItems.length === 0) {
      const emptyResults: TranslationResult[] = batch.map((seg) => ({
        segmentId: seg.id,
        segmentIndex: seg.index,
        translatedText: seg.targetText ?? '',
        translatedRaw: seg.targetRaw ?? '',
        status: 'completed',
        validationWarnings: ['Source text was empty'],
      }));
      return { results: emptyResults, tProtectionMs, tPromptBuildMs, tGeminiMs, tValidationMs, tRestoreMs, retryWaitMs, requests: 0, retries: 0, geminiDurations: [], inputTokens, outputTokens, aiFirstStartMs: 0, aiLastEndMs: 0, successfulRequests: 0, rateLimitedRequests: 0, rateLimitWaitMs: 0, rateLimited: false, fallbackUsed: false, rateLimitRetries: 0, correctiveRequests: 0, correctedSegments: 0, tCorrectiveAiMs: 0 };
    }

    // Step 2: Build Batch User Prompt (system prompt is prebuilt and shared)
    const tPromptStart = Date.now();
    const batchPromptInput: BatchPromptInput = {
      sourceLanguage,
      targetLanguage,
      domain,
      items: batchInputItems,
      glossaryTerms: glossaryTerms as any,
      languageRules,
      domainInstructions,
    };

    const userPrompt = this.promptBuilder.buildBatchUserPrompt(batchPromptInput);
    tPromptBuildMs += Date.now() - tPromptStart;

    // Step 3: Send Structured JSON Batch Request to AI Provider.
    // HTTP 429 is TEMPORARY: the provider first retries with Retry-After +
    // jittered backoff. If it still exhausts its own budget
    // (RateLimitExhaustedError), the pipeline re-queues the SAME batch with its
    // own jittered exponential backoff (batchRateLimitRetries). Only after that
    // policy is genuinely exhausted are the batch's segments marked failed.
    // Never fall back to individual segment requests on rate limits — that
    // would multiply the load into a request storm.
    let batchSuccess = false;
    let rawJsonResponse = '';

    const batchRateLimitMaxRetries = this.options.batchRateLimitRetries ?? this.baseBatchRateLimitRetries;
    const batchRateLimitRetryBaseMs = this.options.batchRateLimitRetryBaseMs ?? 1000;
    let rateLimitRetries = 0;
    let rlAttempt = 0;

    for (;;) {
      const attemptStart = Date.now();
      try {
        if (aiFirstStartMs === 0) aiFirstStartMs = Date.now();
        requests++;
        const apiResponse = await provider.translate(batchSystemPrompt, userPrompt, { jsonMode: true });
        rawJsonResponse = apiResponse.text;
        if (apiResponse.wasRetried) {
          retries += apiResponse.retryCount;
        }
        retryWaitMs += apiResponse.retryWaitMs ?? 0;
        successfulRequests++;
        rateLimitedRequests += apiResponse.rateLimitCount ?? 0;
        rateLimitWaitMs += apiResponse.rateLimitWaitMs ?? 0;
        inputTokens += apiResponse.usage?.inputTokens ?? 0;
        outputTokens += apiResponse.usage?.outputTokens ?? 0;
        const callDuration = apiResponse.latencyMs || (Date.now() - attemptStart);
        tGeminiMs += callDuration;
        geminiDurations.push(callDuration);
        batchSuccess = true;
        aiLastEndMs = Date.now();
        console.log(
          `[AI] provider=${apiResponse.provider} model=${apiResponse.model} batchSize=${batchInputItems.length} durationMs=${Math.round(callDuration)} inputTokens=${apiResponse.usage?.inputTokens ?? 0} outputTokens=${apiResponse.usage?.outputTokens ?? 0} retry=${apiResponse.retryCount}`
        );
        break;
      } catch (err) {
        tGeminiMs += Date.now() - attemptStart;
        aiLastEndMs = Date.now();
        console.log(
          `[AI] provider=${provider.providerName} model=${provider.modelName} batchSize=${batchInputItems.length} durationMs=${Math.round(Date.now() - attemptStart)} inputTokens=0 outputTokens=0 retry=0 error=${(err as Error).message}`
        );
        if (err instanceof PermanentProviderError) {
          // Fail fast: an invalid API key, missing model, or auth failure will
          // fail the same way for every segment — do not waste N individual
          // requests on a permanently failing provider.
          logger.error(`[Pipeline] Batch ${batchNumber} failed with a permanent provider error`, {
            error: (err as Error).message,
            provider: provider.providerName,
          });
          throw err;
        }
        if (err instanceof RateLimitExhaustedError) {
          rateLimitedRequests += err.rateLimitCount;
          rateLimitWaitMs += err.rateLimitWaitMs;
          if (rlAttempt < batchRateLimitMaxRetries) {
            // Temporary rate limit — wait (jittered exponential backoff) and
            // retry the SAME batch. No individual fallback.
            rlAttempt++;
            rateLimitRetries = rlAttempt;
            const waitMs = Math.max(
              0,
              Math.round(
                Math.min(batchRateLimitRetryBaseMs * Math.pow(2, rlAttempt - 1), 30000) *
                  (0.5 + Math.random() * 0.5)
              )
            );
            rateLimitWaitMs += waitMs;
            console.log(
              `[RATE LIMIT] provider=${provider.providerName} batch=${batchNumber} batchSize=${batchInputItems.length} attempt=${rlAttempt}/${batchRateLimitMaxRetries} waitMs=${waitMs}`
            );
            await new Promise((resolve) => setTimeout(resolve, waitMs));
            continue;
          }
          // Retry/backoff policy genuinely exhausted — mark the batch failed.
          // Still NO individual fallback: that would create a request storm.
          console.log(
            `[RATE LIMIT] provider=${provider.providerName} batch=${batchNumber} batchSize=${batchInputItems.length} giving up after ${rlAttempt} retry(ies)`
          );
          logger.error(
            `[Pipeline] Batch ${batchNumber} failed after rate-limit retries (${rateLimitedRequests} x HTTP 429); NOT falling back to individual requests`,
            { provider: provider.providerName }
          );
          const rateLimitedResults: TranslationResult[] = batch.map((seg) => ({
            segmentId: seg.id,
            segmentIndex: seg.index,
            translatedText: '',
            translatedRaw: '',
            status: 'failed',
            errorMessage: `Batch failed after rate-limit retries (${rateLimitedRequests} x HTTP 429): ${err.message}`,
            validationWarnings: [],
          }));
          return {
            results: rateLimitedResults,
            tProtectionMs,
            tPromptBuildMs,
            tGeminiMs,
            tValidationMs,
            tRestoreMs,
            retryWaitMs,
            requests,
            retries,
            geminiDurations,
            inputTokens,
            outputTokens,
            aiFirstStartMs,
            aiLastEndMs,
            successfulRequests: 0,
            rateLimitedRequests,
            rateLimitWaitMs,
            rateLimited: true,
            fallbackUsed: false,
            rateLimitRetries,
            correctiveRequests: 0,
            correctedSegments: 0,
            tCorrectiveAiMs: 0,
          };
        }
        logger.warn(`[Pipeline] Batch ${batchNumber} ${provider.providerName} call failed, falling back to individual segment processing`, {
          error: (err as Error).message,
        });
        break;
      }
    }

    // Step 4: Parse JSON response, restore segments, and check completeness
    if (batchSuccess && rawJsonResponse) {
      const tValStart = Date.now();
      const parsedArray = this.extractBatchArray(rawJsonResponse);

      if (parsedArray) {
        const translationMap = new Map(parsedArray.map((item) => [item.id, item.translation]));
        const results: TranslationResult[] = [];
        const incompleteSegments: TranslationSegment[] = [];

        for (const segment of batch) {
          if (!segment.sourceText.trim()) {
            results.push({
              segmentId: segment.id,
              segmentIndex: segment.index,
              translatedText: segment.targetText ?? '',
              translatedRaw: segment.targetRaw ?? '',
              status: 'completed',
              validationWarnings: ['Source empty'],
            });
            continue;
          }

          const translatedStr = translationMap.get(segment.id);
          if (translatedStr === undefined) {
            // Segment missing from batch response — retry individually
            logger.warn(`[Pipeline] Batch segment ${segment.id} missing from response, queuing for individual retry`, {
              provider: provider.providerName,
              batchNumber,
            });
            incompleteSegments.push(segment);
            continue;
          }

          const protMeta = protectionMetaMap.get(segment.id)!;
          let restoredRaw = translatedStr;

          // Restore tags & entities (timed separately for profiling)
          const tRestoreStart = Date.now();
          restoredRaw = this.tagProtector.restore(restoredRaw, protMeta.tagTokens as any);
          restoredRaw = this.entityProtector.restore(restoredRaw, protMeta.entityTokens as any);
          tRestoreMs += Date.now() - tRestoreStart;

          const translatedText = restoredRaw.replace(/<[^>]+>/g, '').trim();

          // Check completeness of batch translation
          const comp = this.segmentValidator.checkCompleteness(
            segment.sourceText,
            translatedText,
            sourceLanguage,
            targetLanguage
          );

          if (!comp.isComplete && comp.status === 'failed') {
            logger.warn(`[Pipeline] Batch segment ${segment.id} incomplete (${comp.reason}), queuing for individual retry`, {
              provider: provider.providerName,
              segmentId: segment.id,
              sourceLanguage,
              targetLanguage,
              reason: comp.reason,
            });
            incompleteSegments.push(segment);
            continue;
          }

          const validationWarnings: string[] = [];
          if (comp.status === 'warning' && comp.reason) {
            validationWarnings.push(comp.reason);
          }

          results.push({
            segmentId: segment.id,
            segmentIndex: segment.index,
            translatedText,
            translatedRaw: restoredRaw,
            status: 'completed',
            validationWarnings,
          });
        }

        // Individually retry any segments that were missing or failed completeness
        if (incompleteSegments.length > 0) {
          logger.info(`[Pipeline] Individually retrying ${incompleteSegments.length} incomplete/missing segment(s) from batch ${batchNumber}`);
          for (const segment of incompleteSegments) {
            // Secondary corrective pass: ONLY segments that failed validation/
            // completeness are re-requested, with the same quality mode.
            const fbRes = await this.processSingleSegment(
              segment,
              allSegments,
              sourceLanguage,
              targetLanguage,
              domain,
              domainInstructions,
              languageRules,
              glossaryTerms,
              singleSystemPrompt,
              provider,
              true // corrective: true — a linguistic validation failure
            );
            results.push(fbRes.result);
            tProtectionMs += fbRes.tProtectionMs;
            tPromptBuildMs += fbRes.tPromptBuildMs;
            tGeminiMs += fbRes.tGeminiMs;
            tValidationMs += fbRes.tValidationMs;
            tRestoreMs += fbRes.tRestoreMs;
            retryWaitMs += fbRes.retryWaitMs;
            requests += fbRes.requests;
            retries += fbRes.retries;
            successfulRequests += fbRes.successfulRequests;
            rateLimitedRequests += fbRes.rateLimitedRequests;
            rateLimitWaitMs += fbRes.rateLimitWaitMs;
            inputTokens += fbRes.inputTokens;
            outputTokens += fbRes.outputTokens;
            correctiveRequests += fbRes.correctiveRequests;
            correctedSegments += fbRes.correctedSegments;
            tCorrectiveAiMs += fbRes.tCorrectiveAiMs;
            if (fbRes.durationMs > 0) geminiDurations.push(fbRes.durationMs);
          }
        }

        tValidationMs += Date.now() - tValStart;
        return { results, tProtectionMs, tPromptBuildMs, tGeminiMs, tValidationMs, tRestoreMs, retryWaitMs, requests, retries, geminiDurations, inputTokens, outputTokens, aiFirstStartMs, aiLastEndMs, successfulRequests, rateLimitedRequests, rateLimitWaitMs, rateLimited: false, fallbackUsed: false, rateLimitRetries, correctiveRequests, correctedSegments, tCorrectiveAiMs };
      } else {
        logger.warn(`[Pipeline] JSON parse or batch extraction error on batch ${batchNumber}, falling back to individual segment processing`);
      }
      tValidationMs += Date.now() - tValStart;
    }

    // Fallback: Process batch segments individually (with corrective retry if needed)
    logger.info(`[Pipeline] Running fallback individual segment translation for batch ${batchNumber}`);
    const fallbackResults: TranslationResult[] = [];

    for (const segment of batch) {
      if (aiFirstStartMs === 0) aiFirstStartMs = Date.now();
      // Genuine batch/content failure recovery — NOT a linguistic proofreading
      // pass, so corrective metrics stay 0 (rate-limit failures never reach
      // this path either).
      const fbRes = await this.processSingleSegment(
        segment,
        allSegments,
        sourceLanguage,
        targetLanguage,
        domain,
        domainInstructions,
        languageRules,
        glossaryTerms,
        singleSystemPrompt,
        provider,
        false // corrective: false
      );
      aiLastEndMs = Date.now();
      fallbackResults.push(fbRes.result);
      tProtectionMs += fbRes.tProtectionMs;
      tPromptBuildMs += fbRes.tPromptBuildMs;
      tGeminiMs += fbRes.tGeminiMs;
      tValidationMs += fbRes.tValidationMs;
      tRestoreMs += fbRes.tRestoreMs;
      retryWaitMs += fbRes.retryWaitMs;
      requests += fbRes.requests;
      retries += fbRes.retries;
      successfulRequests += fbRes.successfulRequests;
      rateLimitedRequests += fbRes.rateLimitedRequests;
      rateLimitWaitMs += fbRes.rateLimitWaitMs;
      inputTokens += fbRes.inputTokens;
      outputTokens += fbRes.outputTokens;
      correctiveRequests += fbRes.correctiveRequests;
      correctedSegments += fbRes.correctedSegments;
      tCorrectiveAiMs += fbRes.tCorrectiveAiMs;
      if (fbRes.durationMs > 0) geminiDurations.push(fbRes.durationMs);
    }

    return { results: fallbackResults, tProtectionMs, tPromptBuildMs, tGeminiMs, tValidationMs, tRestoreMs, retryWaitMs, requests, retries, geminiDurations, inputTokens, outputTokens, aiFirstStartMs, aiLastEndMs, successfulRequests, rateLimitedRequests, rateLimitWaitMs, rateLimited: false, fallbackUsed: true, rateLimitRetries, correctiveRequests, correctedSegments, tCorrectiveAiMs };
  }

  /**
   * Processes a single segment with automatic completeness checking and corrective retry.
   */
  private async processSingleSegment(
    segment: TranslationSegment,
    allSegments: TranslationSegment[],
    sourceLanguage: string,
    targetLanguage: string,
    domain: TranslationDomain,
    domainInstructions: string,
    languageRules: string[],
    glossaryTerms: GlossaryTerm[],
    baseSystemPrompt: string,
    provider: TranslationProvider,
    /** True when this call re-requests a segment that failed validation (secondary corrective pass) */
    corrective = false
  ): Promise<{
    result: TranslationResult;
    tProtectionMs: number;
    tPromptBuildMs: number;
    tGeminiMs: number;
    tValidationMs: number;
    tRestoreMs: number;
    retryWaitMs: number;
    requests: number;
    retries: number;
    durationMs: number;
    inputTokens: number;
    outputTokens: number;
    successfulRequests: number;
    rateLimitedRequests: number;
    rateLimitWaitMs: number;
    correctiveRequests: number;
    correctedSegments: number;
    tCorrectiveAiMs: number;
  }> {
    let tProtectionMs = 0;
    let tPromptBuildMs = 0;
    let tGeminiMs = 0;
    let tValidationMs = 0;
    let tRestoreMs = 0;
    let retryWaitMs = 0;
    let requests = 0;
    let retries = 0;
    let durationMs = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let successfulRequests = 0;
    let rateLimitedRequests = 0;
    let rateLimitWaitMs = 0;
    let correctiveRequests = 0;
    let correctedSegments = 0;
    let tCorrectiveAiMs = 0;

    if (!segment.sourceText.trim()) {
      return {
        result: {
          segmentId: segment.id,
          segmentIndex: segment.index,
          translatedText: segment.targetText ?? '',
          translatedRaw: segment.targetRaw ?? '',
          status: 'completed',
          validationWarnings: [],
        },
        tProtectionMs: 0,
        tPromptBuildMs: 0,
        tGeminiMs: 0,
        tValidationMs: 0,
        tRestoreMs: 0,
        retryWaitMs: 0,
        requests: 0,
        retries: 0,
        durationMs: 0,
        inputTokens: 0,
        outputTokens: 0,
        successfulRequests: 0,
        rateLimitedRequests: 0,
        rateLimitWaitMs: 0,
        correctiveRequests: 0,
        correctedSegments: 0,
        tCorrectiveAiMs: 0,
      };
    }

    const tProtStart = Date.now();
    const context = this.contextBuilder.build(allSegments, segment.index);
    const entityResult = this.entityProtector.protect(segment.sourceRaw);
    const tagResult = this.tagProtector.protect(entityResult.protectedText);
    tProtectionMs += Date.now() - tProtStart;

    const promptInput = {
      sourceLanguage,
      targetLanguage,
      domain,
      context,
      protectedText: tagResult.protectedText,
      glossaryTerms,
      languageRules,
      domainInstructions,
    };

    let retryNotice: string | undefined = undefined;
    const maxAttempts = 2; // Attempt 1: normal, Attempt 2: corrective retry if incomplete

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const attemptStartedAt = Date.now();
      try {
        // The base system prompt is reused across segments; only the corrective
        // retry notice requires building a prompt variant.
        const tPromptStart = Date.now();
        const systemPrompt = retryNotice
          ? this.promptBuilder.buildSystemPrompt(promptInput, retryNotice)
          : baseSystemPrompt;
        const userPrompt = this.promptBuilder.buildUserPrompt(promptInput);
        tPromptBuildMs += Date.now() - tPromptStart;

        const tGemStart = Date.now();
        requests++;
        // Attempt 2 (retryNotice) and corrective re-requests are the secondary
        // corrective pass: only validation-failed segments are re-sent.
        const isCorrectiveRequest = corrective || retryNotice !== undefined;
        const apiResponse = await provider.translate(systemPrompt, userPrompt);
        const lastDuration = apiResponse.latencyMs || (Date.now() - tGemStart);
        durationMs += lastDuration;
        tGeminiMs += lastDuration;
        if (isCorrectiveRequest) {
          correctiveRequests++;
          tCorrectiveAiMs += lastDuration;
        }
        if (apiResponse.wasRetried) retries += apiResponse.retryCount;
        retryWaitMs += apiResponse.retryWaitMs ?? 0;
        successfulRequests++;
        rateLimitedRequests += apiResponse.rateLimitCount ?? 0;
        rateLimitWaitMs += apiResponse.rateLimitWaitMs ?? 0;
        inputTokens += apiResponse.usage?.inputTokens ?? 0;
        outputTokens += apiResponse.usage?.outputTokens ?? 0;
        console.log(
          `[AI] provider=${apiResponse.provider} model=${apiResponse.model} batchSize=1 durationMs=${Math.round(lastDuration)} inputTokens=${apiResponse.usage?.inputTokens ?? 0} outputTokens=${apiResponse.usage?.outputTokens ?? 0} retry=${apiResponse.retryCount}`
        );

        let translatedRaw = apiResponse.text;

        const tValStart = Date.now();
        try {
          const tRestoreStart = Date.now();
          translatedRaw = this.tagProtector.restore(translatedRaw, tagResult.tokens);
          translatedRaw = this.entityProtector.restore(translatedRaw, entityResult.tokens);
          tRestoreMs += Date.now() - tRestoreStart;
        } catch (restErr) {
          tValidationMs += Date.now() - tValStart;
          return {
            result: {
              segmentId: segment.id,
              segmentIndex: segment.index,
              translatedText: '',
              translatedRaw: '',
              status: 'failed',
              errorMessage: (restErr as Error).message,
              validationWarnings: [],
            },
            tProtectionMs,
            tPromptBuildMs,
            tGeminiMs,
            tValidationMs,
            tRestoreMs,
            retryWaitMs,
            requests,
            retries,
            durationMs,
            inputTokens,
            outputTokens,
            successfulRequests,
            rateLimitedRequests,
            rateLimitWaitMs,
            correctiveRequests,
            correctedSegments,
            tCorrectiveAiMs,
          };
        }

        const translatedText = translatedRaw.replace(/<[^>]+>/g, '').trim();

        // Check translation completeness
        const comp = this.segmentValidator.checkCompleteness(
          segment.sourceText,
          translatedText,
          sourceLanguage,
          targetLanguage
        );

        tValidationMs += Date.now() - tValStart;

        if (comp.isComplete || comp.status !== 'failed' || attempt === maxAttempts - 1) {
          if (!comp.isComplete && comp.status === 'failed') {
            logger.warn(`[Pipeline] Incomplete translation persistent for segment ${segment.id}`, {
              provider: provider.providerName,
              model: provider.modelName,
              sourceLanguage,
              targetLanguage,
              segmentId: segment.id,
              validationResult: comp.reason,
              retryCount: attempt,
              reason: 'untranslated_content_detected',
            });
            
            return {
              result: {
                segmentId: segment.id,
                segmentIndex: segment.index,
                translatedText: '',
                translatedRaw: '',
                status: 'failed',
                errorMessage: comp.reason ?? 'Incomplete translation: source language text left untranslated',
                validationWarnings: [],
              },
              tProtectionMs,
              tPromptBuildMs,
              tGeminiMs,
              tValidationMs,
              tRestoreMs,
              retryWaitMs,
              requests,
              retries,
              durationMs,
              inputTokens,
              outputTokens,
              successfulRequests,
              rateLimitedRequests,
              rateLimitWaitMs,
              correctiveRequests,
              correctedSegments,
              tCorrectiveAiMs,
            };
          }

          const warnings: string[] = [];
          if (comp.status === 'warning' && comp.reason) {
            warnings.push(comp.reason);
          }

          return {
            result: {
              segmentId: segment.id,
              segmentIndex: segment.index,
              translatedText,
              translatedRaw,
              status: 'completed',
              validationWarnings: warnings,
            },
            tProtectionMs,
            tPromptBuildMs,
            tGeminiMs,
            tValidationMs,
            tRestoreMs,
            retryWaitMs,
            requests,
            retries,
            durationMs,
            inputTokens,
            outputTokens,
            successfulRequests,
            rateLimitedRequests,
            rateLimitWaitMs,
            correctiveRequests,
            // A completed corrective re-request counts as a corrected segment
            correctedSegments: corrective ? 1 : 0,
            tCorrectiveAiMs,
          };
        }

        // Completeness check failed — trigger corrective retry for attempt 2
        retries++;
        retryNotice = comp.reason ?? 'Source language text was left untranslated';
        logger.warn(`[Pipeline] Segment ${segment.id} incomplete (${comp.reason}), executing corrective retry (attempt ${attempt + 2})`, {
          provider: provider.providerName,
          model: provider.modelName,
          sourceLanguage,
          targetLanguage,
          segmentId: segment.id,
          reason: comp.reason,
        });

      } catch (err) {
        console.log(
          `[AI] provider=${provider.providerName} model=${provider.modelName} batchSize=1 durationMs=${Math.round(Date.now() - attemptStartedAt)} inputTokens=0 outputTokens=0 retry=0 error=${(err as Error).message}`
        );
        // Keep the failure scoped to this segment: permanent provider errors
        // already fail immediately inside the provider (no retries wasted), and
        // discarding the rest of a batch's valid translations to fail fast is
        // worse than reporting the single segment's error.
        return {
          result: {
            segmentId: segment.id,
            segmentIndex: segment.index,
            translatedText: '',
            translatedRaw: '',
            status: 'failed',
            errorMessage: (err as Error).message,
            validationWarnings: [],
          },
          tProtectionMs,
          tPromptBuildMs,
          tGeminiMs,
          tValidationMs,
          tRestoreMs,
          retryWaitMs,
          requests,
          retries,
          durationMs,
          inputTokens,
          outputTokens,
          successfulRequests,
          rateLimitedRequests,
          rateLimitWaitMs,
          correctiveRequests,
          correctedSegments,
          tCorrectiveAiMs,
        };
      }
    }

    return {
      result: {
        segmentId: segment.id,
        segmentIndex: segment.index,
        translatedText: '',
        translatedRaw: '',
        status: 'failed',
        errorMessage: 'Translation failed after retries',
        validationWarnings: [],
      },
      tProtectionMs,
      tPromptBuildMs,
      tGeminiMs,
      tValidationMs,
      tRestoreMs,
      retryWaitMs,
      requests,
      retries,
      durationMs,
      inputTokens,
      outputTokens,
      successfulRequests,
      rateLimitedRequests,
      rateLimitWaitMs,
      correctiveRequests,
      correctedSegments,
      tCorrectiveAiMs,
    };
  }
}
