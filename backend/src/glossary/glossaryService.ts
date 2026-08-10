import type { GlossaryTerm } from '../types/index.js';
import { DEFAULT_GLOSSARY } from './defaultGlossaries.js';

/**
 * GlossaryService
 *
 * Looks up terminology guidance for a given language pair and domain.
 * Terms are passed to Gemini as guidelines — not used for blind text replacement.
 *
 * The service is stateless; all data comes from the registered glossary at startup.
 * In a future version, this could load from a database or external file.
 */
export class GlossaryService {
  private readonly terms: GlossaryTerm[];

  constructor(additionalTerms: GlossaryTerm[] = []) {
    // Merge default glossary with any additional terms provided at runtime
    this.terms = [...DEFAULT_GLOSSARY, ...additionalTerms];
  }

  /**
   * Returns all glossary terms that apply to the given language pair and domain.
   *
   * A term applies when:
   *   - sourceLanguage matches
   *   - targetLanguage matches
   *   - domain matches, OR the term has no domain restriction
   */
  getTerms(
    sourceLanguage: string,
    targetLanguage: string,
    domain: string
  ): GlossaryTerm[] {
    return this.terms.filter((term) => {
      const langMatch =
        term.sourceLanguage === sourceLanguage &&
        term.targetLanguage === targetLanguage;

      const domainMatch =
        term.domain === undefined || term.domain === domain;

      return langMatch && domainMatch;
    });
  }

  /**
   * Adds terms to the in-memory glossary at runtime.
   * Useful for per-job or per-user terminology overrides.
   */
  addTerms(terms: GlossaryTerm[]): void {
    this.terms.push(...terms);
  }

  /**
   * Returns the full glossary (all terms, all languages).
   */
  getAllTerms(): GlossaryTerm[] {
    return [...this.terms];
  }
}
