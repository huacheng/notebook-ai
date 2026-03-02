import { describe, it, expect } from 'vitest';
import {
  getContextBudget,
  smartTruncate,
  smartTruncateDiff,
  ContextBudget,
  ModelTier,
} from '../task-ai/context-budget';

describe('contextBudget', () => {
  describe('getContextBudget', () => {
    it('should return highest input limit for code-review', () => {
      const budget = getContextBudget('code-review', 'medium');
      expect(budget.inputLimit).toBe(8000);
      expect(budget.outputLimit).toBe(1000);
    });

    it('should apply 1.5x multiplier for heavy tier', () => {
      const medium = getContextBudget('code-review', 'medium');
      const heavy = getContextBudget('code-review', 'heavy');

      expect(heavy.inputLimit).toBe(Math.floor(medium.inputLimit * 1.5));
      expect(heavy.outputLimit).toBe(Math.floor(medium.outputLimit * 1.5));
    });

    it('should apply 0.7x multiplier for light tier', () => {
      const medium = getContextBudget('code-review', 'medium');
      const light = getContextBudget('code-review', 'light');

      expect(light.inputLimit).toBe(Math.floor(medium.inputLimit * 0.7));
      expect(light.outputLimit).toBe(Math.floor(medium.outputLimit * 0.7));
    });

    it('should return doc-parse budget with high output limit', () => {
      const budget = getContextBudget('doc-parse', 'medium');
      expect(budget.inputLimit).toBe(1000);
      expect(budget.outputLimit).toBe(2000);
      expect(budget.allowOverflow).toBe(true);
    });

    it('should return brainstorm budget', () => {
      const budget = getContextBudget('brainstorm', 'medium');
      expect(budget.inputLimit).toBe(3000);
      expect(budget.outputLimit).toBe(800);
    });

    it('should return debugging budget', () => {
      const budget = getContextBudget('debugging', 'medium');
      expect(budget.inputLimit).toBe(4000);
      expect(budget.outputLimit).toBe(800);
    });

    it('should return tdd budget', () => {
      const budget = getContextBudget('tdd', 'medium');
      expect(budget.inputLimit).toBe(3000);
      expect(budget.outputLimit).toBe(600);
      expect(budget.allowOverflow).toBe(false);
    });

    it('should return frontend-design budget', () => {
      const budget = getContextBudget('frontend-design', 'medium');
      expect(budget.inputLimit).toBe(2000);
      expect(budget.outputLimit).toBe(600);
    });

    it('should fall back to domain-* for unknown slots', () => {
      const budget = getContextBudget('unknown-slot', 'medium');
      expect(budget.inputLimit).toBe(2000);
      expect(budget.outputLimit).toBe(500);
      expect(budget.allowOverflow).toBe(false);
    });

    it('should handle domain-* slot directly', () => {
      const budget = getContextBudget('domain-*', 'medium');
      expect(budget.inputLimit).toBe(2000);
      expect(budget.outputLimit).toBe(500);
    });
  });

  describe('smartTruncate', () => {
    it('should return unchanged content if under limit', () => {
      const short = 'short content';
      expect(smartTruncate(short, 100)).toBe(short);
    });

    it('should preserve head and tail when truncating', () => {
      const long = 'HEAD_CONTENT' + 'x'.repeat(1000) + 'TAIL_CONTENT';
      const truncated = smartTruncate(long, 200);

      expect(truncated).toContain('HEAD_CONTENT');
      expect(truncated).toContain('TAIL_CONTENT');
      expect(truncated).toContain('omitted');
    });

    it('should include character count in omitted message', () => {
      const long = 'START' + 'x'.repeat(500) + 'END';
      const truncated = smartTruncate(long, 100);

      expect(truncated).toMatch(/\d+ chars omitted/);
    });

    it('should respect limit after truncation', () => {
      const long = 'a'.repeat(5000);
      const truncated = smartTruncate(long, 200);

      // Allow some overhead for the omitted message
      expect(truncated.length).toBeLessThanOrEqual(250);
    });

    it('should handle content exactly at limit', () => {
      const exact = 'x'.repeat(100);
      expect(smartTruncate(exact, 100)).toBe(exact);
    });

    it('should preserve 40% head ratio', () => {
      const long = 'H'.repeat(100) + 'M'.repeat(800) + 'T'.repeat(100);
      const truncated = smartTruncate(long, 200);

      // Head should be ~40% of 200 = 80 chars
      const headMatch = truncated.match(/^H+/);
      expect(headMatch).toBeTruthy();
      expect(headMatch![0].length).toBeGreaterThanOrEqual(70);
    });
  });

  describe('smartTruncateDiff', () => {
    it('should return unchanged if under limit', () => {
      const diff = `context line 1\n+added line\n-removed line`;
      expect(smartTruncateDiff(diff, 1000)).toBe(diff);
    });

    it('should prioritize change lines over context', () => {
      const diff = [
        'context 1',
        'context 2',
        'context 3',
        '+added line 1',
        '-removed line 1',
        'context 4',
        'context 5',
        '+added line 2',
        '-removed line 2',
      ].join('\n');

      const truncated = smartTruncateDiff(diff, 100);

      // Change lines should be preserved
      expect(truncated).toContain('+added');
      expect(truncated).toContain('-removed');
    });

    it('should include some context when space allows', () => {
      const diff = [
        'context line before',
        '+added line',
        '-removed line',
        'context line after',
      ].join('\n');

      // Large limit should include context
      const truncated = smartTruncateDiff(diff, 500);
      expect(truncated).toContain('context');
    });

    it('should handle diff with only additions', () => {
      const diff = '+line1\n+line2\n+line3';
      const truncated = smartTruncateDiff(diff, 50);

      expect(truncated).toContain('+line');
    });

    it('should handle diff with only deletions', () => {
      const diff = '-line1\n-line2\n-line3';
      const truncated = smartTruncateDiff(diff, 50);

      expect(truncated).toContain('-line');
    });

    it('should handle empty diff', () => {
      const truncated = smartTruncateDiff('', 100);
      expect(truncated).toBe('');
    });

    it('should fall back to smartTruncate for very long results', () => {
      const longDiff = Array(100).fill('+added line with lots of content').join('\n');
      const truncated = smartTruncateDiff(longDiff, 200);

      expect(truncated.length).toBeLessThanOrEqual(250);
    });
  });
});
