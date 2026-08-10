import { ContextBuilder } from './ContextBuilder';
import type { TranslationSegment } from '../types';

describe('ContextBuilder', () => {
  const segments: TranslationSegment[] = [
    { id: '1', index: 0, sourceRaw: 'First segment.', sourceText: 'First segment.', status: 'pending' },
    { id: '2', index: 1, sourceRaw: 'Second segment.', sourceText: 'Second segment.', status: 'pending' },
    { id: '3', index: 2, sourceRaw: 'Third segment.', sourceText: 'Third segment.', status: 'pending' },
  ];

  it('should build context for first segment (empty previous)', () => {
    const builder = new ContextBuilder(500);
    const context = builder.build(segments, 0);

    expect(context.previousText).toBe('');
    expect(context.currentText).toBe('First segment.');
    expect(context.nextText).toBe('Second segment.');
  });

  it('should build context for middle segment', () => {
    const builder = new ContextBuilder(500);
    const context = builder.build(segments, 1);

    expect(context.previousText).toBe('First segment.');
    expect(context.currentText).toBe('Second segment.');
    expect(context.nextText).toBe('Third segment.');
  });

  it('should build context for last segment (empty next)', () => {
    const builder = new ContextBuilder(500);
    const context = builder.build(segments, 2);

    expect(context.previousText).toBe('Second segment.');
    expect(context.currentText).toBe('Third segment.');
    expect(context.nextText).toBe('');
  });

  it('should truncate context exceeding maxChars with an ellipsis', () => {
    const longSegments: TranslationSegment[] = [
      { id: '1', index: 0, sourceRaw: 'A'.repeat(100), sourceText: 'A'.repeat(100), status: 'pending' },
      { id: '2', index: 1, sourceRaw: 'Current.', sourceText: 'Current.', status: 'pending' },
    ];
    const builder = new ContextBuilder(50);
    const context = builder.build(longSegments, 1);

    expect(context.previousText.length).toBeLessThanOrEqual(53); // 50 + '...'
    expect(context.previousText.endsWith('...')).toBe(true);
  });
});
