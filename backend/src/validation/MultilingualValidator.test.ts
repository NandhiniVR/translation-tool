import { SegmentValidator } from './SegmentValidator.js';

describe('Multilingual Validation', () => {
  let validator: SegmentValidator;

  beforeEach(() => {
    validator = new SegmentValidator();
  });

  describe('SegmentValidator.checkCompleteness', () => {
    it('should validate a correct non-English to non-English translation (Tamil -> Hindi)', () => {
      const source = 'நோயாளிக்கு காய்ச்சல் உள்ளது. அவர் தினமும் மருந்தை உட்கொள்ள வேண்டும்.';
      const target = 'रोगी को बुखार है। उसे रोज दवा लेनी चाहिए।';

      const res = validator.checkCompleteness(source, target, 'ta', 'hi');
      expect(res.isComplete).toBe(true);
      expect(res.status).toBe('valid');
    });

    it('should flag untranslated Tamil script in Hindi output as FAILED', () => {
      const source = 'நோயாளிக்கு காய்ச்சல் உள்ளது.';
      const target = 'நோயாளிக்கு காய்ச்சல் உள்ளது.'; // Untranslated copy!

      const res = validator.checkCompleteness(source, target, 'ta', 'hi');
      expect(res.isComplete).toBe(false);
      expect(res.status).toBe('failed');
      expect(res.reason).toMatch(/Untranslated source script \(ta\) detected/i);
    });

    it('should flag untranslated Hindi script in Tamil output as FAILED', () => {
      const source = 'रोगी को तेज बुखार है।';
      const target = 'रोगी को तेज बुखार है।'; // Untranslated copy!

      const res = validator.checkCompleteness(source, target, 'hi', 'ta');
      expect(res.isComplete).toBe(false);
      expect(res.status).toBe('failed');
      expect(res.reason).toMatch(/Untranslated source script \(hi\) detected/i);
    });

    it('should flag untranslated Gujarati script in Tamil output as FAILED', () => {
      const source = 'દર્દીને તાવ છે.';
      const target = 'દર્દીને તાવ છે.'; // Untranslated copy!

      const res = validator.checkCompleteness(source, target, 'gu', 'ta');
      expect(res.isComplete).toBe(false);
      expect(res.status).toBe('failed');
      expect(res.reason).toMatch(/Untranslated source script \(gu\) detected/i);
    });

    it('should flag verbatim copied English text in Hindi output as FAILED', () => {
      const source = 'The patient visited the clinic yesterday and received treatment.';
      const target = 'The patient visited the clinic yesterday and received treatment.'; // Untranslated!

      const res = validator.checkCompleteness(source, target, 'en', 'hi');
      expect(res.isComplete).toBe(false);
      expect(res.status).toBe('failed');
      expect(res.reason).toMatch(/missing expected script characters|Substantial source text/i);
    });

    it('should allow legitimate protected entities and numbers in multilingual output', () => {
      const source = 'The patient __ENTITY_1__ visited clinic 102 for __TAG_1__treatment__TAG_2__.';
      const target = 'रोगी __ENTITY_1__ ने क्लिनिक 102 का दौरा किया और __TAG_1__उपचार__TAG_2__ प्राप्त किया।';

      const res = validator.checkCompleteness(source, target, 'en', 'hi');
      expect(res.isComplete).toBe(true);
      expect(res.status).toBe('valid');
    });
  });

  describe('SegmentValidator.checkCompleteness - multilingual input documents', () => {
    it('allows unchanged English content in a Tamil → English document (Example A)', () => {
      const source = 'Patient Name: John Smith';
      const target = 'Patient Name: John Smith'; // preserved unchanged — English in a Tamil→English doc

      const res = validator.checkCompleteness(source, target, 'ta', 'en');
      expect(res.isComplete).toBe(true);
      expect(res.status).toBe('valid');
    });

    it('allows unchanged English content in a Tamil → Hindi document (Example B)', () => {
      const source = 'The patient is stable.';
      const target = 'The patient is stable.'; // preserved unchanged — English in a Tamil→Hindi doc

      const res = validator.checkCompleteness(source, target, 'ta', 'hi');
      expect(res.isComplete).toBe(true);
      expect(res.status).toBe('valid');
    });

    it('allows unchanged Hindi content in a Tamil → Hindi document (Example B)', () => {
      const source = 'यह हिंदी में लिखा गया है।';
      const target = 'यह हिंदी में लिखा गया है।'; // already in the target language — unchanged

      const res = validator.checkCompleteness(source, target, 'ta', 'hi');
      expect(res.isComplete).toBe(true);
      expect(res.status).toBe('valid');
    });

    it('warns (not fails) on unchanged Farsi content in an Urdu → English document (Example C)', () => {
      const source = 'بیمار تب دارد و باید استراحت کند.';
      const target = 'بیمار تب دارد و باید استراحت کند.'; // preserved unchanged — Farsi in an Urdu→English doc

      const res = validator.checkCompleteness(source, target, 'ur', 'en');
      expect(res.isComplete).toBe(true);
      expect(res.status).toBe('warning');
    });

    it('still fails a genuinely untranslated Tamil segment in a Tamil → English document', () => {
      const source = 'நோயாளிக்கு காய்ச்சல் உள்ளது.';
      const target = 'நோயாளிக்கு காய்ச்சல் உள்ளது.'; // untranslated source-language copy

      const res = validator.checkCompleteness(source, target, 'ta', 'en');
      expect(res.isComplete).toBe(false);
      expect(res.status).toBe('failed');
    });

    it('still fails an untranslated Urdu segment in an Urdu → Tamil document when the source is clearly Urdu', () => {
      const source = 'مریض کو بخار ہے اور اسے آرام کرنا چاہیے۔';
      const target = 'مریض کو بخار ہے اور اسے آرام کرنا چاہیے۔'; // untranslated source-language copy

      const res = validator.checkCompleteness(source, target, 'ur', 'ta');
      expect(res.isComplete).toBe(false);
      expect(res.status).toBe('failed');
    });
  });
});
