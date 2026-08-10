import { TagProtector, TagRestorationError } from './TagProtector';

describe('TagProtector', () => {
  let protector: TagProtector;

  beforeEach(() => {
    protector = new TagProtector();
  });

  describe('protect()', () => {
    it('should protect inline bpt/ept tags with __TAG_N__ tokens', () => {
      const input = 'Participation in this <bpt id="1">&lt;strong&gt;</bpt>clinical trial<ept id="2">&lt;/strong&gt;</ept> is voluntary.';
      const result = protector.protect(input);

      expect(result.protectedText).toContain('__TAG_1__');
      expect(result.protectedText).toContain('__TAG_2__');
      expect(result.tokens.length).toBe(2);
      expect(result.tokens[0]!.token).toBe('__TAG_1__');
      expect(result.tokens[0]!.original).toBe('<bpt id="1">&lt;strong&gt;</bpt>');
      expect(result.tokens[1]!.token).toBe('__TAG_2__');
      expect(result.tokens[1]!.original).toBe('<ept id="2">&lt;/strong&gt;</ept>');
    });

    it('should protect standalone ph tags', () => {
      const input = 'Dose of <ph id="3">25 mg</ph> twice daily.';
      const result = protector.protect(input);

      expect(result.protectedText).toContain('__TAG_1__');
      expect(result.tokens.length).toBe(1);
      expect(result.tokens[0]!.original).toBe('<ph id="3">25 mg</ph>');
    });

    it('should return unchanged text if no inline tags exist', () => {
      const input = 'Plain text without any formatting tags.';
      const result = protector.protect(input);

      expect(result.protectedText).toBe(input);
      expect(result.tokens.length).toBe(0);
    });
  });

  describe('restore()', () => {
    it('should restore original inline tags from token placeholders', () => {
      const input = 'Participation in this <bpt id="1">&lt;strong&gt;</bpt>clinical trial<ept id="2">&lt;/strong&gt;</ept> is voluntary.';
      const protectedResult = protector.protect(input);

      // Simulate translation keeping tokens
      const translated = 'इस __TAG_1__क्लिनिकल ट्रायल्स__TAG_2__ में भागीदारी स्वैच्छिक है।';
      const restored = protector.restore(translated, protectedResult.tokens);

      expect(restored).toContain('<bpt id="1">&lt;strong&gt;</bpt>');
      expect(restored).toContain('<ept id="2">&lt;/strong&gt;</ept>');
      expect(restored).not.toContain('__TAG_1__');
      expect(restored).not.toContain('__TAG_2__');
    });

    it('should throw TagRestorationError if a token is missing in translated text', () => {
      const input = 'Participation in this <bpt id="1">bold</bpt>trial<ept id="2">end</ept>.';
      const protectedResult = protector.protect(input);

      // Missing __TAG_2__
      const translated = 'यह परीक्षण __TAG_1__स्वाभाविक__ है।';
      expect(() => protector.restore(translated, protectedResult.tokens)).toThrow(TagRestorationError);
    });

    it('should throw TagRestorationError if a token is duplicated in translated text', () => {
      const input = 'Participation <ph id="1"/> here.';
      const protectedResult = protector.protect(input);

      // Duplicated __TAG_1__
      const translated = 'भागीदारी __TAG_1__ __TAG_1__ यहाँ।';
      expect(() => protector.restore(translated, protectedResult.tokens)).toThrow(TagRestorationError);
    });
  });
});
