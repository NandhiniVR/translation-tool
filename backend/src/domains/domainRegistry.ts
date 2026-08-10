import type { DomainConfig } from '../types/index.js';

/**
 * Domain Registry
 *
 * Each domain configures the tone and style instructions for translation prompts.
 * The domain is selected by the user and affects how Gemini is instructed to
 * handle terminology, register, and precision.
 */

const DOMAINS: Record<string, DomainConfig> = {
  general: {
    code: 'general',
    name: 'General',
    promptInstructions: [
      'Use natural, clear language that is easy for a general audience to understand.',
      'Avoid unnecessary jargon or overly formal phrasing unless present in the source.',
      'The tone should be appropriate to the source — neither excessively formal nor informal.',
    ].join(' '),
  },

  medical: {
    code: 'medical',
    name: 'Medical',
    promptInstructions: [
      'Use clear, accessible language while maintaining medical accuracy.',
      'Do not simplify medical terminology when doing so would change the meaning.',
      'Preserve drug names, dosage values, and clinical measurements exactly as in the source.',
      'Patient-facing content should be easy to understand; clinical documentation should maintain precision.',
    ].join(' '),
  },

  legal: {
    code: 'legal',
    name: 'Legal',
    promptInstructions: [
      'Use appropriately formal language consistent with legal documents.',
      'Maintain legal accuracy and preserve specific legal terms where required.',
      'Avoid unnecessarily complicated phrasing while preserving legal meaning.',
      'Do not paraphrase clauses or conditions — translate them faithfully.',
    ].join(' '),
  },
};

/**
 * Returns domain configuration by code.
 * Falls back to 'general' if the code is not recognized.
 */
export function getDomainConfig(code: string): DomainConfig {
  return DOMAINS[code] ?? DOMAINS['general']!;
}

/**
 * Returns all registered domains.
 */
export function getAllDomains(): DomainConfig[] {
  return Object.values(DOMAINS);
}
