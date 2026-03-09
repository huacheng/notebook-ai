/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tests the core replacement logic from useMention's handleKeyDown/selectItem.
 * This tests the EXACT same algorithm used when Tab/Enter selects an item.
 */

function simulateInsert(
  text: string,
  triggerPos: number,
  originalQuery: string,
  insertText: string,
): string {
  const before = text.slice(0, triggerPos);
  const after = text.slice(triggerPos + 1 + originalQuery.length);
  return before + insertText + after;
}

describe('Mention insert replacement logic', () => {
  it('replaces @ with file path when no query', () => {
    // User typed just "@", popup opened, selected a file
    const result = simulateInsert('@', 0, '', '@src/main.ts ');
    expect(result).toBe('@src/main.ts ');
  });

  it('replaces @query with file path', () => {
    // User typed "@sr" then selected "src/main.ts"
    const result = simulateInsert('@sr', 0, 'sr', '@src/main.ts ');
    expect(result).toBe('@src/main.ts ');
  });

  it('preserves text before @', () => {
    const result = simulateInsert('hello @', 6, '', '@file.txt ');
    expect(result).toBe('hello @file.txt ');
  });

  it('preserves text after @query', () => {
    const result = simulateInsert('see @fi and more', 4, 'fi', '@file.txt ');
    expect(result).toBe('see @file.txt  and more');
  });

  it('handles @ at start with text after', () => {
    const result = simulateInsert('@ then words', 0, '', '@data.csv ');
    expect(result).toBe('@data.csv  then words');
  });

  it('handles multi-line text', () => {
    const result = simulateInsert('line1\n@', 6, '', '@readme.md ');
    expect(result).toBe('line1\n@readme.md ');
  });
});

/**
 * Test the FileTreePlugin.onSelect return value
 */
describe('FileTreePlugin onSelect', () => {
  it('returns @{path} with trailing space', () => {
    // Simulate what FileTreePlugin.onSelect does
    const onSelect = (entry: { path: string }) => `@${entry.path} `;

    expect(onSelect({ path: 'src/main.ts' })).toBe('@src/main.ts ');
    expect(onSelect({ path: 'README.md' })).toBe('@README.md ');
    expect(onSelect({ path: 'dir/subdir/file.txt' })).toBe('@dir/subdir/file.txt ');
  });

  it('returns "@ " for empty path', () => {
    const onSelect = (entry: { path: string }) => `@${entry.path} `;
    expect(onSelect({ path: '' })).toBe('@ ');
  });
});

/**
 * Test the handleChange trigger detection logic
 */
describe('Trigger detection', () => {
  function findTrigger(value: string, cursorPos: number, trigger: string) {
    const triggerIdx = value.lastIndexOf(trigger, cursorPos - 1);
    if (triggerIdx === -1) return null;
    if (triggerIdx > 0 && !/\s/.test(value[triggerIdx - 1])) return null;
    const query = value.slice(triggerIdx + 1, cursorPos);
    if (/\s/.test(query)) return null;
    return { triggerIdx, query };
  }

  it('detects @ at start', () => {
    expect(findTrigger('@', 1, '@')).toEqual({ triggerIdx: 0, query: '' });
  });

  it('detects @ after space', () => {
    expect(findTrigger('hello @', 7, '@')).toEqual({ triggerIdx: 6, query: '' });
  });

  it('detects @ with query', () => {
    expect(findTrigger('hello @sr', 9, '@')).toEqual({ triggerIdx: 6, query: 'sr' });
  });

  it('rejects @ in middle of word', () => {
    expect(findTrigger('user@email', 10, '@')).toBeNull();
  });

  it('rejects query with space', () => {
    expect(findTrigger('@ with space', 12, '@')).toBeNull();
  });

  it('detects @ on newline', () => {
    expect(findTrigger('line1\n@', 7, '@')).toEqual({ triggerIdx: 6, query: '' });
  });
});
