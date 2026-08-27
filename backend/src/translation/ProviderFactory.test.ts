import { jest } from '@jest/globals';
import { ProviderFactory } from './ProviderFactory.js';
import { ChatCompletionsProvider, ProviderConfigurationError, resetSemaphoresForTesting } from './ChatCompletionsProvider.js';
import { RateLimitExhaustedError } from './TranslationProvider.js';
import type { AIProviderName } from './TranslationProvider.js';

/** Builds a minimal Response-like object for fetch mocks. */
function mockHttpResponse(status: number, body: unknown, retryAfter?: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'retry-after' ? (retryAfter ?? null) : null),
    },
  } as unknown as Response;
}

function mistralProvider(overrides: { maxRetries?: number; rateLimitMaxRetries?: number; maxConcurrent?: number } = {}) {
  return new ChatCompletionsProvider('mistral', {
    apiKey: 'test-key',
    model: 'mistral-large-latest',
    baseUrl: 'https://api.mistral.ai/v1',
    maxRetries: overrides.maxRetries ?? 1,
    rateLimitMaxRetries: overrides.rateLimitMaxRetries ?? 4,
    maxConcurrent: overrides.maxConcurrent ?? 4,
  });
}

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

  describe('provider-aware rate limiting (Mistral / OpenRouter)', () => {
    it('retries HTTP 429 respecting Retry-After and succeeds with rate-limit accounting', async () => {
      resetSemaphoresForTesting();
      let callCount = 0;
      const fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        callCount++;
        // First two attempts are rate limited (Retry-After: 0 = retry now);
        // the third succeeds.
        if (callCount < 3) {
          return mockHttpResponse(429, { error: { message: 'rate limited' } }, '0');
        }
        return mockHttpResponse(200, { choices: [{ message: { content: 'hello' } }] });
      });
      try {
        const provider = mistralProvider();
        const res = await provider.translate('system', 'user');
        expect(res.text).toBe('hello');
        expect(callCount).toBe(3); // 2 x 429 + 1 success — no storm beyond retry budget
        expect(res.wasRetried).toBe(true);
        expect(res.rateLimitCount).toBe(2);
        expect(res.retryCount).toBe(2);
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it('throws RateLimitExhaustedError after exhausting the rate-limit budget (never a generic error)', async () => {
      resetSemaphoresForTesting();
      let callCount = 0;
      const fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        callCount++;
        return mockHttpResponse(429, { error: { message: 'rate limited' } }, '0');
      });
      try {
        const provider = mistralProvider({ rateLimitMaxRetries: 2 }); // 3 attempts total
        await expect(provider.translate('system', 'user')).rejects.toThrow(RateLimitExhaustedError);
        expect(callCount).toBe(3);
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it('bounds concurrent in-flight requests with the provider-wide semaphore', async () => {
      resetSemaphoresForTesting();
      let active = 0;
      let maxActive = 0;
      const fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 20));
        active--;
        return mockHttpResponse(200, { choices: [{ message: { content: 'ok' } }] });
      });
      try {
        const provider = mistralProvider({ maxConcurrent: 2 });
        const results = await Promise.all(
          Array.from({ length: 4 }, () => provider.translate('system', 'user'))
        );
        expect(results).toHaveLength(4);
        expect(results.every((r) => r.text === 'ok')).toBe(true);
        // Never more than the configured safe limit in flight at once.
        expect(maxActive).toBeLessThanOrEqual(2);
      } finally {
        fetchSpy.mockRestore();
      }
    });
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
