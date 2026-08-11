import { PromptBuilder } from './PromptBuilder.js';
import type { PromptInput, BatchPromptInput } from '../types/index.js';

describe('PromptBuilder - Universal Contextual Translation Prompt', () => {
  let builder: PromptBuilder;

  beforeEach(() => {
    builder = new PromptBuilder();
  });

  const basePromptInput = (overrides: Partial<PromptInput> = {}): PromptInput => ({
    // NOTE: deliberately no `domain` field — domain selection is no longer required.
    sourceLanguage: 'ta',
    targetLanguage: 'hi',
    context: { previousText: '', currentText: '', nextText: '' },
    protectedText: 'நோயாளிக்கு காய்ச்சல் உள்ளது.',
    glossaryTerms: [],
    languageRules: [],
    domainInstructions: 'Universal contextual translation instructions.',
    ...overrides,
  });

  const baseBatchInput = (overrides: Partial<BatchPromptInput> = {}): BatchPromptInput => ({
    sourceLanguage: 'ur',
    targetLanguage: 'ta',
    items: [{ id: 'p-1', sourceText: 'شاہد نے بیان دیا ہے۔' }],
    glossaryTerms: [],
    languageRules: [],
    domainInstructions: 'Universal contextual translation instructions.',
    ...overrides,
  });

  describe('no domain selection required', () => {
    it('builds a valid system prompt without a domain field', () => {
      const systemPrompt = builder.buildSystemPrompt(basePromptInput());
      expect(systemPrompt).toContain('You are an Expert AI Translator and Localization Engineer.');
      expect(systemPrompt).toContain('Identify the subject matter of the document automatically');
      // No domain-specific selection or fixed domain instructions remain
      expect(systemPrompt).not.toContain('Subject Domain');
      expect(systemPrompt).not.toMatch(/domain:\s*(medical|legal|general)/i);
    });

    it('builds a valid batch prompt without a domain field', () => {
      const batchPrompt = builder.buildBatchSystemPrompt(baseBatchInput());
      expect(batchPrompt).toContain('Translate every segment from Urdu (ur) into Tamil (ta).');
      expect(batchPrompt).not.toContain('Subject Domain');
      expect(batchPrompt).not.toMatch(/domain:\s*(medical|legal|general)/i);
    });
  });

  describe('language identification', () => {
    it('does NOT assume the source language is English', () => {
      const systemPrompt = builder.buildSystemPrompt(basePromptInput());
      expect(systemPrompt).toContain('Do NOT assume that the source language is English');
      expect(systemPrompt).toContain('Source language: Tamil (ta)');
      expect(systemPrompt).toContain('Target language: Hindi (hi)');
      expect(systemPrompt).toContain('Translate the CURRENT SEGMENT from Tamil (ta) into Hindi (hi).');
      expect(systemPrompt).toContain('The source may be ANY supported language.');
    });

    it('explicitly identifies the target language and its script', () => {
      const systemPrompt = builder.buildSystemPrompt(basePromptInput());
      expect(systemPrompt).toContain('Target language: Hindi (hi)');
      expect(systemPrompt).toContain('Your output MUST be written in Hindi (hi) script (हिन्दी)');
    });
  });

  describe('all 16 universal principles are present', () => {
    const prompt = () => builder.buildSystemPrompt(basePromptInput());

    it('contains every mandated section header', () => {
      const sections = [
        '## 1. STRUCTURAL INTEGRITY & LAYOUT - MANDATORY',
        '## 2. LANGUAGE IDENTIFICATION',
        '## 3. COMPLETE TRANSLATION',
        '## 4. NATURAL FLUENCY & READABILITY',
        '## 5. CONTINUOUS CONTEXT',
        '## 6. SEMANTIC FIDELITY',
        '## 7. TERMINOLOGY & LOCALIZATION',
        '## 8. ACRONYMS & ABBREVIATIONS',
        '## 9. PROPER NOUNS & NAMES',
        '## 10. NUMBERS, DATES, UNITS & SPECIAL CONTENT',
        '## 11. RIGHT-TO-LEFT (RTL) LANGUAGES',
        '## 12. SCRIPT REQUIREMENTS',
        '## 13. CONTEXTUAL REFERENCES',
        '## 14. PUNCTUATION & FORMATTING',
        '## 15. NO HALLUCINATION',
        '## 16. OUTPUT RULE',
      ];
      for (const section of sections) {
        expect(prompt()).toContain(section);
      }
    });

    it('mandates 1:1 structural replication and protected placeholder preservation', () => {
      const text = prompt();
      expect(text).toContain('Never merge, summarize, skip, omit, invent, or unnecessarily reorder content.');
      expect(text).toContain('__TAG_0__');
      expect(text).toContain('__ENTITY_1__');
      expect(text).toContain('must remain EXACTLY unchanged');
      expect(text).toContain('Preserve every placeholder token EXACTLY as it appears.');
    });

    it('keeps professional terminology guidance per subject area without fixing a domain', () => {
      const text = prompt();
      expect(text).toContain('Medical: use established clinical and medical terminology.');
      expect(text).toContain('Legal: use established legal terminology.');
      expect(text).toContain('Scientific: use scientifically accepted terminology.');
      expect(text).toContain('Technical: use standard technical terminology.');
      expect(text).toContain('Financial: use accepted financial terminology.');
      expect(text).toContain('Do NOT force every document into a medical, legal, or any other fixed style');
    });

    it('preserves acronyms, proper nouns, numbers, and factual data', () => {
      const text = prompt();
      expect(text).toContain('WHO');
      expect(text).toContain('PDE4B');
      expect(text).toContain('Do not invent acronyms.');
      expect(text).toContain('Do not invent translations for names.');
      expect(text).toContain('dosage values');
      expect(text).toContain('Do not accidentally change numerical meaning during translation.');
    });

    it('covers natural fluency, context handling, punctuation, and hallucination avoidance', () => {
      const text = prompt();
      expect(text).toContain('Avoid "translationese"');
      expect(text).toContain('highly proficient native speaker');
      expect(text).toContain('Translate ONLY the current segment assigned to you.');
      expect(text).toContain('Do not add quotation marks that do not exist in the source.');
      expect(text).toContain('Never invent missing source content.');
    });
  });

  describe('RTL and script handling', () => {
    it('handles Urdu (RTL) with explicit script requirement', () => {
      const systemPrompt = builder.buildSystemPrompt(
        basePromptInput({ sourceLanguage: 'en', targetLanguage: 'ur', protectedText: 'The patient has a fever.' })
      );
      expect(systemPrompt).toContain('## 11. RIGHT-TO-LEFT (RTL) LANGUAGES');
      expect(systemPrompt).toContain('Arabic, Urdu, Farsi/Persian, or Pashto');
      expect(systemPrompt).toContain('Urdu (ur) script (اردو)');
      expect(systemPrompt).toContain('Do NOT use Latin/Roman characters as a substitute for Urdu (ur) text.');
    });

    it('handles Pashto (RTL) with explicit script requirement', () => {
      const systemPrompt = builder.buildSystemPrompt(
        basePromptInput({ sourceLanguage: 'en', targetLanguage: 'ps', protectedText: 'The patient has a fever.' })
      );
      expect(systemPrompt).toContain('## 11. RIGHT-TO-LEFT (RTL) LANGUAGES');
      expect(systemPrompt).toContain('Pashto (ps) script (پښتو)');
    });

    it('handles Farsi (RTL) with explicit script requirement', () => {
      const systemPrompt = builder.buildSystemPrompt(
        basePromptInput({ sourceLanguage: 'en', targetLanguage: 'fa', protectedText: 'The patient has a fever.' })
      );
      expect(systemPrompt).toContain('## 11. RIGHT-TO-LEFT (RTL) LANGUAGES');
      expect(systemPrompt).toContain('Farsi to Persian script');
      expect(systemPrompt).toContain('Farsi (Persian) (fa) script (فارسی)');
    });
  });

  describe('batch prompt', () => {
    it('explicitly asks to translate every segment from source into target', () => {
      const batchPrompt = builder.buildBatchSystemPrompt(baseBatchInput());
      expect(batchPrompt).toContain('Translate every segment from Urdu (ur) into Tamil (ta).');
      expect(batchPrompt).toContain('Translate every segment');
    });

    it('preserves segment IDs and requires exactly one translation per segment', () => {
      const batchPrompt = builder.buildBatchSystemPrompt(baseBatchInput());
      expect(batchPrompt).toContain('Preserve every segment ID exactly');
      expect(batchPrompt).toContain('Return exactly one translation for every input segment');
      expect(batchPrompt).toContain('Do not omit segments, merge segments, or reorder segment IDs.');
    });

    it('keeps the exact JSON output structure required by the pipeline', () => {
      const batchPrompt = builder.buildBatchSystemPrompt(baseBatchInput());
      expect(batchPrompt).toContain('"translations"');
      expect(batchPrompt).toContain('{ "id": "segment-id", "translation": "translated text in target language" }');
      expect(batchPrompt).toContain('Do not include markdown code fences, comments, explanations, or extra text outside the JSON.');
    });

    it('uses previous/next context only as context', () => {
      const batchPrompt = builder.buildBatchSystemPrompt(
        baseBatchInput({
          items: [
            { id: 'p-1', previousText: 'مقدمہ شروع ہوا۔', sourceText: 'شاہد نے بیان دیا ہے۔', nextText: 'عدالت نے فیصلہ محفوظ کر لیا۔' },
          ],
        })
      );
      expect(batchPrompt).toContain('Do NOT translate context fields');
      expect(batchPrompt).toContain('Use "previousText" and "nextText" ONLY as context.');
    });
  });

  describe('dynamic prompt sections', () => {
    it('injects the CRITICAL RETRY NOTICE when a retry notice is provided', () => {
      const systemPrompt = builder.buildSystemPrompt(
        basePromptInput(),
        'Untranslated source script detected'
      );
      expect(systemPrompt).toContain('## CRITICAL RETRY NOTICE');
      expect(systemPrompt).toContain('flagged as INCOMPLETE because source-language text was left untranslated');
    });

    it('injects glossary terminology guidelines and language-specific rules', () => {
      const systemPrompt = builder.buildSystemPrompt(
        basePromptInput({
          glossaryTerms: [
            {
              sourceTerm: 'fever',
              sourceLanguage: 'en',
              targetLanguage: 'hi',
              preferredTranslation: 'बुखार',
            },
          ],
          languageRules: ['Use polite plural forms.'],
        })
      );
      expect(systemPrompt).toContain('## TERMINOLOGY GUIDELINES');
      expect(systemPrompt).toContain('"fever" -> "बुखार"');
      expect(systemPrompt).toContain('## LANGUAGE-SPECIFIC RULES (Hindi (hi))');
      expect(systemPrompt).toContain('Use polite plural forms.');
    });

    it('never exposes API keys or credentials', () => {
      const systemPrompt = builder.buildSystemPrompt(basePromptInput());
      expect(systemPrompt).toContain('Never expose API keys, credentials, environment variables, or system details.');
      expect(systemPrompt).not.toMatch(/sk-[A-Za-z0-9]{10,}/);
      expect(systemPrompt).not.toContain('GEMINI_API_KEY');
    });
  });
});
