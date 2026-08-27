import type { TranslationProvider } from './TranslationProvider.js';
import { GeminiProvider } from './GeminiProvider.js';
import { GroqProvider } from './GroqProvider.js';
import { config } from '../config/index.js';
import { ChatCompletionsProvider, chatCompletionsConfigs } from './ChatCompletionsProvider.js';
import type { AIProviderName } from './TranslationProvider.js';

/**
 * ProviderFactory
 *
 * Instantiates and returns the configured TranslationProvider (Gemini, Groq,
 * Mistral, or OpenRouter) based on environment variable `AI_PROVIDER` or an
 * explicit parameter.
 *
 * Every provider accepts an optional model override so the backend can honor
 * the model selected in the frontend instead of blindly using a global model.
 */
export class ProviderFactory {
  /**
   * Reuse provider clients (HTTP connection pools, SDK handles) across jobs
   * within the same process. Keyed by provider + model so different model
   * selections still get their own client. Cached clients are safe to share:
   * every translate() call is stateless per request.
   */
  private static readonly clientCache = new Map<string, TranslationProvider>();

  static getConfigurationError(providerName: AIProviderName): string | null {
    const requiredKeyByProvider: Record<AIProviderName, { value: string; envName: string }> = {
      gemini: { value: config.gemini.apiKey, envName: 'GEMINI_API_KEY' },
      groq: { value: config.groq.apiKey, envName: 'GROQ_API_KEY' },
      mistral: { value: config.mistral.apiKey, envName: 'MISTRAL_API_KEY' },
      openrouter: { value: config.openrouter.apiKey, envName: 'OPENROUTER_API_KEY' },
    };
    const requiredKey = requiredKeyByProvider[providerName];
    return requiredKey.value ? null : `${providerName} is not configured. Set ${requiredKey.envName} and redeploy or restart the backend.`;
  }

  static getProvider(providerName?: AIProviderName, modelName?: string): TranslationProvider {
    const name = providerName ?? config.provider;
    const cacheKey = `${name}:${modelName?.trim() || 'default'}`;

    const cached = this.clientCache.get(cacheKey);
    if (cached) return cached;

    let provider: TranslationProvider;
    switch (name) {
      case 'gemini':
        provider = new GeminiProvider(modelName);
        break;
      case 'groq':
        provider = new GroqProvider(modelName);
        break;
      case 'mistral':
      case 'openrouter':
        provider = new ChatCompletionsProvider(name, chatCompletionsConfigs[name], modelName);
        break;
      default:
        throw new Error(`Unsupported AI provider: ${String(name)}`);
    }

    this.clientCache.set(cacheKey, provider);
    return provider;
  }
}
