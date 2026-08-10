import type { TranslationProvider } from './TranslationProvider.js';
import { GeminiProvider } from './GeminiProvider.js';
import { GroqProvider } from './GroqProvider.js';
import { config } from '../config/index.js';

/**
 * ProviderFactory
 *
 * Instantiates and returns the configured TranslationProvider (Gemini or Groq)
 * based on environment variable `AI_PROVIDER` or explicit parameter.
 */
export class ProviderFactory {
  static getProvider(providerName?: 'gemini' | 'groq', modelName?: string): TranslationProvider {
    const name = providerName ?? config.provider;

    switch (name) {
      case 'groq':
        return new GroqProvider();
      case 'gemini':
      default:
        return new GeminiProvider(modelName);
    }
  }
}
