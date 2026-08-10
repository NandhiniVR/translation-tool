/**
 * Generic language rules.
 *
 * These are shared guidelines that apply broadly across target languages.
 * They are included in the base translation prompt for all language pairs.
 *
 * Language-specific rules are maintained in languageRegistry.ts per-language entries.
 */
export const GENERIC_TRANSLATION_RULES: string[] = [
  'Produce natural, fluent output that a native speaker would find easy to read.',
  'Maintain the register (formal/informal) of the source text.',
  'Do not add explanations, commentary, or notes.',
  'Do not add quotation marks unless the source text contains them.',
  'Preserve sentence structure where natural in the target language.',
  'Do not omit any meaning from the source segment.',
];
