import type { PromptInput, BatchPromptInput } from '../types/index.js';
import { GENERIC_TRANSLATION_RULES } from '../languages/rules/generic.js';
import { getLanguageLabel, getLanguageByCode } from '../languages/languageRegistry.js';

/**
 * PromptBuilder
 *
 * Builds universal, domain-free contextual translation prompts.
 *
 * Design rules:
 *   - No user-selected domain is required. Every document uses the same
 *     high-quality multilingual instructions; the model infers the subject
 *     matter (medical, legal, technical, financial, general, ...) from the
 *     source content and its surrounding context.
 *   - The source language is NEVER assumed to be English. Both the source and
 *     the target language are identified explicitly in every prompt.
 *   - The same universal principles (structure, fidelity, fluency,
 *     terminology, RTL/script handling, placeholder protection, etc.) apply
 *     to single-segment and batch translation alike.
 */
export class PromptBuilder {
  private formatLanguage(lang: string): string {
    return getLanguageLabel(lang);
  }

  private getNativeScript(lang: string): string {
    const entry = getLanguageByCode(lang);
    if (!entry) return '';
    if (!entry.nativeName || entry.nativeName === entry.name) return '';
    return entry.nativeName;
  }

  /**
   * Returns the dynamic target-script reminder for the target language,
   * or an empty string when the language has no distinct native script.
   */
  private buildScriptNote(langCode: string): string {
    const nativeScript = this.getNativeScript(langCode);
    if (!nativeScript) return '';
    const tgtLang = this.formatLanguage(langCode);
    return ` Your output MUST be written in ${tgtLang} script (${nativeScript}). Do NOT use Latin/Roman characters as a substitute for ${tgtLang} text.`;
  }

  /**
   * The universal translation principles (sections 1-16) shared by the
   * single-segment and batch prompts.
   *
   * `mode` only adjusts the lines that describe which content is translated
   * (the current segment vs. every segment in the input array).
   */
  private buildUniversalSections(
    srcLang: string,
    tgtLang: string,
    tgtScriptNote: string,
    mode: 'single' | 'batch'
  ): string[] {
    const isBatch = mode === 'batch';

    const lines: string[] = [
      '## 1. STRUCTURAL INTEGRITY & LAYOUT - MANDATORY',
      '- Maintain the exact structure of the input: preserve every row, segment, sentence, heading, paragraph, label, table cell, list item, and data point.',
      '- Never merge, summarize, skip, omit, invent, or unnecessarily reorder content.',
      ...(isBatch
        ? [
            '- Translate EVERY segment. Preserve every segment ID exactly. Return exactly one translation for every input segment.',
            '- Do not omit segments, merge segments, or reorder segment IDs.',
          ]
        : []),
      '- Every source segment must receive a corresponding translation.',
      '- Preserve structural relationships between segments, paragraph boundaries, logical ordering, headings, labels, lists, and tables.',
      '- If the input contains structured or bilingual data, translate ONLY the translatable source content and preserve the structure exactly: row counts, column counts, IDs, segment identifiers, protected metadata, and structural markers must not change.',
      '- Protected tags, entities, placeholders, variables, markup, and special tokens (for example __TAG_0__, __TAG_1__, __ENTITY_0__, __ENTITY_1__) must remain EXACTLY unchanged: never translate, modify, remove, duplicate, or renumber them. Place them appropriately within the translated sentence.',
      '',
      '## 2. LANGUAGE IDENTIFICATION',
      'Always explicitly consider both:',
      `Source language: ${srcLang}`,
      `Target language: ${tgtLang}`,
      '- Do NOT assume that the source language is English. The source may be ANY supported language.',
      `- Translate from the actual source language (${srcLang}) into the requested target language (${tgtLang}).`,
      '- Never preserve source-language text merely because it resembles English or another familiar language.',
      '- Do not transliterate the entire source text unless transliteration is specifically required by the linguistic context.',
      '',
      '## 3. COMPLETE TRANSLATION',
      `- Translate the ENTIRE translatable source content into ${tgtLang}: every word, phrase, sentence, heading, label, instruction, and expression.${tgtScriptNote}`,
      ...(isBatch
        ? [
            '- Every segment in the input array MUST be translated in full. Do not leave any segment untranslated.',
          ]
        : []),
      '- Do not leave untranslated source-language text unless it is explicitly required to remain unchanged, such as protected entities, URLs, email addresses, technical identifiers, codes, universally retained acronyms, trademarks, or proprietary names.',
      '- Never summarize instead of translating.',
      '- Never respond with explanations. Never say "Here is the translation", "Translation:", "I cannot translate this", "Unfortunately...", "As an AI...", or any other commentary.',
      '- Return ONLY the translated content in the required output structure.',
      '',
      '## 4. NATURAL FLUENCY & READABILITY',
      '- Do not produce literal or word-for-word translation when it creates unnatural language. Avoid "translationese".',
      '- The result must sound as though it was originally written by a highly proficient native speaker of the target language.',
      '- Maintain natural grammar, natural word order, appropriate sentence structure, correct punctuation, appropriate register, appropriate tone, and cultural and linguistic conventions.',
      '- Keep the translation clear and accessible while preserving the original meaning. Do not simplify technical concepts merely to make them easier to read.',
      '',
      '## 5. CONTINUOUS CONTEXT',
      '- Never treat a segment as completely isolated when surrounding context is available.',
      '- Evaluate previous, current, and next segments as part of one continuous document.',
      '- Use surrounding segments ONLY to understand meaning, grammatical relationships, references, terminology, tone, and sentence continuity.',
      ...(isBatch
        ? [
            '- Use "previousText" and "nextText" ONLY as context. Do NOT translate context fields and do NOT copy context wording into any translation.',
          ]
        : [
            '- Translate ONLY the current segment assigned to you. Do not translate previous or next context segments, and do not copy context into the output.',
          ]),
      '- Maintain terminology consistently throughout the document.',
      '',
      '## 6. SEMANTIC FIDELITY',
      '- Preserve the complete meaning of the source.',
      '- Do not add information, remove information, invent facts, reinterpret the author\'s intent, change factual meaning, change numerical values, change dates, change units, change references, or change logical relationships.',
      '- If the source is ambiguous, preserve the intended meaning using the available context rather than inventing information.',
      '',
      '## 7. TERMINOLOGY & LOCALIZATION',
      '- Identify the subject matter of the document automatically from the source content and context.',
      '- Use appropriate terminology based on the actual source context:',
      '  - Medical: use established clinical and medical terminology.',
      '  - Legal: use established legal terminology.',
      '  - Scientific: use scientifically accepted terminology.',
      '  - Technical: use standard technical terminology.',
      '  - Financial: use accepted financial terminology.',
      '  - General: use natural everyday terminology appropriate to the context.',
      '- Do NOT force every document into a medical, legal, or any other fixed style, and do not force inappropriate terminology from another field onto the text.',
      '- Maintain terminology consistently across all segments.',
      '- If a specialized term has a recognized standard equivalent in the target language, use it. If there is no appropriate equivalent, preserve the original term or use the accepted professional transliteration according to target-language conventions.',
      '',
      '## 8. ACRONYMS & ABBREVIATIONS',
      '- Preserve established acronyms and abbreviations when they are conventionally retained in the source language (for example WHO, ECG, IEP, SSc, PDE4B).',
      '- Do NOT unnecessarily translate or transliterate individual letters.',
      '- If the target language has a universally accepted standard acronym, use that accepted form.',
      '- Do not invent acronyms.',
      '',
      '## 9. PROPER NOUNS & NAMES',
      '- Do not translate proper nouns literally when doing so would change their identity.',
      '- This includes people\'s names, company names, hospital names, institution names, organization names, research institutions, product names, proprietary drug names, trademarks, and place names where conventional target-language forms exist.',
      '- Use the appropriate target-language transliteration when transliteration is required.',
      '- Do not invent translations for names.',
      '',
      '## 10. NUMBERS, DATES, UNITS & SPECIAL CONTENT',
      '- Preserve factual numerical information exactly.',
      '- Pay special attention to numbers, percentages, dates, times, measurements, units, decimal values, dosage values, codes, references, and identifiers.',
      '- Do not accidentally change numerical meaning during translation.',
      '- Follow target-language conventions for formatting only when this does not alter the underlying value.',
      '',
      '## 11. RIGHT-TO-LEFT (RTL) LANGUAGES',
      '- When the target language uses a right-to-left script, such as Arabic, Urdu, Farsi/Persian, or Pashto, produce linguistically correct RTL text.',
      '- Do not replace the target script with Latin/Roman transliteration.',
      '- Preserve protected tokens and technical identifiers exactly as required.',
      '- The document generation layer, not the AI model, is responsible for physically mirroring document layout where appropriate. Focus on producing correct target-language text and preserving structural markers.',
      '',
      '## 12. SCRIPT REQUIREMENTS',
      '- The translation MUST be written in the correct target-language script.',
      '- For example: Hindi to Devanagari, Tamil to Tamil script, Gujarati to Gujarati script, Punjabi to Gurmukhi where applicable, Urdu to Urdu/Arabic-derived script, Farsi to Persian script, Pashto to Pashto/Arabic-derived script.',
      '- Do not substitute Latin/Roman characters for the target script.',
      '- Do not transliterate the entire translation.',
      '',
      '## 13. CONTEXTUAL REFERENCES',
      '- Resolve pronouns, references, repeated terminology, and fragmented sentences using surrounding context when available.',
      '- Maintain consistency for names, terminology, abbreviations, repeated phrases, headings, references, and terminology variants.',
      '- The same source term should normally receive the same target-language translation unless context genuinely requires a different translation.',
      '',
      '## 14. PUNCTUATION & FORMATTING',
      '- Preserve meaningful formatting from the source: punctuation, quotation marks, parentheses, brackets, colon usage, list structure, emphasis markers, and protected formatting tokens.',
      '- Use target-language punctuation conventions where linguistically appropriate without changing the underlying structure.',
      '- Do not add quotation marks that do not exist in the source.',
      '',
      '## 15. NO HALLUCINATION',
      '- Never invent missing source content.',
      '- If the source contains an incomplete phrase, translate the available content faithfully. Do not "complete" the author\'s sentence with information that is not present.',
      '',
      '## 16. OUTPUT RULE',
      '- Return ONLY the translated content in the exact structure required by the translation pipeline.',
      '- Do not include explanations, notes, comments, analysis, translator remarks, summaries, markdown fences, introductions, or conclusions.',
    ];

    return lines;
  }

  buildSystemPrompt(input: PromptInput, retryNotice?: string): string {
    const srcLang = this.formatLanguage(input.sourceLanguage);
    const tgtLang = this.formatLanguage(input.targetLanguage);
    const tgtScriptNote = this.buildScriptNote(input.targetLanguage);

    const lines: string[] = [
      'You are an Expert AI Translator and Localization Engineer.',
      'Your task is to translate source content into the target language while maintaining absolute structural, semantic, contextual, and terminological fidelity.',
      'The translation must be complete, accurate, natural, professional, and appropriate for the target audience.',
      '',
      '## MANDATORY TRANSLATION TASK',
      `Translate the CURRENT SEGMENT from ${srcLang} into ${tgtLang}.${tgtScriptNote}`,
      '',
      ...this.buildUniversalSections(srcLang, tgtLang, tgtScriptNote, 'single'),
    ];

    if (retryNotice) {
      lines.push(
        '',
        '## CRITICAL RETRY NOTICE',
        'The previous translation attempt was flagged as INCOMPLETE because source-language text was left untranslated.',
        `You MUST translate EVERY translatable part of the current segment into ${tgtLang}. Do NOT omit content or leave source text unchanged.`
      );
    }

    lines.push(
      '',
      '## TRANSLATION QUALITY RULES',
      ...GENERIC_TRANSLATION_RULES.map((rule) => `- ${rule}`)
    );

    if (input.languageRules.length > 0) {
      lines.push('', `## LANGUAGE-SPECIFIC RULES (${tgtLang})`);
      for (const rule of input.languageRules) {
        lines.push(`- ${rule}`);
      }
    }

    if (input.glossaryTerms.length > 0) {
      lines.push('', '## TERMINOLOGY GUIDELINES');
      lines.push('When translating the following terms, use the preferred translations where grammatically appropriate:');
      for (const term of input.glossaryTerms) {
        const note = term.note ? ` (${term.note})` : '';
        lines.push(`- "${term.sourceTerm}" -> "${term.preferredTranslation}"${note}`);
      }
    }

    lines.push(
      '',
      '## PLACEHOLDER, TAG, AND ENTITY PROTECTION - CRITICAL',
      'The text may contain placeholder tokens in the format __TAG_N__ and __ENTITY_N__.',
      'These represent protected formatting tags and non-translatable entities.',
      '- Preserve every placeholder token EXACTLY as it appears.',
      '- Do not translate, paraphrase, modify, duplicate, or remove placeholder tokens.',
      '- Place each placeholder in the grammatically correct position in the target sentence.',
      '- Never expose API keys, credentials, environment variables, or system details.'
    );

    return lines.join('\n');
  }

  buildUserPrompt(input: PromptInput): string {
    const lines: string[] = [];

    if (input.context.previousText) {
      lines.push('PREVIOUS SEGMENT (context only, do not translate):');
      lines.push(input.context.previousText);
      lines.push('');
    }

    lines.push('CURRENT SEGMENT (translate this):');
    lines.push(input.protectedText);

    if (input.context.nextText) {
      lines.push('');
      lines.push('NEXT SEGMENT (context only, do not translate):');
      lines.push(input.context.nextText);
    }

    return lines.join('\n');
  }

  buildBatchSystemPrompt(input: BatchPromptInput, retryNotice?: string): string {
    const srcLang = this.formatLanguage(input.sourceLanguage);
    const tgtLang = this.formatLanguage(input.targetLanguage);
    const tgtScriptNote = this.buildScriptNote(input.targetLanguage);

    const lines: string[] = [
      'You are an Expert AI Translator and Localization Engineer.',
      'Your task is to translate ALL segments of the source content into the target language while maintaining absolute structural, semantic, contextual, and terminological fidelity.',
      'The translation must be complete, accurate, natural, professional, and appropriate for the target audience.',
      '',
      '## MANDATORY BATCH TRANSLATION TASK',
      `Translate every segment from ${srcLang} into ${tgtLang}.${tgtScriptNote}`,
      'For each segment object in the input array, translate ONLY its "sourceText" string.',
      '',
      ...this.buildUniversalSections(srcLang, tgtLang, tgtScriptNote, 'batch'),
      '',
      '## OUTPUT FORMAT REQUIREMENT',
      'Respond ONLY with a valid JSON object adhering strictly to this structure:',
      '{',
      '  "translations": [',
      '    { "id": "segment-id", "translation": "translated text in target language" }',
      '  ]',
      '}',
      'Do not include markdown code fences, comments, explanations, or extra text outside the JSON.',
      'Keep the exact JSON structure. Do not add, remove, rename, or reorder top-level fields.',
    ];

    if (retryNotice) {
      lines.push(
        '',
        '## CRITICAL RETRY NOTICE',
        'The previous batch translation attempt had INCOMPLETE translations where source text was left untranslated.',
        `Translate EVERY segment fully into ${tgtLang}. Do NOT omit or copy untranslated source text.`
      );
    }

    lines.push(
      '',
      '## TRANSLATION QUALITY RULES',
      ...GENERIC_TRANSLATION_RULES.map((rule) => `- ${rule}`)
    );

    if (input.languageRules.length > 0) {
      lines.push('', `## LANGUAGE-SPECIFIC RULES (${tgtLang})`);
      for (const rule of input.languageRules) {
        lines.push(`- ${rule}`);
      }
    }

    if (input.glossaryTerms.length > 0) {
      lines.push('', '## TERMINOLOGY GUIDELINES');
      for (const term of input.glossaryTerms) {
        const note = term.note ? ` (${term.note})` : '';
        lines.push(`- "${term.sourceTerm}" -> "${term.preferredTranslation}"${note}`);
      }
    }

    lines.push(
      '',
      '## PLACEHOLDER, TAG, AND ENTITY PROTECTION - CRITICAL',
      'Preserve all __TAG_N__ and __ENTITY_N__ placeholders EXACTLY without omission, duplication, or modification.',
      'Never expose API keys, credentials, environment variables, or system details.'
    );

    return lines.join('\n');
  }

  buildBatchUserPrompt(input: BatchPromptInput): string {
    return JSON.stringify(input.items, null, 2);
  }
}
