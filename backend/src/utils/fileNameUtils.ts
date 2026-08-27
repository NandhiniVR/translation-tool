import * as path from 'path';
import { getLanguageByCode } from '../languages/languageRegistry.js';
import type { OutputFormat } from '../types/index.js';

/**
 * generateOutputFileName
 *
 * Produces a translated output filename in the format:
 *   <original_basename>_<target_language_name_lowercase><original_extension>
 *
 * Rules:
 *   - Only the final extension is separated; dots inside the basename are preserved.
 *   - The target language name is looked up from the language registry.
 *   - If the language code is not found in the registry, the code itself is used as a fallback.
 *   - The language name is always lowercased.
 *   - Bilingual output appends `_bilingual` so the presentation mode is clear.
 *
 * Examples:
 *   generateOutputFileName('Hello.docx', 'ta')                  → 'Hello_tamil.docx'
 *   generateOutputFileName('Hello.docx', 'ta', 'bilingual')     → 'Hello_tamil_bilingual.docx'
 *   generateOutputFileName('Medical_Report.docx', 'hi')         → 'Medical_Report_hindi.docx'
 *   generateOutputFileName('Patient.Report.Final.docx', 'gu')   → 'Patient.Report.Final_gujarati.docx'
 *   generateOutputFileName('Consent.mqxliff', 'ur')             → 'Consent_urdu.mqxliff'
 *   generateOutputFileName('Doc.xliff', 'bn')                   → 'Doc_bengali.xliff'
 */
export function generateOutputFileName(
  originalFileName: string,
  targetLanguageCode: string,
  outputFormat?: OutputFormat
): string {
  const ext = path.extname(originalFileName);           // e.g. '.docx'
  const base = path.basename(originalFileName, ext);    // e.g. 'Medical_Report_Final'

  const lang = getLanguageByCode(targetLanguageCode);
  const langName = (lang?.name ?? targetLanguageCode).toLowerCase(); // e.g. 'tamil'

  const modeSuffix = outputFormat === 'bilingual' ? '_bilingual' : '';

  return `${base}_${langName}${modeSuffix}${ext}`;
}
