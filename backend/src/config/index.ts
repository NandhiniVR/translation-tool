import * as dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';

// ESM-compatible __dirname replacement (tsx v4 runs in ESM mode)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from project root (two levels above backend/src/config/)
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

function getEnv(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue;
}

function getEnvInt(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new Error(`Environment variable ${key} must be an integer, got: ${value}`);
  }
  return parsed;
}

export const config = {
  provider: getEnv('AI_PROVIDER', 'gemini').toLowerCase() as 'gemini' | 'groq' | 'mistral' | 'openrouter',
  gemini: {
    apiKey: getEnv('GEMINI_API_KEY', ''),
    model: getEnv('GEMINI_MODEL', 'gemini-3.1-pro-preview'),
    maxRetries: getEnvInt('MAX_RETRIES', getEnvInt('GEMINI_MAX_RETRIES', 1)),
  },
  groq: {
    apiKey: getEnv('GROQ_API_KEY', ''),
    model: getEnv('GROQ_MODEL', 'llama-3.3-70b-versatile'),
    maxRetries: getEnvInt('GROQ_MAX_RETRIES', 1),
  },
  mistral: {
    apiKey: getEnv('MISTRAL_API_KEY', ''),
    model: getEnv('MISTRAL_MODEL', 'mistral-large-latest'),
    baseUrl: getEnv('MISTRAL_BASE_URL', 'https://api.mistral.ai/v1'),
    maxRetries: getEnvInt('MISTRAL_MAX_RETRIES', 1),
    /**
     * Extra retry budget for HTTP 429 rate limits specifically. Rate-limit
     * responses are retried with Retry-After-aware backoff up to this many
     * retries, independent of maxRetries (which governs other transient
     * errors). After exhausting this budget the provider throws
     * RateLimitExhaustedError and the pipeline marks the batch failed WITHOUT
     * falling back to individual requests (avoids a request storm).
     */
    rateLimitMaxRetries: getEnvInt('MISTRAL_RATE_LIMIT_MAX_RETRIES', 4),
    /**
     * Maximum concurrent in-flight requests for this provider, enforced by a
     * provider-wide semaphore (shared across all jobs in the process). Keeps
     * total load within the account's safe limit even when several translation
     * jobs run at once.
     */
    maxConcurrent: getEnvInt('MISTRAL_MAX_CONCURRENT', 4),
  },
  openrouter: {
    apiKey: getEnv('OPENROUTER_API_KEY', ''),
    model: getEnv('OPENROUTER_MODEL', 'meta-llama/llama-3.3-70b-instruct'),
    baseUrl: getEnv('OPENROUTER_BASE_URL', 'https://openrouter.ai/api/v1'),
    maxRetries: getEnvInt('OPENROUTER_MAX_RETRIES', 1),
    rateLimitMaxRetries: getEnvInt('OPENROUTER_RATE_LIMIT_MAX_RETRIES', 4),
    maxConcurrent: getEnvInt('OPENROUTER_MAX_CONCURRENT', 3),
  },
  server: {
    port: getEnvInt('PORT', 3001),
  },
  translation: {
    concurrency: getEnvInt('TRANSLATION_CONCURRENCY', 4),
    /**
     * Maximum segments per AI request. Token-aware batching packs as many
     * segments as fit under TRANSLATION_MAX_BATCH_TOKENS, capped by this
     * value (short segments pack densely, long segments are limited by the
     * token budget).
     */
    batchSize: getEnvInt('TRANSLATION_BATCH_SIZE', getEnvInt('BATCH_SIZE', 30)),
    /**
     * Token budget per AI request (approximate). 0 disables token-aware
     * batching and falls back to fixed `batchSize` packing. Kept well below
     * every provider's context window so the response has headroom too.
     */
    maxBatchTokens: getEnvInt('TRANSLATION_MAX_BATCH_TOKENS', 12000),
    /**
     * When enabled, segments confidently written in a language other than the
     * selected source language are passed through unchanged WITHOUT being sent
     * to the AI model (big speed win on multilingual documents).
     */
    filterOtherLanguages: getEnv('TRANSLATION_FILTER_OTHER_LANGUAGES', 'true').toLowerCase() !== 'false',
    /**
     * Optional fixed pause between concurrency windows (ms). Defaults to 0:
     * providers already back off on 429/5xx with their own retry logic, so an
     * unconditional sleep only adds idle time on large documents.
     */
    batchDelayMs: getEnvInt('TRANSLATION_BATCH_DELAY_MS', 0),
    /**
     * Pipeline-level retries for a batch whose HTTP 429 budget was exhausted
     * inside the provider. The SAME batch is re-queued with jittered
     * exponential backoff (base 1s, doubling, capped at 30s) before its
     * segments are marked failed. Never falls back to individual requests on
     * rate limits (that would create a request storm).
     */
    batchRateLimitRetries: getEnvInt('TRANSLATION_BATCH_RATE_LIMIT_RETRIES', 3),
    /**
     * Provider-specific overrides. Different providers have different rate
     * limits and optimal batch sizes; these env vars let each one be tuned
     * independently while falling back to the global values above.
     */
    providerOverrides: {
      gemini: {
        batchSize: getEnvInt('GEMINI_BATCH_SIZE', 0) || null,
        concurrency: getEnvInt('GEMINI_CONCURRENCY', 0) || null,
        maxBatchTokens: getEnvInt('GEMINI_MAX_BATCH_TOKENS', 0) || null,
      },
      groq: {
        batchSize: getEnvInt('GROQ_BATCH_SIZE', 0) || null,
        concurrency: getEnvInt('GROQ_CONCURRENCY', 0) || null,
        maxBatchTokens: getEnvInt('GROQ_MAX_BATCH_TOKENS', 0) || null,
      },
      mistral: {
        batchSize: getEnvInt('MISTRAL_BATCH_SIZE', 0) || null,
        concurrency: getEnvInt('MISTRAL_CONCURRENCY', 0) || null,
        maxBatchTokens: getEnvInt('MISTRAL_MAX_BATCH_TOKENS', 0) || null,
      },
      openrouter: {
        batchSize: getEnvInt('OPENROUTER_BATCH_SIZE', 0) || null,
        concurrency: getEnvInt('OPENROUTER_CONCURRENCY', 0) || null,
        maxBatchTokens: getEnvInt('OPENROUTER_MAX_BATCH_TOKENS', 0) || null,
      },
    },
  },
  storage: {
    uploadsDir: process.env.VERCEL ? '/tmp' : path.resolve(__dirname, '..', '..', '..', getEnv('UPLOADS_DIR', 'uploads')),
    outputsDir: process.env.VERCEL ? '/tmp' : path.resolve(__dirname, '..', '..', '..', getEnv('OUTPUTS_DIR', 'outputs')),
  },
  context: {
    maxChars: getEnvInt('CONTEXT_MAX_CHARS', 500),
  },
} as const;

export type Config = typeof config;
