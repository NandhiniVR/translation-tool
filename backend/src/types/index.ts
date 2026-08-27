/**
 * Core shared types for the Translation Tool.
 *
 * These types form the contract between all modules in the pipeline.
 * Changing these types requires updating all downstream consumers.
 */

// ---------------------------------------------------------------------------
// Segment types
// ---------------------------------------------------------------------------

export type SegmentStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'skipped';

/**
 * Represents a single translatable unit extracted from a MemoQ/XLIFF file.
 * The `sourceRaw` and `targetRaw` fields contain the inner XML of <source>/<target>
 * elements (including any inline tags). The `sourceText` field is the plain-text
 * version used for context and display purposes.
 */
export interface TranslationSegment {
  /** Unique segment ID from the XLIFF trans-unit id attribute */
  id: string;
  /** Zero-based position in the document */
  index: number;
  /** Inner XML content of the <source> element (may contain inline tags) */
  sourceRaw: string;
  /** Plain text extracted from source (tags stripped) for context/display */
  sourceText: string;
  /** Inner XML content of the <target> element, if already present */
  targetRaw?: string;
  /** Plain text of existing target, if present */
  targetText?: string;
  /** Current translation status */
  status: SegmentStatus;
  /** Error message if status === 'failed' */
  errorMessage?: string;
  /** MemoQ-specific attributes preserved from the trans-unit */
  attributes?: Record<string, string>;
}

/**
 * The result of translating a single segment.
 */
export interface TranslationResult {
  segmentId: string;
  segmentIndex: number;
  translatedText: string;
  translatedRaw: string;
  status: SegmentStatus;
  errorMessage?: string;
  validationWarnings: string[];
}

// ---------------------------------------------------------------------------
// Translation request / job types
// ---------------------------------------------------------------------------

export type TranslationType = 'standard' | 'chat-bilingual';

export interface TranslationRequest {
  /** Unique job ID, generated server-side */
  jobId: string;
  sourceLanguage: string;
  targetLanguage: string;
  domain?: TranslationDomain;
  inputFilePath: string;
  outputFilePath: string;
  /** How the translated result is presented in the output document */
  outputFormat?: OutputFormat;
  translationType?: TranslationType;
  customInstructions?: string;
}

export interface PipelineProfilerMetrics {
  /** DOCX/XLIFF parsing time (zip unpack + XML parse) */
  tParsingMs: number;
  /** Segment extraction from the parsed document */
  tSegmentationMs: number;
  /** Glossary lookup time */
  tGlossaryMs: number;
  /** Language/segment filtering time (identifying source-language segments) */
  tLanguageFilterMs: number;
  /** Placeholder/tag/entity protection time */
  tProtectionMs: number;
  /** Prompt construction time (system + user prompts) */
  tPromptBuildMs: number;
  /** Time batches spend waiting for a concurrency slot / between windows */
  tQueueWaitMs: number;
  /** Pure AI API request time (excluding retry backoff) — summed across concurrent requests */
  tGeminiApiMs: number;
  /**
   * Wall-clock span from the first AI request start to the last AI request
   * end (includes concurrency overlap, inter-window queue wait, and retry
   * backoff). Unlike tGeminiApiMs it is bounded by the total time even when
   * requests run concurrently. Optional for backward compatibility.
   */
  tAiElapsedMs?: number;
  /** Time spent sleeping in retry backoff (transient errors only) */
  tRetryWaitMs: number;
  /** Time spent sleeping due to HTTP 429 responses (Retry-After / backoff) */
  tRateLimitWaitMs: number;
  /** Validation time (completeness checks) */
  tValidationMs: number;
  /** Placeholder restoration time */
  tRestoreMs: number;
  /** Output document generation time */
  tOutputGenerationMs: number;
  tTotalMs: number;
  totalSegments: number;
  /** Segments skipped because they were written in a language other than the source language */
  skippedSegments: number;
  /** Segments populated directly from the in-memory duplicate segment cache */
  cacheHits?: number;
  geminiRequests: number;
  /** Requests (translate calls) that returned a successful response */
  successfulRequests: number;
  /** Total HTTP 429 responses seen across all requests (including retries) */
  rateLimitedRequests: number;
  /** Batches that failed after exhausting their rate-limit retry budget */
  rateLimitedBatches: number;
  /** Batches that fell back to individual segment requests (genuine failures only) */
  batchFallbackCount: number;
  /** Pipeline-level retries where a 429-limited batch was re-queued (same batch) */
  batchRateLimitRetries: number;
  totalRetries: number;
  avgGeminiTimeMs: number;
  maxGeminiTimeMs: number;
  /** Actual average segments per API request */
  avgBatchSize: number;
  concurrency: number;
  /** Configured maximum segments per batch (token-aware batching may use fewer) */
  batchSize: number;
  /** Token budget per API request (0 = disabled) */
  maxBatchTokens: number;
  /** Total input tokens consumed across all requests (0 when provider does not report usage) */
  totalInputTokens: number;
  /** Total output tokens produced across all requests (0 when provider does not report usage) */
  totalOutputTokens: number;
  /**
   * AI requests issued by the secondary corrective pass (only segments that
   * failed validation/completeness re-requested). Excludes rate-limit and
   * generic API error retries.
   */
  correctiveRequests: number;
  /** Segments that entered the corrective pass (validation failures) */
  segmentsCorrected: number;
  /** Summed AI request duration of corrective requests (concurrent overlap possible) */
  tCorrectiveAiMs: number;
}

export interface TranslationJobStatus {
  jobId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  totalSegments: number;
  completedSegments: number;
  failedSegments: number;
  skippedSegments: number;
  currentSegmentIndex?: number;
  currentBatch?: number;
  totalBatches?: number;
  batchSize?: number;
  errors: SegmentError[];
  outputFilePath?: string;
  startedAt?: string;
  completedAt?: string;
  profilerMetrics?: PipelineProfilerMetrics;
}

export interface SegmentError {
  segmentId: string;
  segmentIndex: number;
  errorType: 'api_error' | 'validation_error' | 'tag_error' | 'entity_error' | 'timeout' | 'unknown';
  message: string;
}

// ---------------------------------------------------------------------------
// Language types
// ---------------------------------------------------------------------------

export interface LanguageConfig {
  /** BCP-47 language code e.g. "en", "hi", "ur" */
  code: string;
  /** English name e.g. "Hindi" */
  name: string;
  /** Name in the target script e.g. "हिन्दी" */
  nativeName?: string;
  /** Text direction */
  direction: 'ltr' | 'rtl';
  /**
   * Optional verified language-specific rules to inject into the prompt.
   * Only add rules that are confirmed to improve translation quality.
   * Do not add speculative rules.
   */
  rules?: string[];
}

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export type TranslationDomain = 'universal' | 'general' | 'medical' | 'legal';

export interface DomainConfig {
  code: TranslationDomain;
  name: string;
  /** Instructions injected into the Gemini translation prompt */
  promptInstructions: string;
}

// ---------------------------------------------------------------------------
// Glossary types
// ---------------------------------------------------------------------------

export interface GlossaryTerm {
  /** The source-language term */
  sourceTerm: string;
  /** BCP-47 code of the source language */
  sourceLanguage: string;
  /** BCP-47 code of the target language */
  targetLanguage: string;
  /** The preferred translation for this term */
  preferredTranslation: string;
  /** Optional domain restriction — if omitted, applies to all domains */
  domain?: Exclude<TranslationDomain, 'universal'>;
  /** Optional explanatory note */
  note?: string;
}

// ---------------------------------------------------------------------------
// Protection types
// ---------------------------------------------------------------------------

/**
 * A placeholder that was substituted into the source text before translation.
 * The `token` is sent to Gemini; the `original` is restored afterward.
 */
export interface ProtectedToken {
  token: string;
  original: string;
  type: 'tag' | 'entity';
}

export interface ProtectionResult {
  protectedText: string;
  tokens: ProtectedToken[];
}

// ---------------------------------------------------------------------------
// Context types
// ---------------------------------------------------------------------------

export interface SegmentContext {
  previousText: string;
  currentText: string;
  nextText: string;
}

// ---------------------------------------------------------------------------
// Prompt builder input
// ---------------------------------------------------------------------------

export interface BatchSegmentInputItem {
  id: string;
  previousText?: string;
  sourceText: string;
  nextText?: string;
}

export interface BatchPromptInput {
  sourceLanguage: string;
  targetLanguage: string;
  domain?: TranslationDomain;
  items: BatchSegmentInputItem[];
  glossaryTerms: GlossaryTerm[];
  languageRules: string[];
  domainInstructions: string;
  translationType?: TranslationType;
  customInstructions?: string;
}

export interface PromptInput {
  sourceLanguage: string;
  targetLanguage: string;
  domain?: TranslationDomain;
  context: SegmentContext;
  protectedText: string;
  glossaryTerms: GlossaryTerm[];
  languageRules: string[];
  domainInstructions: string;
  translationType?: TranslationType;
  customInstructions?: string;
}

// ---------------------------------------------------------------------------
// Document types & Adapters
// ---------------------------------------------------------------------------

export type SupportedFormat = 'mqxliff' | 'xliff' | 'docx';

export interface TranslationDocument {
  id: string;
  sourceFormat: SupportedFormat;
  originalFileName: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  segments: TranslationSegment[];
  /** Format-specific opaque payload needed for output reconstruction */
  formatContext: unknown;
}

export interface ParsedDocument {
  /** The original raw XML content — kept for output regeneration */
  originalXml: string;
  /** Extracted segments */
  segments: TranslationSegment[];
  /** XLIFF version detected */
  xliffVersion?: string;
  /** Source language declared in the file, if any */
  declaredSourceLanguage?: string;
  /** Target language declared in the file, if any */
  declaredTargetLanguage?: string;
}

// ---------------------------------------------------------------------------
// Validation types
// ---------------------------------------------------------------------------

export interface ValidationReport {
  valid: boolean;
  segmentCountMatch: boolean;
  allSegmentsPresent: boolean;
  failedSegments: SegmentError[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

/**
 * How the translated result is presented in the output document.
 * - 'translation-only': output contains only the translated content (existing behavior)
 * - 'bilingual': output pairs each original segment with its translation side-by-side
 */
export type OutputFormat = 'translation-only' | 'bilingual';

/**
 * Options passed to DocumentOutputGenerator.generate.
 * `outputFormat` controls the presentation; `sourceLanguage`/`targetLanguage`
 * are forwarded so generators can apply script/directionality handling.
 */
export interface OutputGenerateOptions {
  outputFormat?: OutputFormat;
  sourceLanguage?: string;
  targetLanguage?: string;
}

export interface OutputResult {
  success: boolean;
  outputFilePath: string;
  validationReport: ValidationReport;
  errorMessage?: string;
}
