export interface ProviderResponse {
  text: string;
  wasRetried: boolean;
  retryCount: number;
  latencyMs: number;
  model: string;
  provider: 'gemini' | 'groq';
}

/**
 * TranslationProvider Interface
 *
 * Abstract contract implemented by AI providers (GeminiProvider, GroqProvider).
 * Enforces uniform input parameters, retry mechanisms, and response formatting.
 */
export interface TranslationProvider {
  readonly providerName: 'gemini' | 'groq';
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
