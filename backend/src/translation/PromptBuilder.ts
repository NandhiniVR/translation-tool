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
   * Master Chat / Conversation Translation Prompt Section
   * Included when input.translationType === 'chat-bilingual'
   */
  private buildChatMasterPromptSection(srcLang: string, tgtLang: string): string[] {
    const isAuto = !srcLang || srcLang.toLowerCase() === 'auto' || srcLang.toLowerCase() === 'auto-detect';
    const srcInstruction = isAuto
      ? 'Source language: Auto-detect. Determine the language of each message internally from its content and surrounding context.'
      : `Source language: ${srcLang}.`;

    return [
      '',
      '## MASTER CHAT / CONVERSATION TRANSLATION RULES',
      `You are a professional translator translating a continuous conversation into ${tgtLang}.`,
      '',
      `Translate every source message into ${tgtLang}.`,
      '',
      srcInstruction,
      '',
      'Translation requirements:',
      '1. Preserve the exact meaning, intent, context, and factual information of the source.',
      '2. Do NOT summarize, abbreviate, paraphrase out of context, or condense messages.',
      '3. Do NOT omit any text, message, phrase, or detail.',
      '4. Do NOT add information, facts, or assumptions that do not exist in the source.',
      '5. Do NOT hallucinate missing content.',
      '6. Preserve all names, proper nouns, and speaker identities exactly.',
      '7. Preserve all timestamps, dates, times, numbers, percentages, and message ordering.',
      '8. Preserve all emojis, URLs, email addresses, technical identifiers, and special formatting tokens.',
      '9. Maintain a consistent, natural conversational tone and style throughout the entire document.',
      '10. Handle slang, idioms, colloquialisms, and informal chat language naturally in target language.',
      '11. Maintain terminology consistency and consistent translations of recurring expressions across all messages.',
      '12. Do NOT merge separate messages or split messages unnecessarily.',
      '13. Maintain a strict 1:1 mapping between source input segment IDs and translated output segment IDs.',
      '14. Do NOT output detected language names, language codes (such as "en", "ta", "hi"), or explanations anywhere in the response.',
      '15. Return ONLY the requested structured translation output JSON object.',
    ];
  }

  /**
   * The universal translation principles (sections 1-17) shared by the
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
      '',
      '### 1.1 1:1 REPLICATION',
      '- Maintain the exact structure of the input document.',
      '- Preserve every row, segment, sentence, heading, paragraph, label, table, list item, and data point.',
      '- Never merge, summarize, skip, reorder, or omit content.',
      '- The number and order of translated segments must remain identical to the source.',
      ...(isBatch
        ? [
            '- Translate EVERY segment. Preserve every segment ID exactly. Return exactly one translation for every input segment.',
            '- Do not omit segments, merge segments, or reorder segment IDs.',
          ]
        : []),
      '- Every source segment must receive a corresponding translation.',
      '- Preserve structural relationships between segments, paragraph boundaries, logical ordering, headings, labels, lists, and tables.',
      '',
      '### 1.2 LAYOUT & DIRECTIONALITY',
      '- Replicate the document layout as closely as possible to the source.',
      '- When the target language uses an RTL script (such as Arabic, Urdu, Farsi/Persian, or Pashto), automatically apply appropriate RTL directionality.',
      '- For RTL documents, preserve the logical structure while correctly handling text direction, alignment, reading order, and table direction.',
      '- Do not unnecessarily change the layout of LTR documents.',
      '- Physical layout mirroring and direction attributes are applied by the document generation layer; focus on producing correct target-language text and preserving structural markers.',
      '',
      '### 1.3 STRUCTURED DATA & TABLES',
      '- If the input contains a bilingual or multilingual table, place the translation ONLY in the column designated for the target language.',
      '- Preserve all existing column headers exactly unless they themselves are translatable content.',
      '- Never change the number of rows or columns.',
      '- Preserve the relationship between each source segment and its corresponding target cell.',
      '- Do not move, merge, split, or reorder table rows or columns.',
      '- Translate ONLY the translatable source content and preserve the structure exactly: row counts, column counts, IDs, segment identifiers, protected metadata, and structural markers must not change.',
      '- Protected tags, entities, placeholders, variables, markup, and special tokens (for example __TAG_0__, __TAG_1__, __ENTITY_0__, __ENTITY_1__) must remain EXACTLY unchanged: never translate, modify, remove, duplicate, or renumber them. Place them appropriately within the translated sentence.',
      '- These rules are MANDATORY and take priority over stylistic preferences.',
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
      '## 3. MULTILINGUAL INPUT DOCUMENT RULE - MANDATORY',
      'The input document may contain text in multiple languages simultaneously (for example English, Tamil, Hindi, Urdu, Farsi/Persian, Pashto, or other languages in the same document). The user-selected Source Language and Target Language are authoritative.',
      '',
      '### 3.1 SOURCE → TARGET ONLY',
      '- Translate ONLY content written in the selected Source Language into the selected Target Language.',
      '- Do not translate content merely because it is text in the document.',
      '- The presence of other languages in the document must NOT change the selected source/target translation direction.',
      '- Example: Source Language = Tamil, Target Language = English. If the document contains Tamil + English text, translate ONLY the Tamil content into English. Existing English content must remain unchanged.',
      '',
      '### 3.2 DO NOT TRANSLATE OTHER LANGUAGES',
      '- If the document contains English, Tamil, Hindi, Urdu, Farsi/Persian, Pashto, or any other language that is NOT the selected Source Language, preserve that content EXACTLY as it appears.',
      '- Do not translate it into the target language.',
      '- Do not rewrite, paraphrase, normalize, transliterate, or "improve" it.',
      '- Do not assume that every segment in the document belongs to the selected Source Language.',
      '',
      '### 3.3 SOURCE-LANGUAGE DETECTION',
      '- Determine whether the translatable content actually belongs to the selected Source Language.',
      '- The document itself may contain multiple languages.',
      '- Never infer the source language solely from the document\'s overall language distribution.',
      '- The user-selected Source Language has priority.',
      '',
      '### 3.4 SOURCE → TARGET EXAMPLES',
      '- Example A: Document contains "Patient Name: John Smith" (English) and "நோயாளிக்கு காய்ச்சல் உள்ளது." (Tamil). Source = Tamil, Target = English. Result: "Patient Name: John Smith" remains unchanged; "நோயாளிக்கு காய்ச்சல் உள்ளது." is translated into English.',
      '- Example B: Document contains English + Tamil + Hindi. Source = Tamil, Target = Hindi. Result: Tamil content → Hindi; English content unchanged; Hindi content already present unchanged.',
      '- Example C: Document contains English + Urdu + Farsi. Source = Urdu, Target = English. Result: Urdu content → English; English content unchanged; Farsi content unchanged.',
      '',
      '### 3.5 SEGMENT-LEVEL BEHAVIOR',
      '- Treat each segment independently when determining whether it should be translated.',
      '- A segment containing text in a language other than the selected Source Language should normally remain unchanged.',
      '- Do not force every segment through translation simply because it belongs to the uploaded document.',
      '- Preserve segment IDs, ordering, structure, formatting, tags, placeholders, and document layout.',
      '',
      '### 3.6 IMPORTANT EXCEPTION',
      '- Protected entities, proper nouns, acronyms, URLs, email addresses, technical identifiers, and other explicitly protected content must continue to follow the existing protection rules.',
      '- Do not remove or weaken existing placeholder, tag, and entity protection.',
      '',
      '### 3.7 OUTPUT REQUIREMENT',
      '- The final document must preserve all non-source-language content EXACTLY.',
      '- Only the selected Source Language content should be replaced with its translation into the selected Target Language.',
      '- Never translate the entire document indiscriminately.',
      '',
      '## 4. COMPLETE TRANSLATION',
      `- Translate the ENTIRE translatable source content into ${tgtLang}: every word, phrase, sentence, heading, label, instruction, and expression.${tgtScriptNote}`,
      '- Only content written in the selected Source Language is translatable. Content written in ANY other language must be preserved exactly as it appears (see MULTILINGUAL INPUT DOCUMENT RULE).',
      ...(isBatch
        ? [
            '- Every segment written in the selected Source Language in the input array MUST be translated in full. Segments written in other languages must be preserved exactly as they appear.',
          ]
        : []),
      '- Do not leave untranslated source-language text unless it is explicitly required to remain unchanged, such as protected entities, URLs, email addresses, technical identifiers, codes, universally retained acronyms, trademarks, or proprietary names.',
      '- Never summarize instead of translating.',
      '- Never respond with explanations. Never say "Here is the translation", "Translation:", "I cannot translate this", "Unfortunately...", "As an AI...", or any other commentary.',
      '- Return ONLY the translated content in the required output structure.',
      '',
      '## 5. NATURAL FLUENCY & READABILITY',
      '- Do not produce literal or word-for-word translation when it creates unnatural language. Avoid "translationese".',
      '- The result must sound as though it was originally written by a highly proficient native speaker of the target language.',
      '- Maintain natural grammar, natural word order, appropriate sentence structure, correct punctuation, appropriate register, appropriate tone, and cultural and linguistic conventions.',
      '- Keep the translation clear and accessible while preserving the original meaning. Do not simplify technical concepts merely to make them easier to read.',
      '',
      '## 6. CONTINUOUS CONTEXT',
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
      '## 7. SEMANTIC FIDELITY',
      '- Preserve the complete meaning of the source.',
      '- Do not add information, remove information, invent facts, reinterpret the author\'s intent, change factual meaning, change numerical values, change dates, change units, change references, or change logical relationships.',
      '- If the source is ambiguous, preserve the intended meaning using the available context rather than inventing information.',
      '',
      '## 8. TERMINOLOGY & LOCALIZATION',
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
      '## 9. ACRONYMS & ABBREVIATIONS',
      '- Preserve established acronyms and abbreviations when they are conventionally retained in the source language (for example WHO, ECG, IEP, SSc, PDE4B).',
      '- Do NOT unnecessarily translate or transliterate individual letters.',
      '- If the target language has a universally accepted standard acronym, use that accepted form.',
      '- Do not invent acronyms.',
      '',
      '## 10. PROPER NOUNS & NAMES',
      '- Do not translate proper nouns literally when doing so would change their identity.',
      '- This includes people\'s names, company names, hospital names, institution names, organization names, research institutions, product names, proprietary drug names, trademarks, and place names where conventional target-language forms exist.',
      '- Use the appropriate target-language transliteration when transliteration is required.',
      '- Do not invent translations for names.',
      '',
      '## 11. NUMBERS, DATES, UNITS & SPECIAL CONTENT',
      '- Preserve factual numerical information exactly.',
      '- Pay special attention to numbers, percentages, dates, times, measurements, units, decimal values, dosage values, codes, references, and identifiers.',
      '- Do not accidentally change numerical meaning during translation.',
      '- Follow target-language conventions for formatting only when this does not alter the underlying value.',
      '',
      '## 12. RIGHT-TO-LEFT (RTL) LANGUAGES',
      '- When the target language uses a right-to-left script, such as Arabic, Urdu, Farsi/Persian, or Pashto, produce linguistically correct RTL text.',
      '- Do not replace the target script with Latin/Roman transliteration.',
      '- Preserve protected tokens and technical identifiers exactly as required.',
      '- The document generation layer, not the AI model, is responsible for physically mirroring document layout where appropriate. Focus on producing correct target-language text and preserving structural markers.',
      '',
      '## 13. SCRIPT REQUIREMENTS',
      '- The translation MUST be written in the correct target-language script.',
      '- For example: Hindi to Devanagari, Tamil to Tamil script, Gujarati to Gujarati script, Punjabi to Gurmukhi where applicable, Urdu to Urdu/Arabic-derived script, Farsi to Persian script, Pashto to Pashto/Arabic-derived script.',
      '- Do not substitute Latin/Roman characters for the target script.',
      '- Do not transliterate the entire translation.',
      '',
      '## 14. CONTEXTUAL REFERENCES',
      '- Resolve pronouns, references, repeated terminology, and fragmented sentences using surrounding context when available.',
      '- Maintain consistency for names, terminology, abbreviations, repeated phrases, headings, references, and terminology variants.',
      '- The same source term should normally receive the same target-language translation unless context genuinely requires a different translation.',
      '',
      '## 15. PUNCTUATION & FORMATTING',
      '- Preserve meaningful formatting from the source: punctuation, quotation marks, parentheses, brackets, colon usage, list structure, emphasis markers, and protected formatting tokens.',
      '- Use target-language punctuation conventions where linguistically appropriate without changing the underlying structure.',
      '- Do not add quotation marks that do not exist in the source.',
      '',
      '## 16. NO HALLUCINATION',
      '- Never invent missing source content.',
      '- If the source contains an incomplete phrase, translate the available content faithfully. Do not "complete" the author\'s sentence with information that is not present.',
      '',
      '## 17. OUTPUT RULE',
      '- Return ONLY the translated content in the exact structure required by the translation pipeline.',
      '- Do not include explanations, notes, comments, analysis, translator remarks, summaries, markdown fences, introductions, or conclusions.',
    ];

    return lines;
  }

  buildSystemPrompt(
    input: PromptInput,
    retryNotice?: string
  ): string {
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

    if (input.translationType === 'chat-bilingual') {
      lines.push(...this.buildChatMasterPromptSection(srcLang, tgtLang));
    }

    if (input.customInstructions && input.customInstructions.trim()) {
      lines.push(
        '',
        '## USER CUSTOM INSTRUCTIONS',
        'Follow these user-specified guidelines (basic translation fidelity, 1:1 mapping, and non-hallucination rules remain strictly authoritative):',
        `- ${input.customInstructions.trim()}`
      );
    }

    if (retryNotice) {
      lines.push(
        '',
        '## CRITICAL RETRY NOTICE',
        'The previous translation attempt was flagged as INCOMPLETE because source-language text was left untranslated.',
        `You MUST translate EVERY translatable part of the current segment into ${tgtLang}. Do NOT omit content or leave source text unchanged.`,
        'Content NOT written in the selected Source Language must still be preserved EXACTLY as it appears, even during a retry — do not translate, rewrite, or "improve" it.'
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

  buildBatchSystemPrompt(
    input: BatchPromptInput,
    retryNotice?: string
  ): string {
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

    if (input.translationType === 'chat-bilingual') {
      lines.push(...this.buildChatMasterPromptSection(srcLang, tgtLang));
    }

    if (input.customInstructions && input.customInstructions.trim()) {
      lines.push(
        '',
        '## USER CUSTOM INSTRUCTIONS',
        'Follow these user-specified guidelines (basic translation fidelity, 1:1 mapping, and non-hallucination rules remain strictly authoritative):',
        `- ${input.customInstructions.trim()}`
      );
    }

    if (retryNotice) {
      lines.push(
        '',
        '## CRITICAL RETRY NOTICE',
        'The previous batch translation attempt had INCOMPLETE translations where source text was left untranslated.',
        `Translate EVERY segment written in the selected Source Language fully into ${tgtLang}. Do NOT omit or copy untranslated source text.`,
        'Segments NOT written in the selected Source Language must remain exactly as they appear — do not translate, rewrite, or "improve" them.'
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
