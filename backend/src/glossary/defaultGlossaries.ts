import type { GlossaryTerm } from '../types/index.js';

/**
 * Default glossary entries.
 *
 * These are example entries demonstrating the multilingual glossary structure.
 * Real approved terms should be added here or loaded from an external source.
 *
 * Each entry specifies:
 *   - sourceTerm: the term in the source language
 *   - sourceLanguage: BCP-47 code
 *   - targetLanguage: BCP-47 code
 *   - preferredTranslation: the validated translation
 *   - domain: (optional) restricts the term to a specific domain
 *   - note: (optional) guidance on usage
 *
 * These terms are passed to Gemini as GUIDELINES — not as blind replacements.
 * Gemini is asked to prefer these translations where grammatically appropriate.
 */
export const DEFAULT_GLOSSARY: GlossaryTerm[] = [
  // --- Medical: English → Hindi ---
  {
    sourceTerm: 'Informed Consent',
    sourceLanguage: 'en',
    targetLanguage: 'hi',
    preferredTranslation: 'सूचित सहमति',
    domain: 'medical',
    note: 'Standard clinical trial terminology',
  },
  {
    sourceTerm: 'Consent Form',
    sourceLanguage: 'en',
    targetLanguage: 'hi',
    preferredTranslation: 'सहमति पत्र',
    domain: 'medical',
  },
  {
    sourceTerm: 'Clinical Trial',
    sourceLanguage: 'en',
    targetLanguage: 'hi',
    preferredTranslation: 'नैदानिक परीक्षण',
    domain: 'medical',
  },
  {
    sourceTerm: 'Adverse Event',
    sourceLanguage: 'en',
    targetLanguage: 'hi',
    preferredTranslation: 'प्रतिकूल घटना',
    domain: 'medical',
  },
  {
    sourceTerm: 'Principal Investigator',
    sourceLanguage: 'en',
    targetLanguage: 'hi',
    preferredTranslation: 'प्रधान अन्वेषक',
    domain: 'medical',
  },

  // --- Medical: English → Gujarati ---
  {
    sourceTerm: 'Informed Consent',
    sourceLanguage: 'en',
    targetLanguage: 'gu',
    preferredTranslation: 'જાણકારી સંમતિ',
    domain: 'medical',
  },
  {
    sourceTerm: 'Consent Form',
    sourceLanguage: 'en',
    targetLanguage: 'gu',
    preferredTranslation: 'સંમતિ પત્ર',
    domain: 'medical',
  },
  {
    sourceTerm: 'Clinical Trial',
    sourceLanguage: 'en',
    targetLanguage: 'gu',
    preferredTranslation: 'ક્લિનિકલ ટ્રાયલ',
    domain: 'medical',
  },

  // --- Medical: English → Urdu ---
  {
    sourceTerm: 'Informed Consent',
    sourceLanguage: 'en',
    targetLanguage: 'ur',
    preferredTranslation: 'باخبر رضامندی',
    domain: 'medical',
  },
  {
    sourceTerm: 'Consent Form',
    sourceLanguage: 'en',
    targetLanguage: 'ur',
    preferredTranslation: 'رضامندی فارم',
    domain: 'medical',
  },
  {
    sourceTerm: 'Clinical Trial',
    sourceLanguage: 'en',
    targetLanguage: 'ur',
    preferredTranslation: 'طبی آزمائش',
    domain: 'medical',
  },

  // --- Legal: English → Hindi ---
  {
    sourceTerm: 'Liability',
    sourceLanguage: 'en',
    targetLanguage: 'hi',
    preferredTranslation: 'दायित्व',
    domain: 'legal',
  },
  {
    sourceTerm: 'Indemnity',
    sourceLanguage: 'en',
    targetLanguage: 'hi',
    preferredTranslation: 'क्षतिपूर्ति',
    domain: 'legal',
  },
  {
    sourceTerm: 'Jurisdiction',
    sourceLanguage: 'en',
    targetLanguage: 'hi',
    preferredTranslation: 'न्यायक्षेत्र',
    domain: 'legal',
  },
];
