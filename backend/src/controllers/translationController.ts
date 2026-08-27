import type { Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { AdapterFactory } from '../adapters/AdapterFactory.js';
import { generateOutputFileName } from '../utils/fileNameUtils.js';
import { OutputGeneratorFactory } from '../output/OutputGeneratorFactory.js';
import { TranslationPipeline } from '../translation/TranslationPipeline.js';
import { ProviderFactory } from '../translation/ProviderFactory.js';
import { TranslationBenchmark } from '../benchmark/TranslationBenchmark.js';
import { SegmentValidator } from '../validation/SegmentValidator.js';
import { getAllLanguages } from '../languages/languageRegistry.js';
import { getAllDomains } from '../domains/domainRegistry.js';
import { config } from '../config/index.js';
import { logger } from '../config/logger.js';
import type { TranslationJobStatus, PipelineProfilerMetrics, TranslationDomain, OutputFormat, TranslationType } from '../types/index.js';
import type { AIProviderName } from '../translation/TranslationProvider.js';

const SUPPORTED_PROVIDERS: readonly AIProviderName[] = ['gemini', 'groq', 'mistral', 'openrouter'];
const SUPPORTED_OUTPUT_FORMATS = new Set<OutputFormat>(['translation-only', 'bilingual']);

const translationPipeline = new TranslationPipeline();
const translationBenchmark = new TranslationBenchmark();
const segmentValidator = new SegmentValidator();
const LEGACY_DOMAINS = new Set(['general', 'medical', 'legal']);

function normalizeTranslationDomain(domain?: string): TranslationDomain {
  return domain && LEGACY_DOMAINS.has(domain) ? (domain as TranslationDomain) : 'universal';
}

export const getLanguages = (_req: Request, res: Response): void => {
  const languages = getAllLanguages();
  res.json({ languages });
};

export const getDomains = (_req: Request, res: Response): void => {
  const domains = getAllDomains();
  res.json({ domains });
};

export const translateFile = async (req: Request, res: Response): Promise<void> => {
  const jobId = uuidv4();
  const tJobStart = Date.now();

  try {
    // Validate uploaded file
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'No file uploaded. Please provide a .mqxliff, .xliff, or .docx file.' });
      return;
    }

    // Validate request body
    const { sourceLanguage, targetLanguage, domain, aiProvider, model, outputFormat, translationType, customInstructions } = req.body as {
      sourceLanguage?: string;
      targetLanguage?: string;
      domain?: string;
      aiProvider?: AIProviderName;
      model?: string;
      outputFormat?: string;
      translationType?: string;
      customInstructions?: string;
    };
    const selectedModel = typeof model === 'string' && model.trim() ? model.trim() : undefined;
    const selectedTranslationType: TranslationType = translationType === 'chat-bilingual' ? 'chat-bilingual' : 'standard';
    const selectedCustomInstructions = typeof customInstructions === 'string' && customInstructions.trim() ? customInstructions.trim() : undefined;

    if (!sourceLanguage) {
      res.status(400).json({ error: 'sourceLanguage is required.' });
      return;
    }
    if (!targetLanguage) {
      res.status(400).json({ error: 'targetLanguage is required.' });
      return;
    }

    // Output format defaults to 'translation-only' for backward compatibility.
    // Chat translation mode automatically forces 'bilingual' output format.
    let selectedOutputFormat: OutputFormat = selectedTranslationType === 'chat-bilingual' ? 'bilingual' : 'translation-only';
    if (selectedTranslationType !== 'chat-bilingual' && outputFormat !== undefined && outputFormat !== '') {
      if (!SUPPORTED_OUTPUT_FORMATS.has(outputFormat as OutputFormat)) {
        res.status(400).json({
          error: `Unsupported outputFormat: ${outputFormat}. Expected "translation-only" or "bilingual".`,
        });
        return;
      }
      selectedOutputFormat = outputFormat as OutputFormat;
    }

    const translationDomain = normalizeTranslationDomain(domain);

    const activeProviderName = aiProvider ?? config.provider;
    if (!SUPPORTED_PROVIDERS.includes(activeProviderName as AIProviderName)) {
      res.status(400).json({ error: `Unsupported AI provider: ${activeProviderName}.` });
      return;
    }
    const providerConfigurationError = ProviderFactory.getConfigurationError(activeProviderName as AIProviderName);
    if (providerConfigurationError) {
      res.status(400).json({ error: providerConfigurationError });
      return;
    }

    logger.info(`[Controller] Translation job started`, {
      jobId,
      sourceLanguage,
      targetLanguage,
      domain: translationDomain,
      requestedDomain: domain,
      aiProvider: activeProviderName,
      model: selectedModel,
      outputFormat: selectedOutputFormat,
      originalName: file.originalname,
    });

    // 1. Resolve DocumentAdapter and parse document (Measure Parsing & Segmentation time)
    const tParseStart = Date.now();
    const adapter = AdapterFactory.getAdapter(file.originalname);
    const fileBuffer = file.buffer;

    const doc = await adapter.parse(fileBuffer, file.originalname);
    const tParseMs = Date.now() - tParseStart;

    const outputFileName = generateOutputFileName(file.originalname, targetLanguage, selectedOutputFormat);
    const outputFilePath = path.join(
      config.storage.outputsDir,
      `${jobId}_${outputFileName}`
    );

    // 2. Run translation pipeline (Measure Provider & Batch API metrics)
    const progressUpdates: TranslationJobStatus[] = [];
    const pipelineRun = await translationPipeline.runWithMetrics(
      {
        sourceLanguage,
        targetLanguage,
        domain: translationDomain,
        segments: doc.segments,
        jobId,
        providerName: activeProviderName as AIProviderName,
        modelName: selectedModel,
        translationType: selectedTranslationType,
        customInstructions: selectedCustomInstructions,
      },
      (status) => {
        progressUpdates.push(status);
      }
    );

    const results = pipelineRun.results;
    const pMetrics = pipelineRun.metrics;
    // Real parse vs. extraction split from the DOCX adapter when available;
    // otherwise keep the full parse time under tParsingMs.
    const docxCtx = doc.formatContext as { parsingMs?: number; extractionMs?: number } | undefined;
    if (docxCtx?.parsingMs !== undefined && docxCtx?.extractionMs !== undefined) {
      pMetrics.tParsingMs = docxCtx.parsingMs;
      pMetrics.tSegmentationMs = docxCtx.extractionMs;
    } else {
      pMetrics.tParsingMs = tParseMs;
      pMetrics.tSegmentationMs = 0;
    }

    // 3. Validate translation results (Measure Validation time)
    //    The pipeline already ran the per-segment multilingual completeness
    //    check, so skip re-running it here to avoid duplicated work on large
    //    documents. All aggregate checks (count, IDs, emptiness, tags,
    //    entities, numbers) still run.
    const tValStart = Date.now();
    const validationReport = segmentValidator.validate(
      doc.segments,
      results,
      sourceLanguage,
      targetLanguage,
      { skipCompletenessCheck: true }
    );
    pMetrics.tValidationMs += (Date.now() - tValStart);

    // 4. Resolve OutputGenerator and build translated file (Measure Output Generation time)
    const tOutStart = Date.now();
    const outputGenerator = OutputGeneratorFactory.getOutputGenerator(doc.sourceFormat);
    const outputResult = await outputGenerator.generate(
      doc,
      results,
      validationReport,
      outputFilePath,
      {
        outputFormat: selectedOutputFormat,
        sourceLanguage,
        targetLanguage,
      }
    );
    pMetrics.tOutputGenerationMs = Date.now() - tOutStart;
    pMetrics.tTotalMs = Date.now() - tJobStart;

    // Log structured performance breakdown
    logPerformanceBreakdown(jobId, pMetrics);

    // No file cleanup needed since we use multer.memoryStorage

    const completedCount = results.filter((r) => r.status === 'completed').length;
    const failedCount = results.filter((r) => r.status === 'failed').length;
    const skippedCount = results.filter((r) => r.status === 'skipped').length;

    if (!outputResult.success) {
      res.status(500).json({
        jobId,
        success: false,
        sourceFormat: doc.sourceFormat,
        error: outputResult.errorMessage,
        totalSegments: doc.segments.length,
        completed: completedCount,
        failed: failedCount,
        validationReport,
        profilerMetrics: pMetrics,
      });
      return;
    }

    // Load the generated output file into memory as base64 for Vercel
    let downloadData: string | undefined = undefined;
    try {
      const outBuf = fs.readFileSync(outputFilePath);
      downloadData = outBuf.toString('base64');
    } catch {
      logger.warn(`[Controller] Failed to read output file to base64 for job ${jobId}`);
    }

    res.json({
      jobId,
      success: true,
      sourceFormat: doc.sourceFormat,
      totalSegments: doc.segments.length,
      completed: completedCount,
      failed: failedCount,
      skipped: skippedCount,
      validationReport,
      downloadUrl: `/api/download/${jobId}`,
      downloadData,
      outputFileName,
      failedSegments: validationReport.failedSegments,
      profilerMetrics: pMetrics,
    });
  } catch (err) {
    const message = (err as Error).message ?? 'Unexpected error';
    logger.error(`[Controller] Job failed`, { jobId, error: message });

    res.status(500).json({
      jobId,
      success: false,
      error: message,
    });
  }
};

export const downloadFile = (req: Request, res: Response): void => {
  const rawJobId = req.params['jobId'];
  const jobId = Array.isArray(rawJobId) ? rawJobId[0] : rawJobId;

  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!jobId || !uuidPattern.test(jobId)) {
    res.status(400).json({ error: 'Invalid job ID.' });
    return;
  }

  const outputsDir = config.storage.outputsDir;
  const files = fs.readdirSync(outputsDir);
  // Files are stored as: <jobId>_<outputFileName>  e.g. abc123_Hello_tamil.docx
  const matchingFile = files.find((f) => f.startsWith(`${jobId}_`));

  if (!matchingFile) {
    res.status(404).json({ error: 'Output file not found. The job may have failed or expired.' });
    return;
  }

  const outputFilePath = path.join(outputsDir, matchingFile);
  const ext = path.extname(matchingFile).toLowerCase();
  // Strip the jobId prefix to recover the original output filename
  const downloadName = matchingFile.slice(jobId.length + 1); // e.g. 'Hello_tamil.docx'

  let contentType = 'application/octet-stream';
  if (ext === '.docx') {
    contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  } else if (ext === '.mqxliff' || ext === '.xliff' || ext === '.xml') {
    contentType = 'application/xml';
  }

  res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
  res.setHeader('Content-Type', contentType);
  res.sendFile(outputFilePath);
};

export const runBenchmark = async (req: Request, res: Response): Promise<void> => {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'No file uploaded. Please provide a document for benchmark testing.' });
      return;
    }

    const { sourceLanguage, targetLanguage, domain } = req.body as {
      sourceLanguage?: string;
      targetLanguage?: string;
      domain?: string;
    };

    if (!sourceLanguage || !targetLanguage) {
      res.status(400).json({ error: 'sourceLanguage and targetLanguage are required for benchmarking.' });
      return;
    }
    const translationDomain = normalizeTranslationDomain(domain);

    const adapter = AdapterFactory.getAdapter(file.originalname);
    const fileBuffer = file.buffer;
    const doc = await adapter.parse(fileBuffer, file.originalname);

    // Clean up uploaded test file
    // No file cleanup needed since we use multer.memoryStorage

    const report = await translationBenchmark.compare(
      doc,
      sourceLanguage,
      targetLanguage,
      translationDomain
    );

    res.json(report);
  } catch (err) {
    const message = (err as Error).message ?? 'Benchmark execution error';
    logger.error(`[Controller] Benchmark failed`, { error: message });
    res.status(500).json({ error: message });
  }
};

function logPerformanceBreakdown(jobId: string, m: PipelineProfilerMetrics): void {
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

  console.log('\n========== TRANSLATION PERFORMANCE ==========');
  console.log(`Total time:              ${m.tTotalMs} ms`);
  console.log(`DOCX parsing:            ${m.tParsingMs} ms`);
  console.log(`Segment processing:      ${segmentProcessingMs} ms`);
  console.log(`AI waiting/request time: ${aiWaitRequestMs} ms`);
  console.log(`Validation:              ${m.tValidationMs} ms`);
  console.log(`DOCX generation:         ${m.tOutputGenerationMs} ms`);
  console.log(`Number of AI requests:   ${m.geminiRequests}`);
  console.log(`Successful requests:     ${m.successfulRequests}`);
  console.log(`HTTP 429 responses:      ${m.rateLimitedRequests}`);
  console.log(`Rate-limited batches:    ${m.rateLimitedBatches}`);
  console.log(`Batch fallbacks:         ${m.batchFallbackCount}`);
  console.log(`Batch rate-limit retries:${m.batchRateLimitRetries}`);
  console.log(`Corrective requests:     ${m.correctiveRequests ?? 0}`);
  console.log(`Segments corrected:      ${m.segmentsCorrected ?? 0}`);
  console.log(`Corrective AI time:      ${m.tCorrectiveAiMs ?? 0} ms`);
  console.log(`Total input tokens:      ${m.totalInputTokens}`);
  console.log(`Total output tokens:     ${m.totalOutputTokens}`);
  console.log(`Retries:                 ${m.totalRetries}`);
  console.log('==============================================');

  console.log('============================================================');
  console.log(`[PROFILER REPORT] Translation Job ${jobId}`);
  console.log('============================================================');
  console.log(`Parsing:              ${m.tParsingMs} ms`);
  console.log(`Segmentation:         ${m.tSegmentationMs} ms`);
  console.log(`Glossary:             ${m.tGlossaryMs} ms`);
  console.log(`Language filter:      ${m.tLanguageFilterMs} ms`);
  console.log(`Protection:           ${m.tProtectionMs} ms`);
  console.log(`Prompt construction:  ${m.tPromptBuildMs} ms`);
  console.log(`Queue/wait:           ${m.tQueueWaitMs} ms`);
  console.log(`AI API processing:    ${m.tGeminiApiMs} ms`);
  console.log(`Retry backoff:        ${m.tRetryWaitMs} ms`);
  console.log(`Rate-limit wait:      ${m.tRateLimitWaitMs} ms`);
  console.log(`Validation:           ${m.tValidationMs} ms`);
  console.log(`Placeholder restore:  ${m.tRestoreMs} ms`);
  console.log(`Output generation:    ${m.tOutputGenerationMs} ms`);
  console.log(`Total:                ${m.tTotalMs} ms`);
  console.log('------------------------------------------------------------');
  console.log(`Number of segments:      ${m.totalSegments}`);
  console.log(`Segments skipped:        ${m.skippedSegments}`);
  console.log(`Cache hits (deduped):    ${m.cacheHits ?? 0}`);
  console.log(`Number of Gemini calls:  ${m.geminiRequests}`);
  console.log(`Number of retries:       ${m.totalRetries}`);
  console.log(`Average batch size:      ${m.avgBatchSize}`);
  console.log(`Token budget/request:    ${m.maxBatchTokens}`);
  console.log(`Input tokens:            ${m.totalInputTokens}`);
  console.log(`Output tokens:           ${m.totalOutputTokens}`);
  console.log(`Average Gemini time:     ${m.avgGeminiTimeMs} ms`);
  console.log(`Maximum Gemini time:     ${m.maxGeminiTimeMs} ms`);
  console.log(`Concurrency:             ${m.concurrency}`);
  console.log(`Max batch size:          ${m.batchSize}`);
  console.log('============================================================\n');
}
