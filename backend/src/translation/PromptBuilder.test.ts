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
        '## 3. MULTILINGUAL INPUT DOCUMENT RULE - MANDATORY',
        '## 4. COMPLETE TRANSLATION',
        '## 5. NATURAL FLUENCY & READABILITY',
        '## 6. CONTINUOUS CONTEXT',
        '## 7. SEMANTIC FIDELITY',
        '## 8. TERMINOLOGY & LOCALIZATION',
        '## 9. ACRONYMS & ABBREVIATIONS',
        '## 10. PROPER NOUNS & NAMES',
        '## 11. NUMBERS, DATES, UNITS & SPECIAL CONTENT',
        '## 12. RIGHT-TO-LEFT (RTL) LANGUAGES',
        '## 13. SCRIPT REQUIREMENTS',
        '## 14. CONTEXTUAL REFERENCES',
        '## 15. PUNCTUATION & FORMATTING',
        '## 16. NO HALLUCINATION',
        '## 17. OUTPUT RULE',
      ];
      for (const section of sections) {
        expect(prompt()).toContain(section);
      }
    });

    it('mandates 1:1 structural replication and protected placeholder preservation', () => {
      const text = prompt();
      expect(text).toContain('Never merge, summarize, skip, reorder, or omit content.');
      expect(text).toContain('__TAG_0__');
      expect(text).toContain('__ENTITY_1__');
      expect(text).toContain('must remain EXACTLY unchanged');
      expect(text).toContain('Preserve every placeholder token EXACTLY as it appears.');
    });

    it('includes the mandatory 1:1 replication, layout/directionality, and structured-data rules', () => {
      const text = prompt();
      // 1. 1:1 replication
      expect(text).toContain('### 1.1 1:1 REPLICATION');
      expect(text).toContain('The number and order of translated segments must remain identical to the source.');
      // 2. Layout & directionality (RTL handling)
      expect(text).toContain('### 1.2 LAYOUT & DIRECTIONALITY');
      expect(text).toContain('automatically apply appropriate RTL directionality');
      expect(text).toContain('Do not unnecessarily change the layout of LTR documents.');
      // 3. Structured data & tables
      expect(text).toContain('### 1.3 STRUCTURED DATA & TABLES');
      expect(text).toContain('place the translation ONLY in the column designated for the target language');
      expect(text).toContain('Preserve all existing column headers exactly unless they themselves are translatable content.');
      expect(text).toContain('Never change the number of rows or columns.');
      expect(text).toContain('Do not move, merge, split, or reorder table rows or columns.');
      expect(text).toContain('These rules are MANDATORY and take priority over stylistic preferences.');
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
      expect(systemPrompt).toContain('## 12. RIGHT-TO-LEFT (RTL) LANGUAGES');
      expect(systemPrompt).toContain('Arabic, Urdu, Farsi/Persian, or Pashto');
      expect(systemPrompt).toContain('Urdu (ur) script (اردو)');
      expect(systemPrompt).toContain('Do NOT use Latin/Roman characters as a substitute for Urdu (ur) text.');
    });

    it('handles Pashto (RTL) with explicit script requirement', () => {
      const systemPrompt = builder.buildSystemPrompt(
        basePromptInput({ sourceLanguage: 'en', targetLanguage: 'ps', protectedText: 'The patient has a fever.' })
      );
      expect(systemPrompt).toContain('## 12. RIGHT-TO-LEFT (RTL) LANGUAGES');
      expect(systemPrompt).toContain('Pashto (ps) script (پښتو)');
    });

    it('handles Farsi (RTL) with explicit script requirement', () => {
      const systemPrompt = builder.buildSystemPrompt(
        basePromptInput({ sourceLanguage: 'en', targetLanguage: 'fa', protectedText: 'The patient has a fever.' })
      );
      expect(systemPrompt).toContain('## 12. RIGHT-TO-LEFT (RTL) LANGUAGES');
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

    it('applies the mandatory structural and layout rules to batch translation', () => {
      const batchPrompt = builder.buildBatchSystemPrompt(baseBatchInput());
      expect(batchPrompt).toContain('### 1.1 1:1 REPLICATION');
      expect(batchPrompt).toContain('The number and order of translated segments must remain identical to the source.');
      expect(batchPrompt).toContain('### 1.2 LAYOUT & DIRECTIONALITY');
      expect(batchPrompt).toContain('### 1.3 STRUCTURED DATA & TABLES');
      expect(batchPrompt).toContain('These rules are MANDATORY and take priority over stylistic preferences.');
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

  describe('multilingual input document rule', () => {
    it('includes the mandatory multilingual rule with all sub-sections', () => {
      const text = builder.buildSystemPrompt(basePromptInput());
      expect(text).toContain('## 3. MULTILINGUAL INPUT DOCUMENT RULE - MANDATORY');
      expect(text).toContain('### 3.1 SOURCE → TARGET ONLY');
      expect(text).toContain('Translate ONLY content written in the selected Source Language into the selected Target Language.');
      expect(text).toContain('### 3.2 DO NOT TRANSLATE OTHER LANGUAGES');
      expect(text).toContain('Do not rewrite, paraphrase, normalize, transliterate, or "improve" it.');
      expect(text).toContain('### 3.3 SOURCE-LANGUAGE DETECTION');
      expect(text).toContain('Never infer the source language solely from the document\'s overall language distribution.');
      expect(text).toContain('The user-selected Source Language has priority.');
      expect(text).toContain('### 3.4 SOURCE → TARGET EXAMPLES');
      expect(text).toContain('### 3.5 SEGMENT-LEVEL BEHAVIOR');
      expect(text).toContain('A segment containing text in a language other than the selected Source Language should normally remain unchanged.');
      expect(text).toContain('### 3.6 IMPORTANT EXCEPTION');
      expect(text).toContain('### 3.7 OUTPUT REQUIREMENT');
      expect(text).toContain('Never translate the entire document indiscriminately.');
    });

    it('includes the three source → target examples (Tamil→English, Tamil→Hindi, Urdu→English)', () => {
      const text = builder.buildSystemPrompt(basePromptInput());
      expect(text).toContain('Source = Tamil, Target = English');
      expect(text).toContain('Source = Tamil, Target = Hindi');
      expect(text).toContain('Source = Urdu, Target = English');
      expect(text).toContain('நோயாளிக்கு காய்ச்சல் உள்ளது.');
      expect(text).toContain('"Patient Name: John Smith" remains unchanged');
    });

    it('only treats source-language content as translatable', () => {
      const text = builder.buildSystemPrompt(basePromptInput());
      expect(text).toContain('Only content written in the selected Source Language is translatable.');
      expect(text).toContain('Content written in ANY other language must be preserved exactly as it appears');
    });

    it('applies the multilingual rule to batch prompts', () => {
      const batchPrompt = builder.buildBatchSystemPrompt(baseBatchInput());
      expect(batchPrompt).toContain('## 3. MULTILINGUAL INPUT DOCUMENT RULE - MANDATORY');
      expect(batchPrompt).toContain('Translate ONLY content written in the selected Source Language into the selected Target Language.');
      expect(batchPrompt).toContain('Segments written in other languages must be preserved exactly as they appear.');
    });

    it('keeps non-source-language content unchanged even during a corrective retry', () => {
      const systemPrompt = builder.buildSystemPrompt(basePromptInput(), 'Untranslated source script detected');
      expect(systemPrompt).toContain('Content NOT written in the selected Source Language must still be preserved EXACTLY as it appears');

      const batchPrompt = builder.buildBatchSystemPrompt(baseBatchInput(), 'Incomplete translations detected');
      expect(batchPrompt).toContain('Segments NOT written in the selected Source Language must remain exactly as they appear');
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

  describe('chat / bilingual mode & custom instructions', () => {
    it('includes MASTER CHAT TRANSLATION RULES when translationType is chat-bilingual', () => {
      const chatBatchPrompt = builder.buildBatchSystemPrompt(
        baseBatchInput({ translationType: 'chat-bilingual' })
      );
      expect(chatBatchPrompt).toContain('## MASTER CHAT / CONVERSATION TRANSLATION RULES');
      expect(chatBatchPrompt).toContain('You are a professional translator translating a continuous conversation into Tamil (ta).');
      expect(chatBatchPrompt).toContain('Translate every source message into Tamil (ta).');
      expect(chatBatchPrompt).toContain('Do NOT summarize, abbreviate, paraphrase out of context, or condense messages.');
      expect(chatBatchPrompt).toContain('Do NOT omit any text, message, phrase, or detail.');
      expect(chatBatchPrompt).toContain('Preserve all names, proper nouns, and speaker identities exactly.');
      expect(chatBatchPrompt).toContain('Preserve all timestamps');
      expect(chatBatchPrompt).toContain('Preserve all emojis, URLs');
      expect(chatBatchPrompt).toContain('Maintain a strict 1:1 mapping between source input segment IDs and translated output segment IDs.');
      expect(chatBatchPrompt).toContain('Do NOT output detected language names, language codes');
    });

    it('handles dynamic target language (e.g. Hindi) and Auto-detect source language', () => {
      const hiAutoBatchPrompt = builder.buildBatchSystemPrompt(
        baseBatchInput({
          sourceLanguage: 'auto',
          targetLanguage: 'hi',
          translationType: 'chat-bilingual',
        })
      );
      expect(hiAutoBatchPrompt).toContain('## MASTER CHAT / CONVERSATION TRANSLATION RULES');
      expect(hiAutoBatchPrompt).toContain('You are a professional translator translating a continuous conversation into Hindi (hi).');
      expect(hiAutoBatchPrompt).toContain('Translate every source message into Hindi (hi).');
      expect(hiAutoBatchPrompt).toContain('Source language: Auto-detect. Determine the language of each message internally from its content and surrounding context.');
    });

    it('does NOT include MASTER CHAT TRANSLATION RULES when translationType is standard', () => {
      const stdBatchPrompt = builder.buildBatchSystemPrompt(
        baseBatchInput({ translationType: 'standard' })
      );
      expect(stdBatchPrompt).not.toContain('## MASTER CHAT / CONVERSATION TRANSLATION RULES');
    });

    it('includes USER CUSTOM INSTRUCTIONS when customInstructions are provided', () => {
      const customBatchPrompt = builder.buildBatchSystemPrompt(
        baseBatchInput({
          translationType: 'chat-bilingual',
          customInstructions: 'Use formal tone for customer support messages.',
        })
      );
      expect(customBatchPrompt).toContain('## USER CUSTOM INSTRUCTIONS');
      expect(customBatchPrompt).toContain('Use formal tone for customer support messages.');
    });
  });
});
