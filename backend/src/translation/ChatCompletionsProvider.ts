import { config } from '../config/index.js';
import { logger } from '../config/logger.js';
import type { AIProviderName, ProviderResponse, TranslationProvider } from './TranslationProvider.js';

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
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
};

/**
 * Shared adapter for chat-completions style APIs (Mistral, OpenRouter).
 *
 * Both providers expose `/chat/completions` style endpoints, so a single
 * fetch-based implementation covers them. The adapter follows the same
 * retry/error contract as the Gemini and Groq providers:
 *   - Retries on 429/5xx and network errors (exponential backoff)
 *   - Fails fast on auth/validation errors so the API's message surfaces clearly
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

    let lastError: Error | null = null;
    let retryCount = 0;
    for (let attempt = 0; attempt <= this.providerConfig.maxRetries; attempt++) {
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
          error?: { message?: string };
        };
        if (!response.ok) {
          throw new ProviderRequestError(response.status, payload.error?.message ?? `HTTP ${response.status}`);
        }

        return {
          text: (payload.choices?.[0]?.message?.content ?? '').trim(),
          wasRetried: attempt > 0,
          retryCount: attempt,
          latencyMs: Date.now() - startedAt,
          model: this.modelName,
          provider: this.providerName,
        };
      } catch (error) {
        lastError = error as Error;
        if (!this.isRetryable(error) || attempt === this.providerConfig.maxRetries) break;
        retryCount = attempt + 1;
        const delay = Math.min(BASE_DELAY_MS * Math.pow(2, attempt), MAX_DELAY_MS);
        logger.warn(`[${this.providerName}] Transient error; retrying in ${delay}ms`, { error: lastError.message });
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
}

export class ProviderConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderConfigurationError';
  }
}

class ProviderRequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export const chatCompletionsConfigs = {
  mistral: config.mistral,
  openrouter: config.openrouter,
} as const;
