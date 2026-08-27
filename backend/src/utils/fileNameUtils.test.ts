import { generateOutputFileName } from './fileNameUtils.js';

describe('generateOutputFileName', () => {
  it('keeps the existing translation-only naming convention', () => {
    expect(generateOutputFileName('Hello.docx', 'ta')).toBe('Hello_tamil.docx');
    expect(generateOutputFileName('Medical_Report.docx', 'hi')).toBe('Medical_Report_hindi.docx');
    expect(generateOutputFileName('Patient.Report.Final.docx', 'gu')).toBe('Patient.Report.Final_gujarati.docx');
    expect(generateOutputFileName('Consent.mqxliff', 'ur')).toBe('Consent_urdu.mqxliff');
    expect(generateOutputFileName('Doc.xliff', 'bn')).toBe('Doc_bengali.xliff');
  });

  it('appends _bilingual for bilingual output and keeps the extension', () => {
    expect(generateOutputFileName('Hello.docx', 'ta', 'bilingual')).toBe('Hello_tamil_bilingual.docx');
    expect(generateOutputFileName('Consent.mqxliff', 'ur', 'bilingual')).toBe('Consent_urdu_bilingual.mqxliff');
  });

  it('is identical to the existing behavior when outputFormat is translation-only or omitted', () => {
    expect(generateOutputFileName('Hello.docx', 'ta', 'translation-only')).toBe('Hello_tamil.docx');
    expect(generateOutputFileName('Hello.docx', 'ta', undefined)).toBe('Hello_tamil.docx');
  });
});
