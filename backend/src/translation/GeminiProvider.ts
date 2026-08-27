import { GoogleGenAI } from '@google/genai';
import { config } from '../config/index.js';
import { logger } from '../config/logger.js';

/**
 * GeminiProvider
 *
 * Wraps the @google/genai SDK (v2.x) to provide a clean translation interface
 * with exponential backoff retry logic.
 *
 * IMPORTANT:
 *   - The API key is read from the backend config only.
 *   - The key is NEVER logged, exposed in errors, or sent to the frontend.
 *   - Only called from the backend translation pipeline.
 *
 * Retry behaviour:
 *   - Retries on: 429 (rate limit), 503 (service unavailable), network errors
 *   - Does NOT retry on: 400 (bad request), 401 (auth), permanent validation errors
 *   - Max retries: configurable via GEMINI_MAX_RETRIES env var (default: 3)
 *   - Backoff: 1s, 2s, 4s, 8s... (doubles each retry, capped at 30s)
 */

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30000;

import { PermanentProviderError } from './TranslationProvider.js';
import type { TranslationProvider, ProviderResponse } from './TranslationProvider.js';

export interface GeminiResponse extends ProviderResponse {}

export class GeminiProvider implements TranslationProvider {
  readonly providerName = 'gemini' as const;
  readonly modelName: string;
  private readonly client: GoogleGenAI;
  private readonly maxRetries: number;

  constructor(overrideModel?: string) {
    this.modelName = overrideModel || config.gemini.model;
    this.client = new GoogleGenAI({ apiKey: config.gemini.apiKey });
    this.maxRetries = config.gemini.maxRetries;
  }

  /**
   * Sends a translation request to Gemini with retry handling.
   *
   * @param systemPrompt - The instruction system prompt
   * @param userPrompt - The user-role message with the segment to translate
   * @returns GeminiResponse with the translated text
   * @throws Error if all retries are exhausted or a permanent error occurs
   */
  async translate(
    systemPrompt: string,
    userPrompt: string,
    options?: { jsonMode?: boolean }
  ): Promise<GeminiResponse> {
    let lastError: Error | null = null;
    let retryCount = 0;
    let retryWaitMs = 0;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const tStart = Date.now();
      try {
        const configOptions: Record<string, unknown> = {
          systemInstruction: systemPrompt,
          temperature: 0.1,
          topP: 0.8,
        };

        if (options?.jsonMode) {
          configOptions['responseMimeType'] = 'application/json';
        }

        const response = await this.client.models.generateContent({
          model: this.modelName,
          contents: [
            {
              role: 'user',
              parts: [{ text: userPrompt }],
            },
          ],
          config: configOptions,
        });

        const tCallMs = Date.now() - tStart;
        const text = response.text ?? '';

        if (attempt > 0) {
          logger.info(`[Gemini] Succeeded after ${attempt} retry(ies)`);
        }

        // Capture token usage when the API reports it
        const usageMeta = (response as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } }).usageMetadata;

        return {
          text: text.trim(),
          wasRetried: attempt > 0,
          retryCount: attempt,
          latencyMs: tCallMs,
          retryWaitMs,
          usage: {
            inputTokens: usageMeta?.promptTokenCount ?? 0,
            outputTokens: usageMeta?.candidatesTokenCount ?? 0,
          },
          model: this.modelName,
          provider: 'gemini',
        };
      } catch (err) {
        lastError = err as Error;
        const permanent = this.classifyPermanent(err);
        if (permanent.isPermanent) {
          // Fail immediately — an invalid API key, missing model, or auth
          // failure will never succeed on retry.
          throw new PermanentProviderError(
            `Gemini API failed: ${lastError.message}`,
            permanent.status
          );
        }
        const isRetryable = this.isRetryableError(err);

        if (!isRetryable || attempt === this.maxRetries) {
          // Non-retryable error or exhausted retries
          logger.warn(`[Gemini] Non-retryable error or max retries reached`, {
            attempt,
            maxRetries: this.maxRetries,
            error: lastError.message,
          });
          break;
        }

        retryCount = attempt + 1;

        // Parse retryDelay from Gemini 429 response if present (e.g., "retryDelay": "22s" or "Please retry in 22.74s")
        let delay = Math.min(BASE_DELAY_MS * Math.pow(2, attempt), MAX_DELAY_MS);
        const retryDelayMatch = lastError.message.match(/retry(?:ing|Delay| in)?\s*(?:for)?\s*[:"]?\s*(\d+(?:\.\d+)?)\s*s/i);

        if (retryDelayMatch && retryDelayMatch[1]) {
          const suggestedSeconds = parseFloat(retryDelayMatch[1]);
          if (!isNaN(suggestedSeconds) && suggestedSeconds > 0) {
            delay = Math.min(Math.ceil(suggestedSeconds * 1000) + 1000, 65000);
            logger.info(`[Gemini] Quota rate limit (429) hit. Pausing for ${Math.round(delay / 1000)}s per API guidance before retry attempt ${attempt + 1}...`);
          }
        } else {
          logger.warn(`[Gemini] Transient error on attempt ${attempt + 1}, retrying in ${delay}ms`, {
            error: lastError.message,
          });
        }

        retryWaitMs += delay;
        await this.sleep(delay);
      }
    }

    throw new GeminiTranslationError(
      `Gemini API failed after ${retryCount} retry(ies): ${lastError?.message ?? 'Unknown error'}`
    );
  }

  /**
   * Detects errors that will never succeed on retry: invalid API key,
   * insufficient balance, unsupported model, authentication failures.
   */
  private classifyPermanent(err: unknown): { isPermanent: boolean; status?: number } {
    if (!(err instanceof Error)) return { isPermanent: false };
    const message = err.message.toLowerCase();

    const statusMatch = message.match(/(?:^|\s)(401|402|403|404|422)(?:\s|$)/);
    const status = statusMatch ? Number(statusMatch[1]) : undefined;
    if (status) return { isPermanent: true, status };

    return {
      isPermanent:
        message.includes('invalid api key') ||
        message.includes('api key not valid') ||
        message.includes('unauthorized') ||
        message.includes('unauthenticated') ||
        message.includes('permission denied') ||
        message.includes('insufficient balance') ||
        message.includes('model not found') ||
        message.includes('does not exist'),
    };
  }

  /**
   * Determines if an error is safe to retry.
   * Rate limits, server errors, and network errors are retryable.
   * Auth errors and bad requests are not.
   */
  private isRetryableError(err: unknown): boolean {
    if (err instanceof Error) {
      const message = err.message.toLowerCase();

      // Check for HTTP status codes embedded in error message
      for (const code of RETRYABLE_STATUS_CODES) {
        if (message.includes(String(code))) return true;
      }

      // Network-level errors
      if (
        message.includes('network') ||
        message.includes('timeout') ||
        message.includes('econnreset') ||
        message.includes('econnrefused') ||
        message.includes('socket') ||
        message.includes('rate limit') ||
        message.includes('quota')
      ) {
        return true;
      }
    }
    return false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export class GeminiTranslationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeminiTranslationError';
  }
}
