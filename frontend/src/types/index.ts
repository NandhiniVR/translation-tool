export interface Language {
  code: string;
  name: string;
  nativeName?: string;
  direction: 'ltr' | 'rtl';
}

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
  };
}
