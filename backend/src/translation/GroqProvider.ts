import Groq from 'groq-sdk';
import { PermanentProviderError } from './TranslationProvider.js';
import type { TranslationProvider, ProviderResponse } from './TranslationProvider.js';
import { config } from '../config/index.js';
import { logger } from '../config/logger.js';

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30000;

export class GroqProvider implements TranslationProvider {
  readonly providerName = 'groq' as const;
  readonly modelName: string;
  private readonly client: Groq;
  private readonly maxRetries: number;

  constructor(overrideModel?: string) {
    this.modelName = overrideModel?.trim() ? overrideModel.trim() : config.groq.model;
    const apiKey = config.groq.apiKey;

    if (!apiKey && config.provider === 'groq') {
      logger.warn('[Groq] GROQ_API_KEY is not set in environment variables');
    }

    this.client = new Groq({ apiKey: apiKey || 'missing_key_placeholder' });
    this.maxRetries = config.groq.maxRetries;
  }

  /**
   * Sends system and user prompts to Groq API with retry handling and optional JSON mode.
   */
  async translate(
    systemPrompt: string,
    userPrompt: string,
    options?: { jsonMode?: boolean }
  ): Promise<ProviderResponse> {
    let lastError: Error | null = null;
    let retryCount = 0;
    let retryWaitMs = 0;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const tStart = Date.now();
      try {
        const response = await this.client.chat.completions.create({
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          model: this.modelName,
          temperature: 0.1,
          top_p: 0.8,
          response_format: options?.jsonMode ? { type: 'json_object' } : undefined,
        });

        const tCallMs = Date.now() - tStart;
        const text = response.choices[0]?.message?.content ?? '';
        const usage = response.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;

        if (attempt > 0) {
          logger.info(`[Groq] Succeeded after ${attempt} retry(ies)`);
        }

        return {
          text: text.trim(),
          wasRetried: attempt > 0,
          retryCount: attempt,
          latencyMs: tCallMs,
          retryWaitMs,
          usage: {
            inputTokens: usage?.prompt_tokens ?? 0,
            outputTokens: usage?.completion_tokens ?? 0,
          },
          model: this.modelName,
          provider: 'groq',
        };
      } catch (err) {
        lastError = err as Error;
        const permanent = this.classifyPermanent(err);
        if (permanent.isPermanent) {
          // Fail immediately — an invalid API key, missing model, or auth
          // failure will never succeed on retry.
          throw new PermanentProviderError(
            `Groq API failed: ${lastError.message}`,
            permanent.status
          );
        }
        const isRetryable = this.isRetryableError(err);

        if (!isRetryable || attempt === this.maxRetries) {
          logger.warn(`[Groq] Non-retryable error or max retries reached`, {
            attempt,
            maxRetries: this.maxRetries,
            error: lastError.message,
          });
          break;
        }

        retryCount = attempt + 1;
        let delay = Math.min(BASE_DELAY_MS * Math.pow(2, attempt), MAX_DELAY_MS);

        // Check for Groq rate limit retry-after hints
        const retryMatch = lastError.message.match(/try again in (\d+(?:\.\d+)?)s/i);
        if (retryMatch && retryMatch[1]) {
          const suggestedSecs = parseFloat(retryMatch[1]);
          if (!isNaN(suggestedSecs) && suggestedSecs > 0) {
            delay = Math.min(Math.ceil(suggestedSecs * 1000) + 1000, 65000);
            logger.info(`[Groq] Rate limit hit. Pausing for ${Math.round(delay / 1000)}s per API guidance...`);
          }
        } else {
          logger.warn(`[Groq] Transient error on attempt ${attempt + 1}, retrying in ${delay}ms`, {
            error: lastError.message,
          });
        }

        retryWaitMs += delay;
        await this.sleep(delay);
      }
    }

    throw new GroqTranslationError(
      `Groq API failed after ${retryCount} retry(ies): ${lastError?.message ?? 'Unknown error'}`
    );
  }

  /**
   * Detects errors that will never succeed on retry: invalid API key,
   * insufficient balance, unsupported model, authentication failures.
   */
  private classifyPermanent(err: unknown): { isPermanent: boolean; status?: number } {
    const raw = err as { status?: number; message?: string };
    const status = typeof raw.status === 'number' ? raw.status : undefined;
    if (status !== undefined) {
      if ([401, 402, 403, 404, 422].includes(status)) return { isPermanent: true, status };
      return { isPermanent: false };
    }
    const msg = (raw.message ?? '').toLowerCase();
    const statusMatch = msg.match(/(?:^|\s)(401|402|403|404|422)(?:\s|$)/);
    if (statusMatch) return { isPermanent: true, status: Number(statusMatch[1]) };
    return {
      isPermanent:
        msg.includes('invalid api key') ||
        msg.includes('unauthorized') ||
        msg.includes('authentication') ||
        msg.includes('permission denied') ||
        msg.includes('insufficient balance') ||
        msg.includes('model not found') ||
        msg.includes('does not exist'),
    };
  }

  private isRetryableError(err: unknown): boolean {
    if (err instanceof Error) {
      const msg = err.message.toLowerCase();
      for (const code of RETRYABLE_STATUS_CODES) {
        if (msg.includes(String(code))) return true;
      }
      if (
        msg.includes('rate limit') ||
        msg.includes('rate_limit_exceeded') ||
        msg.includes('quota') ||
        msg.includes('timeout') ||
        msg.includes('network') ||
        msg.includes('econnreset')
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

export class GroqTranslationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GroqTranslationError';
  }
}
