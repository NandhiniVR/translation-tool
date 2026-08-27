import { config } from '../config/index.js';
import { logger } from '../config/logger.js';
import { PermanentProviderError, RateLimitExhaustedError } from './TranslationProvider.js';
import type { AIProviderName, ProviderResponse, TranslationProvider } from './TranslationProvider.js';

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
/** Errors that will never succeed on retry: auth, balance, unknown model, validation. */
const PERMANENT_STATUS_CODES = new Set([401, 402, 403, 404, 422]);
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30000;

/** API key environment variable for each chat-completions provider. */
export const PROVIDER_ENV_VARS: Record<ChatCompletionsProviderName, string> = {
  mistral: 'MISTRAL_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
};

export type ChatCompletionsProviderName = Extract<AIProviderName, 'mistral' | 'openrouter'>;

type CompatibleProviderConfig = {
  apiKey: string;
  model: string;
  baseUrl: string;
  maxRetries: number;
  /** Extra retry budget for HTTP 429 responses (Retry-After-aware backoff) */
  rateLimitMaxRetries?: number;
  /** Provider-wide cap on concurrent in-flight requests (semaphore) */
  maxConcurrent?: number;
};

/**
 * Shared adapter for chat-completions style APIs (Mistral, OpenRouter).
 *
 * Both providers expose `/chat/completions` style endpoints, so a single
 * fetch-based implementation covers them. The adapter follows the same
 * retry/error contract as the Gemini and Groq providers, plus provider-aware
 * rate limiting:
 *
 *   - HTTP 429 responses are retried with the server's Retry-After header when
 *     present (falling back to exponential backoff), always with jitter, for a
 *     dedicated rate-limit budget (rateLimitMaxRetries). Exhausting that budget
 *     throws RateLimitExhaustedError so the pipeline can fail the batch instead
 *     of spawning an individual-request storm.
 *   - All other transient errors (5xx, network) use the normal maxRetries
 *     budget with jittered exponential backoff.
 *   - A provider-wide semaphore caps concurrent in-flight requests across all
 *     jobs in the process, keeping total load within the account's safe limit.
 *   - Fails fast on auth/validation errors so the API's message surfaces clearly.
 */
export class ChatCompletionsProvider implements TranslationProvider {
  readonly modelName: string;

  constructor(
    readonly providerName: ChatCompletionsProviderName,
    private readonly providerConfig: CompatibleProviderConfig,
    overrideModel?: string
  ) {
    this.modelName = overrideModel?.trim() ? overrideModel.trim() : providerConfig.model;
  }

  async translate(
    systemPrompt: string,
    userPrompt: string,
    options?: { jsonMode?: boolean }
  ): Promise<ProviderResponse> {
    if (!this.providerConfig.apiKey) {
      throw new ProviderConfigurationError(
        `${this.providerName} is not configured. Set ${PROVIDER_ENV_VARS[this.providerName]} before selecting it.`
      );
    }

    // Bound concurrent in-flight requests for this provider (shared across all
    // jobs in the process). The slot is held across retries: while a request is
    // waiting out a Retry-After backoff, it still counts toward the in-flight
    // cap, which is exactly the load the provider's safe limit describes.
    const semaphore = getSemaphore(this.providerName, this.providerConfig.maxConcurrent ?? 4);
    await semaphore.acquire();
    try {
      return await this.translateWithRetries(systemPrompt, userPrompt, options);
    } finally {
      semaphore.release();
    }
  }

  private async translateWithRetries(
    systemPrompt: string,
    userPrompt: string,
    options?: { jsonMode?: boolean }
  ): Promise<ProviderResponse> {
    const maxRetries = this.providerConfig.maxRetries;
    const rateLimitMaxRetries = this.providerConfig.rateLimitMaxRetries ?? 4;

    let lastError: Error | null = null;
    let retryCount = 0;
    let retryWaitMs = 0;
    let rateLimitCount = 0;
    let rateLimitWaitMs = 0;

    let attempt = 0;
    for (;; attempt++) {
      const startedAt = Date.now();
      try {
        const response = await fetch(`${this.providerConfig.baseUrl.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.providerConfig.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: this.modelName,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            temperature: 0.1,
            top_p: 0.8,
            ...(options?.jsonMode ? { response_format: { type: 'json_object' } } : {}),
          }),
        });

        const payload = await response.json().catch(() => ({})) as {
          choices?: Array<{ message?: { content?: string } }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
          error?: { message?: string };
        };
        if (!response.ok) {
          throw new ProviderRequestError(
            response.status,
            payload.error?.message ?? `HTTP ${response.status}`,
            parseRetryAfter(response.headers.get('retry-after'))
          );
        }

        return {
          text: (payload.choices?.[0]?.message?.content ?? '').trim(),
          wasRetried: retryCount > 0,
          retryCount,
          latencyMs: Date.now() - startedAt,
          retryWaitMs,
          rateLimitCount,
          rateLimitWaitMs,
          usage: {
            inputTokens: payload.usage?.prompt_tokens ?? 0,
            outputTokens: payload.usage?.completion_tokens ?? 0,
          },
          model: this.modelName,
          provider: this.providerName,
        };
      } catch (error) {
        lastError = error as Error;
        const permanent = this.classifyPermanent(error);
        if (permanent.isPermanent) {
          // Fail immediately — retrying an invalid key / missing model / bad auth
          // will never succeed and only wastes time and requests.
          throw new PermanentProviderError(
            `${this.providerName} API failed: ${lastError.message}`,
            permanent.status
          );
        }

        const rateLimited = error instanceof ProviderRequestError && error.isRateLimit;
        // Rate-limit responses get their own (more generous) retry budget;
        // other transient errors use maxRetries.
        const retryBudget = rateLimited ? rateLimitMaxRetries : maxRetries;

        if (!this.isRetryable(error) || attempt >= retryBudget) {
          if (rateLimited) {
            // Never surface a generic failure for rate limiting: the pipeline
            // must know NOT to fall back to individual requests here.
            throw new RateLimitExhaustedError(
              `${this.providerName} API rate limited after ${attempt + 1} attempt(s) (HTTP 429): ${lastError.message}`,
              rateLimitCount + 1,
              rateLimitWaitMs
            );
          }
          break;
        }

        retryCount++;
        let delay: number;
        if (rateLimited) {
          rateLimitCount++;
          // Prefer the server's Retry-After hint (including 0 = retry now);
          // fall back to exponential backoff when absent or unparseable.
          // Jitter avoids synchronized retry waves across concurrent requests.
          delay = error.retryAfterSeconds !== undefined
            ? jittered(error.retryAfterSeconds * 1000)
            : jittered(Math.min(BASE_DELAY_MS * Math.pow(2, attempt), MAX_DELAY_MS));
          rateLimitWaitMs += delay;
          logger.warn(`[${this.providerName}] Rate limit (HTTP 429) hit; retrying in ${Math.round(delay)}ms`, {
            error: lastError.message,
            retryAfterSeconds: error.retryAfterSeconds,
            attempt: attempt + 1,
          });
        } else {
          delay = jittered(Math.min(BASE_DELAY_MS * Math.pow(2, attempt), MAX_DELAY_MS));
          retryWaitMs += delay;
          logger.warn(`[${this.providerName}] Transient error; retrying in ${Math.round(delay)}ms`, {
            error: lastError.message,
          });
        }
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw new Error(`${this.providerName} API failed after ${retryCount} retry(ies): ${lastError?.message ?? 'Unknown error'}`);
  }

  private isRetryable(error: unknown): boolean {
    if (error instanceof ProviderRequestError) return RETRYABLE_STATUS_CODES.has(error.status);
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    return message.includes('network') || message.includes('timeout') || message.includes('econnreset');
  }

  /**
   * Detects errors that will never succeed on retry (invalid API key,
   * insufficient balance, unsupported model, authentication failure).
   */
  private classifyPermanent(error: unknown): { isPermanent: boolean; status?: number } {
    if (error instanceof ProviderRequestError) {
      if (PERMANENT_STATUS_CODES.has(error.status)) return { isPermanent: true, status: error.status };
      return { isPermanent: false };
    }
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    return {
      isPermanent:
        message.includes('invalid api key') ||
        message.includes('unauthorized') ||
        message.includes('authentication') ||
        message.includes('permission denied') ||
        message.includes('insufficient balance') ||
        message.includes('model not found') ||
        message.includes('does not exist'),
    };
  }
}

/** Missing API key — permanent configuration error, never retryable. */
export class ProviderConfigurationError extends PermanentProviderError {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderConfigurationError';
  }
}

class ProviderRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryAfterSeconds?: number
  ) {
    super(message);
  }

  get isRateLimit(): boolean {
    return this.status === 429;
  }
}

/**
 * A small async semaphore that bounds how many requests are in flight at once.
 * Waiters are served FIFO so load stays smooth rather than bursting.
 */
class Semaphore {
  private available: number;
  private readonly waiters: Array<() => void> = [];

  constructor(limit: number) {
    this.available = Math.max(1, Math.floor(limit));
  }

  acquire(): Promise<void> {
    if (this.available > 0) {
      this.available--;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) {
      next();
    } else {
      this.available++;
    }
  }
}

/**
 * One semaphore per provider name (shared across all instances and models, so
 * concurrent jobs for the same provider respect one global in-flight cap).
 */
const semaphores = new Map<string, Semaphore>();

function getSemaphore(providerName: string, limit: number): Semaphore {
  let semaphore = semaphores.get(providerName);
  if (!semaphore) {
    semaphore = new Semaphore(limit);
    semaphores.set(providerName, semaphore);
  }
  return semaphore;
}

/** Test hook: clears the shared per-provider semaphores. */
export function resetSemaphoresForTesting(): void {
  semaphores.clear();
}

/**
 * Parses a Retry-After header value: either an integer number of seconds or an
 * HTTP-date. Returns undefined when absent or unparseable (caller falls back to
 * exponential backoff).
 */
function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    return parseInt(trimmed, 10);
  }
  const dateMs = Date.parse(trimmed);
  if (!isNaN(dateMs)) {
    return Math.max(0, Math.ceil((dateMs - Date.now()) / 1000));
  }
  return undefined;
}

/** Full jitter (0.5x–1.0x of the base delay) to avoid synchronized retry waves. */
function jittered(baseDelayMs: number): number {
  return Math.max(0, Math.round(baseDelayMs * (0.5 + Math.random() * 0.5)));
}

export const chatCompletionsConfigs = {
  mistral: config.mistral,
  openrouter: config.openrouter,
} as const;
