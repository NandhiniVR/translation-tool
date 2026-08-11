import { jest } from '@jest/globals';
import { TranslationPipeline } from './TranslationPipeline.js';
import { ProviderFactory } from './ProviderFactory.js';
import type { TranslationSegment } from '../types/index.js';
import type { ProviderResponse, TranslationProvider } from './TranslationProvider.js';

/**
 * Fake provider that mirrors the batch/individual contract used by the
 * pipeline without making any real API call.
 */
function createFakeProvider(): TranslationProvider {
  return {
    providerName: 'gemini',
    modelName: 'fake-model',
    async translate(
      _systemPrompt: string,
      userPrompt: string,
      options?: { jsonMode?: boolean }
    ): Promise<ProviderResponse> {
      if (options?.jsonMode) {
        const items = JSON.parse(userPrompt) as Array<{ id: string }>;
        return {
          text: JSON.stringify({
            translations: items.map((item) => ({ id: item.id, translation: 'अनुवादित पाठ' })),
          }),
          wasRetried: false,
          retryCount: 0,
          latencyMs: 1,
          model: 'fake-model',
          provider: 'gemini',
        };
      }
      return {
        text: 'अनुवादित पाठ',
        wasRetried: false,
        retryCount: 0,
        latencyMs: 1,
        model: 'fake-model',
        provider: 'gemini',
      };
    },
  };
}

describe('TranslationPipeline - universal domain', () => {
  it('translates every segment without requiring a domain selection', async () => {
    const spy = jest.spyOn(ProviderFactory, 'getProvider').mockReturnValue(createFakeProvider() as never);
    try {
      const pipeline = new TranslationPipeline();
      const segments: TranslationSegment[] = [
        { id: '1', index: 0, sourceRaw: 'The patient has a fever.', sourceText: 'The patient has a fever.', status: 'pending' },
        { id: '2', index: 1, sourceRaw: 'Take the medicine daily.', sourceText: 'Take the medicine daily.', status: 'pending' },
      ];

      // NOTE: no `domain` is passed — the request must not depend on one.
      const results = await pipeline.run({
        sourceLanguage: 'en',
        targetLanguage: 'hi',
        segments,
        jobId: 'no-domain-job',
      });

      expect(results).toHaveLength(2);
      for (const result of results) {
        expect(result.status).toBe('completed');
        expect(result.translatedText.length).toBeGreaterThan(0);
      }
      // Segment order and IDs preserved
      expect(results[0]!.segmentId).toBe('1');
      expect(results[1]!.segmentId).toBe('2');
    } finally {
      spy.mockRestore();
    }
  });
});
