import type { DomainConfig } from '../types/index.js';

/**
 * Domain Registry
 *
 * The tool uses one universal contextual translation profile. Legacy clients
 * may still send general/medical/legal, but the backend always prompts the
 * model to infer the subject matter from the document itself.
 */

const UNIVERSAL_DOMAIN: DomainConfig = {
  code: 'universal',
  name: 'Universal Contextual',
  promptInstructions: [
    'Treat every document as a universal contextual translation task.',
    'Infer the subject matter from the segment and surrounding context, including medical, legal, technical, financial, academic, regulatory, user-interface, or general content.',
    'Choose terminology, register, and style from the inferred context while preserving semantic fidelity.',
    'Maintain specialized terminology accurately without over-specializing ordinary text.',
    'For translation tasks, always use a conversational, natural tone that seamlessly integrates common English corporate terms.',
  ].join(' '),
};

/**
 * Returns the universal domain configuration for all requests.
 */
export function getDomainConfig(_code?: string): DomainConfig {
  return UNIVERSAL_DOMAIN;
}

/**
 * Returns the single active domain profile for backward-compatible callers.
 */
export function getAllDomains(): DomainConfig[] {
  return [UNIVERSAL_DOMAIN];
}
