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

    switch (name) {
      case 'gemini':
        return new GeminiProvider(modelName);
      case 'groq':
        return new GroqProvider(modelName);
      case 'mistral':
      case 'openrouter':
        return new ChatCompletionsProvider(name, chatCompletionsConfigs[name], modelName);
      default:
        throw new Error(`Unsupported AI provider: ${String(name)}`);
    }
  }
}
