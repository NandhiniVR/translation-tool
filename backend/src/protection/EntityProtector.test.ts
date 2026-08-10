import { EntityProtector, EntityRestorationError } from './EntityProtector';

describe('EntityProtector', () => {
  let protector: EntityProtector;

  beforeEach(() => {
    protector = new EntityProtector();
  });

  describe('protect()', () => {
    it('should protect URLs with __ENTITY_N__ tokens', () => {
      const input = 'Visit https://example.com/study for more details.';
      const result = protector.protect(input);

      expect(result.protectedText).toContain('__ENTITY_1__');
      expect(result.tokens.length).toBe(1);
      expect(result.tokens[0]!.original).toBe('https://example.com/study');
    });

    it('should protect email addresses', () => {
      const input = 'Contact study@example.com for questions.';
      const result = protector.protect(input);

      expect(result.protectedText).toContain('__ENTITY_1__');
      expect(result.tokens[0]!.original).toBe('study@example.com');
    });

    it('should protect NCT IDs and study codes', () => {
      const input = 'Study reference NCT12345678 and protocol STUDY-2026-MED-001.';
      const result = protector.protect(input);

      expect(result.tokens.length).toBe(2);
      expect(result.tokens.some((t) => t.original === 'NCT12345678')).toBe(true);
      expect(result.tokens.some((t) => t.original === 'STUDY-2026-MED-001')).toBe(true);
    });
  });

  describe('restore()', () => {
    it('should restore original entities', () => {
      const input = 'Contact study@example.com for info.';
      const protectedResult = protector.protect(input);

      const translated = 'जानकारी के लिए __ENTITY_1__ से संपर्क करें।';
      const restored = protector.restore(translated, protectedResult.tokens);

      expect(restored).toContain('study@example.com');
      expect(restored).not.toContain('__ENTITY_1__');
    });

    it('should throw EntityRestorationError if token is missing', () => {
      const input = 'Visit https://example.com for details.';
      const protectedResult = protector.protect(input);

      const translated = 'विवरण के लिए वेबसाइट पर जाएं।';
      expect(() => protector.restore(translated, protectedResult.tokens)).toThrow(EntityRestorationError);
    });
  });
});
