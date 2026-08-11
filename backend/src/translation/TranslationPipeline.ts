import type { TranslationProvider } from './TranslationProvider.js';
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
  TranslationDomain,
} from '../types/index.js';

export type ProgressCallback = (status: TranslationJobStatus) => void;

export interface PipelineInput {
  sourceLanguage: string;
  targetLanguage: string;
  domain?: TranslationDomain;
  segments: TranslationSegment[];
  jobId: string;
  providerName?: AIProviderName;
  modelName?: string;
}

export interface PipelineRunResult {
  results: TranslationResult[];
  metrics: PipelineProfilerMetrics;
}

export class TranslationPipeline {
  private readonly contextBuilder: ContextBuilder;
  private readonly promptBuilder: PromptBuilder;
  private readonly tagProtector: TagProtector;
  private readonly entityProtector: EntityProtector;
  private readonly glossaryService: GlossaryService;
  private readonly segmentValidator: SegmentValidator;
  private readonly concurrency: number;
  private readonly batchSize: number;

  constructor() {
    this.contextBuilder = new ContextBuilder(config.context.maxChars);
    this.promptBuilder = new PromptBuilder();
    this.tagProtector = new TagProtector();
    this.entityProtector = new EntityProtector();
    this.glossaryService = new GlossaryService();
    this.segmentValidator = new SegmentValidator();
    this.concurrency = config.translation.concurrency;
    this.batchSize = config.translation.batchSize;
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

    const results: TranslationResult[] = new Array(segments.length);
    const errors: SegmentError[] = [];

    let completedCount = 0;
    let failedCount = 0;
    let totalRetries = 0;
    let geminiRequests = 0;
    const geminiDurationsMs: number[] = [];

    let tGlossaryTotalMs = 0;
    let tProtectionTotalMs = 0;
    let tGeminiTotalMs = 0;
    let tValidationTotalMs = 0;

    logger.info(`[Pipeline] Starting translation`, {
      jobId,
      totalSegments: segments.length,
      sourceLanguage,
      targetLanguage,
      domain,
      requestedDomain,
      provider: provider.providerName,
      model: provider.modelName,
      concurrency: this.concurrency,
      batchSize: this.batchSize,
    });

    const domainConfig = getDomainConfig(domain);
    const languageRules = getLanguageRules(targetLanguage);

    // 1. Pre-process Glossary
    const tGlossStart = Date.now();
    const glossaryTerms = this.glossaryService.getTerms(sourceLanguage, targetLanguage, domain);
    tGlossaryTotalMs += Date.now() - tGlossStart;

    // 2. Partition segments into batches
    const batches: TranslationSegment[][] = [];
    for (let i = 0; i < segments.length; i += this.batchSize) {
      batches.push(segments.slice(i, i + this.batchSize));
    }

    const totalBatches = batches.length;

    // 3. Process batches concurrently based on concurrency setting
    for (let batchStart = 0; batchStart < batches.length; batchStart += this.concurrency) {
      const activeBatches = batches.slice(batchStart, batchStart + this.concurrency);

      const batchPromises = activeBatches.map((batch, idx) => {
        const batchNumber = batchStart + idx + 1;
        return this.processBatch(
          batch,
          batchNumber,
          segments,
          sourceLanguage,
          targetLanguage,
          domain,
          domainConfig.promptInstructions,
          languageRules,
          glossaryTerms,
          provider
        );
      });

      const settledBatches = await Promise.allSettled(batchPromises);

      for (let i = 0; i < settledBatches.length; i++) {
        const batchIndex = batchStart + i;
        const settled = settledBatches[i]!;

        if (settled.status === 'fulfilled') {
          const batchRes = settled.value;
          tProtectionTotalMs += batchRes.tProtectionMs;
          tGeminiTotalMs += batchRes.tGeminiMs;
          tValidationTotalMs += batchRes.tValidationMs;
          geminiRequests += batchRes.requests;
          totalRetries += batchRes.retries;
          geminiDurationsMs.push(...batchRes.geminiDurations);

          for (const res of batchRes.results) {
            results[res.segmentIndex] = res;
            if (res.status === 'completed') {
              completedCount++;
            } else {
              failedCount++;
              errors.push({
                segmentId: res.segmentId,
                segmentIndex: res.segmentIndex,
                errorType: 'unknown',
                message: res.errorMessage ?? 'Batch segment translation failed',
              });
            }
          }
        } else {
          // Unexpected failure — mark batch segments as failed
          const batch = batches[batchIndex]!;
          for (const seg of batch) {
            results[seg.index] = {
              segmentId: seg.id,
              segmentIndex: seg.index,
              translatedText: '',
              translatedRaw: '',
              status: 'failed',
              errorMessage: (settled.reason as Error)?.message ?? 'Batch pipeline error',
              validationWarnings: [],
            };
            failedCount++;
            errors.push({
              segmentId: seg.id,
              segmentIndex: seg.index,
              errorType: 'unknown',
              message: (settled.reason as Error)?.message ?? 'Batch pipeline error',
            });
          }
        }

        if (onProgress) {
          onProgress({
            jobId,
            status: 'running',
            totalSegments: segments.length,
            completedSegments: completedCount,
            failedSegments: failedCount,
            skippedSegments: 0,
            currentSegmentIndex: Math.min((batchIndex + 1) * this.batchSize - 1, segments.length - 1),
            currentBatch: batchIndex + 1,
            totalBatches,
            batchSize: this.batchSize,
            errors,
          });
        }
      }

      // Brief inter-batch pause to keep request rates smooth
      if (batchStart + this.concurrency < batches.length) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }

    const tTotalMs = Date.now() - startTime;
    const avgGeminiTimeMs = geminiDurationsMs.length > 0
      ? Math.round(geminiDurationsMs.reduce((a, b) => a + b, 0) / geminiDurationsMs.length)
      : 0;
    const maxGeminiTimeMs = geminiDurationsMs.length > 0 ? Math.max(...geminiDurationsMs) : 0;

    const metrics: PipelineProfilerMetrics = {
      tParsingMs: 0,
      tSegmentationMs: 0,
      tGlossaryMs: tGlossaryTotalMs,
      tProtectionMs: tProtectionTotalMs,
      tGeminiApiMs: tGeminiTotalMs,
      tValidationMs: tValidationTotalMs,
      tOutputGenerationMs: 0,
      tTotalMs,
      totalSegments: segments.length,
      geminiRequests,
      totalRetries,
      avgGeminiTimeMs,
      maxGeminiTimeMs,
      concurrency: this.concurrency,
      batchSize: this.batchSize,
    };

    logger.info(`[Pipeline] Translation complete`, {
      jobId,
      completed: completedCount,
      failed: failedCount,
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
    glossaryTerms: unknown[],
    provider: TranslationProvider
  ): Promise<{
    results: TranslationResult[];
    tProtectionMs: number;
    tGeminiMs: number;
    tValidationMs: number;
    requests: number;
    retries: number;
    geminiDurations: number[];
  }> {
    let tProtectionMs = 0;
    let tGeminiMs = 0;
    let tValidationMs = 0;
    let requests = 0;
    let retries = 0;
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
      return { results: emptyResults, tProtectionMs, tGeminiMs, tValidationMs, requests: 0, retries: 0, geminiDurations: [] };
    }

    // Step 2: Build Batch Prompt
    const batchPromptInput: BatchPromptInput = {
      sourceLanguage,
      targetLanguage,
      domain,
      items: batchInputItems,
      glossaryTerms: glossaryTerms as any,
      languageRules,
      domainInstructions,
    };

    const systemPrompt = this.promptBuilder.buildBatchSystemPrompt(batchPromptInput);
    const userPrompt = this.promptBuilder.buildBatchUserPrompt(batchPromptInput);

    // Step 3: Send Structured JSON Batch Request to AI Provider
    let batchSuccess = false;
    let rawJsonResponse = '';

    const tGemStart = Date.now();
    try {
      requests++;
      const apiResponse = await provider.translate(systemPrompt, userPrompt, { jsonMode: true });
      rawJsonResponse = apiResponse.text;
      if (apiResponse.wasRetried) {
        retries += apiResponse.retryCount;
      }
      const callDuration = apiResponse.latencyMs || (Date.now() - tGemStart);
      tGeminiMs += callDuration;
      geminiDurations.push(callDuration);
      batchSuccess = true;
    } catch (err) {
      tGeminiMs += Date.now() - tGemStart;
      logger.warn(`[Pipeline] Batch ${batchNumber} ${provider.providerName} call failed, falling back to individual segment processing`, {
        error: (err as Error).message,
      });
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

          // Restore tags & entities
          restoredRaw = this.tagProtector.restore(restoredRaw, protMeta.tagTokens as any);
          restoredRaw = this.entityProtector.restore(restoredRaw, protMeta.entityTokens as any);

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
            const fbRes = await this.processSingleSegment(
              segment,
              allSegments,
              sourceLanguage,
              targetLanguage,
              domain,
              domainInstructions,
              languageRules,
              provider
            );
            results.push(fbRes.result);
            tProtectionMs += fbRes.tProtectionMs;
            tGeminiMs += fbRes.tGeminiMs;
            tValidationMs += fbRes.tValidationMs;
            requests += fbRes.requests;
            retries += fbRes.retries;
            if (fbRes.durationMs > 0) geminiDurations.push(fbRes.durationMs);
          }
        }

        tValidationMs += Date.now() - tValStart;
        return { results, tProtectionMs, tGeminiMs, tValidationMs, requests, retries, geminiDurations };
      } else {
        logger.warn(`[Pipeline] JSON parse or batch extraction error on batch ${batchNumber}, falling back to individual segment processing`);
      }
      tValidationMs += Date.now() - tValStart;
    }

    // Fallback: Process batch segments individually (with corrective retry if needed)
    logger.info(`[Pipeline] Running fallback individual segment translation for batch ${batchNumber}`);
    const fallbackResults: TranslationResult[] = [];

    for (const segment of batch) {
      const fbRes = await this.processSingleSegment(
        segment,
        allSegments,
        sourceLanguage,
        targetLanguage,
        domain,
        domainInstructions,
        languageRules,
        provider
      );
      fallbackResults.push(fbRes.result);
      tProtectionMs += fbRes.tProtectionMs;
      tGeminiMs += fbRes.tGeminiMs;
      tValidationMs += fbRes.tValidationMs;
      requests += fbRes.requests;
      retries += fbRes.retries;
      if (fbRes.durationMs > 0) geminiDurations.push(fbRes.durationMs);
    }

    return { results: fallbackResults, tProtectionMs, tGeminiMs, tValidationMs, requests, retries, geminiDurations };
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
    provider: TranslationProvider
  ): Promise<{
    result: TranslationResult;
    tProtectionMs: number;
    tGeminiMs: number;
    tValidationMs: number;
    requests: number;
    retries: number;
    durationMs: number;
  }> {
    let tProtectionMs = 0;
    let tGeminiMs = 0;
    let tValidationMs = 0;
    let requests = 0;
    let retries = 0;
    let durationMs = 0;

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
        tGeminiMs: 0,
        tValidationMs: 0,
        requests: 0,
        retries: 0,
        durationMs: 0,
      };
    }

    const tProtStart = Date.now();
    const context = this.contextBuilder.build(allSegments, segment.index);
    const glossaryTerms = this.glossaryService.getTerms(sourceLanguage, targetLanguage, domain);
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
      try {
        const systemPrompt = this.promptBuilder.buildSystemPrompt(promptInput, retryNotice);
        const userPrompt = this.promptBuilder.buildUserPrompt(promptInput);

        const tGemStart = Date.now();
        requests++;
        const apiResponse = await provider.translate(systemPrompt, userPrompt);
        const lastDuration = apiResponse.latencyMs || (Date.now() - tGemStart);
        durationMs += lastDuration;
        tGeminiMs += lastDuration;
        if (apiResponse.wasRetried) retries += apiResponse.retryCount;

        let translatedRaw = apiResponse.text;

        const tValStart = Date.now();
        try {
          translatedRaw = this.tagProtector.restore(translatedRaw, tagResult.tokens);
          translatedRaw = this.entityProtector.restore(translatedRaw, entityResult.tokens);
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
            tGeminiMs,
            tValidationMs,
            requests,
            retries,
            durationMs,
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
              tGeminiMs,
              tValidationMs,
              requests,
              retries,
              durationMs,
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
            tGeminiMs,
            tValidationMs,
            requests,
            retries,
            durationMs,
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
          tGeminiMs,
          tValidationMs,
          requests,
          retries,
          durationMs,
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
      tGeminiMs,
      tValidationMs,
      requests,
      retries,
      durationMs,
    };
  }
}
