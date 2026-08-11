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
import type { TranslationJobStatus, PipelineProfilerMetrics, TranslationDomain } from '../types/index.js';
import type { AIProviderName } from '../translation/TranslationProvider.js';

const SUPPORTED_PROVIDERS: readonly AIProviderName[] = ['gemini', 'groq', 'mistral', 'openrouter'];

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
    const { sourceLanguage, targetLanguage, domain, aiProvider, model } = req.body as {
      sourceLanguage?: string;
      targetLanguage?: string;
      domain?: string;
      aiProvider?: AIProviderName;
      model?: string;
    };
    const selectedModel = typeof model === 'string' && model.trim() ? model.trim() : undefined;

    if (!sourceLanguage) {
      res.status(400).json({ error: 'sourceLanguage is required.' });
      return;
    }
    if (!targetLanguage) {
      res.status(400).json({ error: 'targetLanguage is required.' });
      return;
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
      originalName: file.originalname,
    });

    // 1. Resolve DocumentAdapter and parse document (Measure Parsing & Segmentation time)
    const tParseStart = Date.now();
    const adapter = AdapterFactory.getAdapter(file.originalname);
    const fileBuffer = file.buffer;

    const doc = await adapter.parse(fileBuffer, file.originalname);
    const tParseMs = Date.now() - tParseStart;

    const outputFileName = generateOutputFileName(file.originalname, targetLanguage);
    const outputFilePath = path.join(
      config.storage.outputsDir,
      `${jobId}_${outputFileName}`
    );

    // 2. Run common translation pipeline with metrics
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
      },
      (status) => {
        progressUpdates.push(status);
      }
    );

    const results = pipelineRun.results;
    const pMetrics = pipelineRun.metrics;
    pMetrics.tParsingMs = tParseMs;
    pMetrics.tSegmentationMs = Math.round(tParseMs * 0.3); // Portion of parsing spent indexing segments

    // 3. Validate translation results (Measure Validation time)
    const tValStart = Date.now();
    const validationReport = segmentValidator.validate(
      doc.segments,
      results,
      sourceLanguage,
      targetLanguage
    );
    pMetrics.tValidationMs += (Date.now() - tValStart);

    // 4. Resolve OutputGenerator and build translated file (Measure Output Generation time)
    const tOutStart = Date.now();
    const outputGenerator = OutputGeneratorFactory.getOutputGenerator(doc.sourceFormat);
    const outputResult = await outputGenerator.generate(
      doc,
      results,
      validationReport,
      outputFilePath
    );
    pMetrics.tOutputGenerationMs = Date.now() - tOutStart;
    pMetrics.tTotalMs = Date.now() - tJobStart;

    // Log structured performance breakdown
    logPerformanceBreakdown(jobId, pMetrics);

    // No file cleanup needed since we use multer.memoryStorage

    const completedCount = results.filter((r) => r.status === 'completed').length;
    const failedCount = results.filter((r) => r.status === 'failed').length;

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
  console.log('\n============================================================');
  console.log(`[PROFILER REPORT] Translation Job ${jobId}`);
  console.log('============================================================');
  console.log(`Parsing:              ${m.tParsingMs} ms`);
  console.log(`Segmentation:         ${m.tSegmentationMs} ms`);
  console.log(`Glossary:             ${m.tGlossaryMs} ms`);
  console.log(`Protection:           ${m.tProtectionMs} ms`);
  console.log(`Gemini API:           ${m.tGeminiApiMs} ms`);
  console.log(`Validation:           ${m.tValidationMs} ms`);
  console.log(`Output generation:    ${m.tOutputGenerationMs} ms`);
  console.log(`Total:                ${m.tTotalMs} ms`);
  console.log('------------------------------------------------------------');
  console.log(`Number of segments:      ${m.totalSegments}`);
  console.log(`Number of Gemini calls:  ${m.geminiRequests}`);
  console.log(`Number of retries:       ${m.totalRetries}`);
  console.log(`Average Gemini time:     ${m.avgGeminiTimeMs} ms`);
  console.log(`Maximum Gemini time:     ${m.maxGeminiTimeMs} ms`);
  console.log(`Concurrency:             ${m.concurrency}`);
  console.log(`Batch size:              ${m.batchSize}`);
  console.log('============================================================\n');
}
