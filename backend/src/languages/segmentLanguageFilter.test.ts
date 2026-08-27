import { classifySegmentLanguage } from './segmentLanguageFilter.js';

describe('SegmentLanguageFilter', () => {
  describe('source-language content', () => {
    it('classifies Tamil text as source for Tamil', () => {
      expect(classifySegmentLanguage('நோயாளிக்கு காய்ச்சல் உள்ளது.', 'ta')).toBe('source');
    });

    it('classifies English text as source for English', () => {
      expect(classifySegmentLanguage('The patient has a fever.', 'en')).toBe('source');
    });

    it('classifies Hindi text as source for Hindi', () => {
      expect(classifySegmentLanguage('मरीज़ को बुखार है।', 'hi')).toBe('source');
    });

    it('classifies mixed-script segments as source when they contain source script', () => {
      expect(classifySegmentLanguage('வணக்கம் Hello', 'ta')).toBe('source');
    });
  });

  describe('other-language content (skippable)', () => {
    it('skips English content in a Tamil → English document', () => {
      expect(classifySegmentLanguage('Patient Name: John Smith', 'ta')).toBe('other');
    });

    it('skips Hindi content in an English → Hindi document', () => {
      expect(classifySegmentLanguage('मरीज़ को बुखार है।', 'en')).toBe('other');
    });

    it('skips Tamil content in an English document', () => {
      expect(classifySegmentLanguage('நோயாளிக்கு காய்ச்சல் உள்ளது.', 'en')).toBe('other');
    });

    it('skips long Latin text when the source is a non-Latin script', () => {
      expect(classifySegmentLanguage('This is a longer English sentence with several words.', 'ta')).toBe('other');
    });
  });

  describe('conservative / ambiguous content (sent to model)', () => {
    it('sends short segments to the model', () => {
      expect(classifySegmentLanguage('OK', 'ta')).toBe('ambiguous');
    });

    it('sends numbers/symbols-only segments to the model', () => {
      expect(classifySegmentLanguage('123', 'ta')).toBe('ambiguous');
      expect(classifySegmentLanguage('50%', 'en')).toBe('ambiguous');
    });

    it('sends Arabic-script segments to the model when source shares the Arabic script family', () => {
      // Urdu source + Arabic-script content — cannot distinguish ur/fa/ps safely,
      // so it is classified as 'source' (sent to the model, never skipped).
      expect(classifySegmentLanguage('متن فارسی', 'ur')).toBe('source');
    });

    it('skips Arabic-script content when the source is a non-Arabic language', () => {
      expect(classifySegmentLanguage('متن فارسی', 'ta')).toBe('other');
    });

    it('sends empty text to the model', () => {
      expect(classifySegmentLanguage('', 'ta')).toBe('ambiguous');
    });
  });
});
