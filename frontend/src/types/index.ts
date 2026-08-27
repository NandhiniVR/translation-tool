export interface Language {
  code: string;
  name: string;
  nativeName?: string;
  direction: 'ltr' | 'rtl';
}

/**
 * How the translated result is presented in the output document.
 * - 'translation-only': output contains only the translated content
 * - 'bilingual': output pairs each original segment with its translation side-by-side
 */
export type OutputFormat = 'translation-only' | 'bilingual';

export type TranslationType = 'standard' | 'chat-bilingual';

export interface SegmentError {
  segmentId: string;
  segmentIndex: number;
  errorType: 'api_error' | 'validation_error' | 'tag_error' | 'entity_error' | 'timeout' | 'unknown';
  message: string;
}

export interface ValidationReport {
  valid: boolean;
  segmentCountMatch: boolean;
  allSegmentsPresent: boolean;
  failedSegments: SegmentError[];
  warnings: string[];
}

export interface TranslationResponse {
  jobId: string;
  success: boolean;
  sourceFormat?: 'mqxliff' | 'xliff' | 'docx';
  totalSegments: number;
  completed: number;
  failed: number;
  /** Segments written in another language, passed through unchanged */
  skipped?: number;
  validationReport: ValidationReport;
  downloadUrl?: string;
  downloadData?: string;
  outputFileName?: string;
  failedSegments?: SegmentError[];
  error?: string;
  profilerMetrics?: {
    tParsingMs: number;
    tSegmentationMs: number;
    tGlossaryMs: number;
    tLanguageFilterMs: number;
    tProtectionMs: number;
    tPromptBuildMs: number;
    tQueueWaitMs: number;
    tGeminiApiMs: number;
    tRetryWaitMs: number;
    tValidationMs: number;
    tRestoreMs: number;
    tOutputGenerationMs: number;
    tTotalMs: number;
    totalSegments: number;
    skippedSegments: number;
    geminiRequests: number;
    totalRetries: number;
    avgGeminiTimeMs: number;
    maxGeminiTimeMs: number;
    avgBatchSize: number;
    concurrency: number;
    batchSize: number;
    maxBatchTokens: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    correctiveRequests?: number;
    segmentsCorrected?: number;
    tCorrectiveAiMs?: number;
  };
}
