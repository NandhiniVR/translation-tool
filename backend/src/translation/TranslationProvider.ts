export type AIProviderName = 'gemini' | 'groq' | 'mistral' | 'openrouter';

export interface ProviderResponse {
  text: string;
  wasRetried: boolean;
  retryCount: number;
  /** Total wall time of the request including retry backoff (ms) */
  latencyMs: number;
  /** Time spent sleeping in retry backoff (ms) */
  retryWaitMs?: number;
  /** How many HTTP 429 rate-limit responses this request hit before succeeding */
  rateLimitCount?: number;
  /** Time slept due to HTTP 429 responses (Retry-After / backoff), ms */
  rateLimitWaitMs?: number;
  /** Token usage reported by the provider, when available */
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
  model: string;
  provider: AIProviderName;
}

/**
 * A provider error that will NEVER succeed on retry — e.g. invalid API key,
 * insufficient balance, unsupported model, or authentication failure.
 *
 * The pipeline fails fast on these instead of wasting requests on individual
 * segment fallbacks or corrective retries.
 */
export class PermanentProviderError extends Error {
  /** HTTP status code when the provider surfaced one, otherwise undefined. */
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'PermanentProviderError';
    this.status = status;
  }
}

/**
 * Thrown by a provider when an HTTP 429 rate limit persisted across every
 * retry attempt (Retry-After-aware backoff was already applied).
 *
 * The pipeline treats this differently from a generic batch failure: it must
 * NOT fall back to individual segment requests (that would multiply the load
 * into a request storm). The batch is marked failed and the error surfaces
 * with the request count it actually took.
 */
export class RateLimitExhaustedError extends Error {
  /** HTTP status code (429) */
  readonly status: number;
  /** How many HTTP 429 responses were seen before giving up */
  readonly rateLimitCount: number;
  /** Time spent sleeping on Retry-After / backoff for those 429s, ms */
  readonly rateLimitWaitMs: number;

  constructor(message: string, rateLimitCount: number, rateLimitWaitMs: number, status = 429) {
    super(message);
    this.name = 'RateLimitExhaustedError';
    this.status = status;
    this.rateLimitCount = rateLimitCount;
    this.rateLimitWaitMs = rateLimitWaitMs;
  }
}

/**
 * TranslationProvider Interface
 *
 * Abstract contract implemented by AI providers (GeminiProvider, GroqProvider).
 * Enforces uniform input parameters, retry mechanisms, and response formatting.
 */
export interface TranslationProvider {
  readonly providerName: AIProviderName;
  readonly modelName: string;

  /**
   * Sends system and user prompts to the AI provider.
   *
   * @param systemPrompt - Instructions and task rules
   * @param userPrompt - Structured JSON input or segment text
   * @param options - Config options e.g. jsonMode
   * @returns Standardized ProviderResponse
   */
  translate(
    systemPrompt: string,
    userPrompt: string,
    options?: { jsonMode?: boolean }
  ): Promise<ProviderResponse>;
}
