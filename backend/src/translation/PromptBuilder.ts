import type { PromptInput, BatchPromptInput } from '../types/index.js';
import { GENERIC_TRANSLATION_RULES } from '../languages/rules/generic.js';
import { getLanguageLabel, getLanguageByCode } from '../languages/languageRegistry.js';

/**
 * PromptBuilder
 *
 * Constructs translation prompts parameterized by source/target languages,
 * domain instructions, language-specific rules, terminology guidelines, and placeholder protections.
 *
 * Design principles:
 *   - Source and target languages are always formatted as human-readable labels + codes (e.g. "Tamil (ta)")
 *   - Never assumes the source language is English — fully language-agnostic
 *   - Explicit instructions requiring COMPLETE translation without leaving source-language text untranslated
 *   - Context segments (previous/next) are demarcated as read-only context
 *   - Placeholder protection rules (__TAG_N__, __ENTITY_N__) are explicit and strict
 */
export class PromptBuilder {
  /**
   * Formats a language code into a display string like "Tamil (ta)".
   */
  private formatLanguage(lang: string): string {
    return getLanguageLabel(lang);
  }

  /**
   * Returns the native (script) name of the language if it differs from the
   * ASCII name (e.g. "தமிழ்" for Tamil, "हिन्दी" for Hindi).
   * Returns an empty string for languages without a distinct native name
   * (e.g. English where nativeName === name).
   */
  private getNativeScript(lang: string): string {
    const entry = getLanguageByCode(lang);
    if (!entry) return '';
    // Omit if nativeName is identical to the ASCII name (e.g. English → English)
    if (!entry.nativeName || entry.nativeName === entry.name) return '';
    return entry.nativeName;
  }

  /**
   * Builds the system instruction prompt for a single segment translation.
   */
  buildSystemPrompt(input: PromptInput, retryNotice?: string): string {
    const srcLang = this.formatLanguage(input.sourceLanguage);
    const tgtLang = this.formatLanguage(input.targetLanguage);

    const tgtNativeScript = this.getNativeScript(input.targetLanguage);
    const tgtScriptNote = tgtNativeScript
      ? ` Your output MUST be written in ${tgtLang} script (${tgtNativeScript}). Do NOT output Latin/Roman characters as a substitute for ${tgtLang} text.`
      : '';

    const lines: string[] = [
      `You are a professional multilingual translator specializing in ${input.domain} translation.`,
      `Source language: ${srcLang}`,
      `Target language: ${tgtLang}`,
      '',
      '## YOUR MANDATORY TRANSLATION TASK',
      `Translate the CURRENT SEGMENT from ${srcLang} into ${tgtLang}.${tgtScriptNote}`,
      `- Translate the entire current segment completely into ${tgtLang}.`,
      `- Every translatable word, phrase, sentence, and expression in the current segment MUST be translated into ${tgtLang}.`,
      `- Do NOT leave source-language text untranslated unless it is a proper noun, brand name, technical identifier, URL, email address, protected entity, or another item explicitly required to remain unchanged.`,
      `- Do not transliterate.`,
      `- Do not preserve the source language.`,
      `- The source text may be in ANY language — English, Tamil, Hindi, Gujarati, Punjabi, Urdu, Bengali, Telugu, Malayalam, Marathi, or another language. Translate it into ${tgtLang} regardless of what language the source is written in.`,
      `- Previous and next segments are provided ONLY as context to help you understand meaning, grammar, and tone. Do NOT translate previous or next segments, and do NOT copy their wording into your answer.`,
      `- Return ONLY the complete, natural, and accurate translation of the current segment in ${tgtLang}.`,
      `- Do not explain your translation.`,
    ];

    if (retryNotice) {
      lines.push(
        '',
        '## CRITICAL RETRY NOTICE',
        `The previous translation attempt was flagged as INCOMPLETE because source-language text was left untranslated.`,
        `You MUST translate EVERY word of the current segment into ${tgtLang}. Do NOT omit or leave any translatable content unchanged.`
      );
    }

    lines.push(
      '',
      '## OUTPUT REQUIREMENTS',
      '- Return ONLY the translated current segment.',
      '- NEVER output conversational text, commentary, or status notes (e.g. "Unfortunately...", "Here is...", "There is no text...", "As an AI...").',
      '- If the source segment is a single word, title, header, label, or proper noun (e.g. "English", "Yes", "Literacy"), translate that exact word/label into the target language.',
      '- Do not add explanations, comments, or notes.',
      '- Do not add quotation marks unless the source text contains them.',
      '- Do not add any introductory phrases.',
      '- If the source segment is empty, return an empty string.',
      '',
      '## DOMAIN INSTRUCTIONS',
      input.domainInstructions,
      '',
      '## TRANSLATION QUALITY RULES',
      ...GENERIC_TRANSLATION_RULES.map((r) => `- ${r}`)
    );

    // Inject language-specific rules if any are configured
    if (input.languageRules.length > 0) {
      lines.push('', `## LANGUAGE-SPECIFIC RULES (${tgtLang})`);
      for (const rule of input.languageRules) {
        lines.push(`- ${rule}`);
      }
    }

    // Inject glossary guidelines if any terms matched
    if (input.glossaryTerms.length > 0) {
      lines.push('', '## TERMINOLOGY GUIDELINES');
      lines.push(
        'When translating the following terms, use the preferred translations where grammatically appropriate:'
      );
      for (const term of input.glossaryTerms) {
        const note = term.note ? ` (${term.note})` : '';
        lines.push(`- "${term.sourceTerm}" → "${term.preferredTranslation}"${note}`);
      }
    }

    // Placeholder protection instructions
    lines.push(
      '',
      '## PLACEHOLDER PROTECTION — CRITICAL',
      'The text may contain placeholder tokens in the format __TAG_N__ and __ENTITY_N__.',
      'These represent protected formatting tags and non-translatable entities.',
      'You MUST:',
      '- Preserve every placeholder token EXACTLY as it appears.',
      '- Not translate, paraphrase, or modify placeholder tokens.',
      '- Not duplicate placeholder tokens.',
      '- Not remove placeholder tokens.',
      '- Place each placeholder in the grammatically correct position in the target sentence.'
    );

    return lines.join('\n');
  }

  /**
   * Builds the user-role message containing the actual translation task.
   */
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

  /**
   * Builds system prompt for a structured batch translation task.
   */
  buildBatchSystemPrompt(input: BatchPromptInput, retryNotice?: string): string {
    const srcLang = this.formatLanguage(input.sourceLanguage);
    const tgtLang = this.formatLanguage(input.targetLanguage);

    const tgtNativeScript = this.getNativeScript(input.targetLanguage);
    const tgtScriptNote = tgtNativeScript
      ? ` Your output MUST use ${tgtLang} script (${tgtNativeScript}). Do NOT output Latin/Roman characters as a substitute for ${tgtLang} text.`
      : '';

    const lines: string[] = [
      `You are a professional multilingual translator specializing in ${input.domain} translation.`,
      `Source language: ${srcLang}`,
      `Target language: ${tgtLang}`,
      '',
      '## YOUR MANDATORY TRANSLATION TASK',
      `Translate every segment from ${srcLang} into ${tgtLang}.${tgtScriptNote}`,
      'For each segment object in the input array:',
      `- Translate ONLY the "sourceText" string into ${tgtLang}.`,
      `- Every translatable word, phrase, sentence, and expression in "sourceText" MUST be completely translated into ${tgtLang}.`,
      `- Do NOT leave source-language text untranslated unless it is a proper noun, brand name, technical identifier, URL, email address, or protected placeholder.`,
      `- Do not transliterate.`,
      `- Do not preserve the source language.`,
      `- The source text may be in ANY language — English, Tamil, Hindi, Gujarati, Punjabi, Urdu, Bengali, Telugu, Malayalam, Marathi, or another language. Translate it into ${tgtLang} regardless of what language the source is written in.`,
      '- Use "previousText" and "nextText" ONLY as context to ensure correct grammar and tone. Do NOT translate context fields.',
      `- Return a valid JSON object with a "translations" array, where each item has:`,
      '  - "id": exact segment ID matching input item',
      `  - "translation": the complete translated string in ${tgtLang}`,
      `- Do not explain your translations.`,
    ];

    if (retryNotice) {
      lines.push(
        '',
        '## CRITICAL RETRY NOTICE',
        `The previous batch translation attempt had INCOMPLETE translations where source text was left untranslated.`,
        `Translate EVERY segment fully into ${tgtLang}. Do NOT omit or copy untranslated source text.`
      );
    }

    lines.push(
      '',
      '## OUTPUT FORMAT REQUIREMENT',
      'Respond ONLY with a valid JSON object adhering strictly to this structure:',
      '{',
      '  "translations": [',
      '    { "id": "segment-id", "translation": "translated text in target language" }',
      '  ]',
      '}',
      'Do not include markdown code fences, comments, explanations, or extra text outside the JSON.',
      '',
      '## DOMAIN INSTRUCTIONS',
      input.domainInstructions,
      '',
      '## TRANSLATION QUALITY RULES',
      ...GENERIC_TRANSLATION_RULES.map((r) => `- ${r}`)
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
        lines.push(`- "${term.sourceTerm}" → "${term.preferredTranslation}"${note}`);
      }
    }

    lines.push(
      '',
      '## PLACEHOLDER PROTECTION — CRITICAL',
      'Preserve all __TAG_N__ and __ENTITY_N__ placeholders EXACTLY without omission, duplication, or modification.'
    );

    return lines.join('\n');
  }

  /**
   * Builds user prompt containing JSON stringified array of segment items.
   */
  buildBatchUserPrompt(input: BatchPromptInput): string {
    return JSON.stringify(input.items, null, 2);
  }
}
