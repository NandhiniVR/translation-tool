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

export interface TranslationRequest {
  /** Unique job ID, generated server-side */
  jobId: string;
  sourceLanguage: string;
  targetLanguage: string;
  domain: 'general' | 'medical' | 'legal';
  inputFilePath: string;
  outputFilePath: string;
}

export interface PipelineProfilerMetrics {
  tParsingMs: number;
  tSegmentationMs: number;
  tGlossaryMs: number;
  tProtectionMs: number;
  tGeminiApiMs: number;
  tValidationMs: number;
  tOutputGenerationMs: number;
  tTotalMs: number;
  totalSegments: number;
  geminiRequests: number;
  totalRetries: number;
  avgGeminiTimeMs: number;
  maxGeminiTimeMs: number;
  concurrency: number;
  batchSize: number;
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

export interface DomainConfig {
  code: 'general' | 'medical' | 'legal';
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
  domain?: 'general' | 'medical' | 'legal';
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
  domain: 'general' | 'medical' | 'legal';
  items: BatchSegmentInputItem[];
  glossaryTerms: GlossaryTerm[];
  languageRules: string[];
  domainInstructions: string;
}

export interface PromptInput {
  sourceLanguage: string;
  targetLanguage: string;
  domain: 'general' | 'medical' | 'legal';
  context: SegmentContext;
  protectedText: string;
  glossaryTerms: GlossaryTerm[];
  languageRules: string[];
  domainInstructions: string;
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

export interface OutputResult {
  success: boolean;
  outputFilePath: string;
  validationReport: ValidationReport;
  errorMessage?: string;
}
