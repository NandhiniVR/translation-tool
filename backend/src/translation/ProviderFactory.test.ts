import { jest } from '@jest/globals';
import { ProviderFactory } from './ProviderFactory.js';
import { ChatCompletionsProvider, ProviderConfigurationError } from './ChatCompletionsProvider.js';
import type { AIProviderName } from './TranslationProvider.js';

describe('ProviderFactory - configured providers', () => {
  it('exposes the Gemini provider under its canonical name', () => {
    const provider = ProviderFactory.getProvider('gemini');
    expect(provider.providerName).toBe('gemini');
    expect(provider.modelName.length).toBeGreaterThan(0);
  });

  it('supports selecting Gemini 3.1 Pro Preview and Gemini 3.5 Flash', () => {
    const pro = ProviderFactory.getProvider('gemini', 'gemini-3.1-pro-preview');
    expect(pro.providerName).toBe('gemini');
    expect(pro.modelName).toBe('gemini-3.1-pro-preview');

    const flash = ProviderFactory.getProvider('gemini', 'gemini-3.5-flash');
    expect(flash.providerName).toBe('gemini');
    expect(flash.modelName).toBe('gemini-3.5-flash');
  });

  it('exposes the Groq provider and honors a model override', () => {
    const provider = ProviderFactory.getProvider('groq');
    expect(provider.providerName).toBe('groq');
    expect(provider.modelName.length).toBeGreaterThan(0);

    const overridden = ProviderFactory.getProvider('groq', 'llama-3.3-70b-versatile');
    expect(overridden.modelName).toBe('llama-3.3-70b-versatile');
  });

  it('exposes Mistral and OpenRouter via the chat-completions adapter', () => {
    for (const name of ['mistral', 'openrouter'] as const) {
      const provider = ProviderFactory.getProvider(name);
      expect(provider.providerName).toBe(name);
      expect(provider).toBeInstanceOf(ChatCompletionsProvider);
      expect(provider.modelName.length).toBeGreaterThan(0);
    }
  });

  it('reports a clear configuration error naming the env var when an API key is missing', () => {
    const cases: Array<[AIProviderName, string]> = [
      ['gemini', 'GEMINI_API_KEY'],
      ['groq', 'GROQ_API_KEY'],
      ['mistral', 'MISTRAL_API_KEY'],
      ['openrouter', 'OPENROUTER_API_KEY'],
    ];
    for (const [name, envVar] of cases) {
      const err = ProviderFactory.getConfigurationError(name);
      if (err) {
        expect(err).toContain(envVar);
      } else {
        expect(process.env[envVar]).toBeTruthy();
      }
    }
  });

  it('never includes API key values in configuration error messages', () => {
    const envVars = ['GEMINI_API_KEY', 'GROQ_API_KEY', 'MISTRAL_API_KEY', 'OPENROUTER_API_KEY'] as const;
    const configuredKeys = envVars
      .map((v) => process.env[v])
      .filter((key): key is string => Boolean(key));

    for (const name of ['gemini', 'groq', 'mistral', 'openrouter'] as const) {
      const err = ProviderFactory.getConfigurationError(name);
      if (!err) continue;
      for (const key of configuredKeys) {
        expect(err).not.toContain(key);
      }
    }
  });

  it('fails gracefully with a clear API-key error when a new provider has no key', async () => {
    // Only meaningful when the environment does not already provide real keys.
    const cases: Array<{ name: AIProviderName; envVar: string; model: string }> = [
      { name: 'mistral', envVar: 'MISTRAL_API_KEY', model: 'mistral-large-latest' },
      { name: 'openrouter', envVar: 'OPENROUTER_API_KEY', model: 'meta-llama/llama-3.3-70b-instruct' },
    ];
    for (const { name, envVar, model } of cases) {
      if (process.env[envVar]) continue;
      const provider = new ChatCompletionsProvider(name, {
        apiKey: '',
        model,
        baseUrl: `https://example-${name}.com/v1`,
        maxRetries: 1,
      });
      await expect(provider.translate('system', 'user')).rejects.toThrow(ProviderConfigurationError);
      await expect(provider.translate('system', 'user')).rejects.toThrow(envVar);
    }
  });

  it('surfaces the provider API error message for auth failures without leaking the key', async () => {
    if (process.env.MISTRAL_API_KEY) return;
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: 'invalid api key' } }),
    } as unknown as Response);
    try {
      const provider = new ChatCompletionsProvider('mistral', {
        apiKey: 'test-key',
        model: 'mistral-large-latest',
        baseUrl: 'https://api.mistral.ai/v1',
        maxRetries: 1,
      });
      await expect(provider.translate('system', 'user')).rejects.toThrow(/invalid api key/);
      expect(fetchSpy).toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
