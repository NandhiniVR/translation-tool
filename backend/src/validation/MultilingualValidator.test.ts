import { SegmentValidator } from './SegmentValidator.js';
import { PromptBuilder } from '../translation/PromptBuilder.js';
import type { PromptInput, BatchPromptInput } from '../types/index.js';

describe('Multilingual Validation & Prompt Building', () => {
  let validator: SegmentValidator;
  let promptBuilder: PromptBuilder;

  beforeEach(() => {
    validator = new SegmentValidator();
    promptBuilder = new PromptBuilder();
  });

  describe('SegmentValidator.checkCompleteness', () => {
    it('should validate a correct non-English to non-English translation (Tamil -> Hindi)', () => {
      const source = 'நோயாளிக்கு காய்ச்சல் உள்ளது. அவர் தினமும் மருந்தை உட்கொள்ள வேண்டும்.';
      const target = 'रोगी को बुखार है। उसे रोज दवा लेनी चाहिए।';

      const res = validator.checkCompleteness(source, target, 'ta', 'hi');
      expect(res.isComplete).toBe(true);
      expect(res.status).toBe('valid');
    });

    it('should flag untranslated Tamil script in Hindi output as FAILED', () => {
      const source = 'நோயாளிக்கு காய்ச்சல் உள்ளது.';
      const target = 'நோயாளிக்கு காய்ச்சல் உள்ளது.'; // Untranslated copy!

      const res = validator.checkCompleteness(source, target, 'ta', 'hi');
      expect(res.isComplete).toBe(false);
      expect(res.status).toBe('failed');
      expect(res.reason).toMatch(/Untranslated source script \(ta\) detected/i);
    });

    it('should flag untranslated Hindi script in Tamil output as FAILED', () => {
      const source = 'रोगी को तेज बुखार है।';
      const target = 'रोगी को तेज बुखार है।'; // Untranslated copy!

      const res = validator.checkCompleteness(source, target, 'hi', 'ta');
      expect(res.isComplete).toBe(false);
      expect(res.status).toBe('failed');
      expect(res.reason).toMatch(/Untranslated source script \(hi\) detected/i);
    });

    it('should flag untranslated Gujarati script in Tamil output as FAILED', () => {
      const source = 'દર્દીને તાવ છે.';
      const target = 'દર્દીને તાવ છે.'; // Untranslated copy!

      const res = validator.checkCompleteness(source, target, 'gu', 'ta');
      expect(res.isComplete).toBe(false);
      expect(res.status).toBe('failed');
      expect(res.reason).toMatch(/Untranslated source script \(gu\) detected/i);
    });

    it('should flag verbatim copied English text in Hindi output as FAILED', () => {
      const source = 'The patient visited the clinic yesterday and received treatment.';
      const target = 'The patient visited the clinic yesterday and received treatment.'; // Untranslated!

      const res = validator.checkCompleteness(source, target, 'en', 'hi');
      expect(res.isComplete).toBe(false);
      expect(res.status).toBe('failed');
      expect(res.reason).toMatch(/missing expected script characters|Substantial source text/i);
    });

    it('should allow legitimate protected entities and numbers in multilingual output', () => {
      const source = 'The patient __ENTITY_1__ visited clinic 102 for __TAG_1__treatment__TAG_2__.';
      const target = 'रोगी __ENTITY_1__ ने क्लिनिक 102 का दौरा किया और __TAG_1__उपचार__TAG_2__ प्राप्त किया।';

      const res = validator.checkCompleteness(source, target, 'en', 'hi');
      expect(res.isComplete).toBe(true);
      expect(res.status).toBe('valid');
    });
  });

  describe('PromptBuilder Multilingual Formatting', () => {
    it('should format explicit language labels like "Tamil (ta)" and "Hindi (hi)" in system prompt', () => {
      const input: PromptInput = {
        sourceLanguage: 'ta',
        targetLanguage: 'hi',
        domain: 'medical',
        context: { previousText: '', currentText: '', nextText: '' },
        protectedText: 'நோயாளிக்கு காய்ச்சல் உள்ளது.',
        glossaryTerms: [],
        languageRules: [],
        domainInstructions: 'Use formal medical terminology.',
      };

      const systemPrompt = promptBuilder.buildSystemPrompt(input);
      expect(systemPrompt).toContain('Source language: Tamil (ta)');
      expect(systemPrompt).toContain('Target language: Hindi (hi)');
      expect(systemPrompt).toContain('Translate the CURRENT SEGMENT from Tamil (ta) into Hindi (hi).');
      expect(systemPrompt).toContain('Do NOT assume the source language is English.');
    });

    it('should inject CRITICAL RETRY NOTICE when retry notice is provided', () => {
      const input: PromptInput = {
        sourceLanguage: 'gu',
        targetLanguage: 'ta',
        domain: 'general',
        context: { previousText: '', currentText: '', nextText: '' },
        protectedText: 'દર્દીને તાવ છે.',
        glossaryTerms: [],
        languageRules: [],
        domainInstructions: 'General translation instructions.',
      };

      const systemPrompt = promptBuilder.buildSystemPrompt(
        input,
        'Untranslated source script detected'
      );

      expect(systemPrompt).toContain('## CRITICAL RETRY NOTICE');
      expect(systemPrompt).toContain('flagged as INCOMPLETE because source-language text was left untranslated');
    });

    it('should format explicit language labels in batch system prompt', () => {
      const input: BatchPromptInput = {
        sourceLanguage: 'ur',
        targetLanguage: 'ta',
        domain: 'legal',
        items: [{ id: 'p-1', sourceText: 'شاہد نے بیان دیا ہے۔' }],
        glossaryTerms: [],
        languageRules: [],
        domainInstructions: 'Legal domain accuracy.',
      };

      const batchPrompt = promptBuilder.buildBatchSystemPrompt(input);
      expect(batchPrompt).toContain('Source language: Urdu (ur)');
      expect(batchPrompt).toContain('Target language: Tamil (ta)');
      expect(batchPrompt).toContain('Translate the provided array of text segments from Urdu (ur) into Tamil (ta).');
    });
  });
});
