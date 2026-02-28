/**
 * Git quoted path handling tests — TDD Red phase.
 *
 * Git quotes file paths containing non-ASCII characters using octal escape
 * sequences wrapped in double quotes (e.g., "\345\270\202..." for Chinese chars).
 * The numstat parser must unquote these paths so git diff can find them.
 */

import { describe, it, expect } from 'vitest';
import { unquoteGitPath } from '../git-utils.js';

describe('unquoteGitPath', () => {
  it('returns plain ASCII paths unchanged', () => {
    expect(unquoteGitPath('src/index.ts')).toBe('src/index.ts');
  });

  it('returns paths without quotes unchanged', () => {
    expect(unquoteGitPath('path/to/file.txt')).toBe('path/to/file.txt');
  });

  it('unquotes git octal-escaped Chinese path', () => {
    // "市场发现与行情订阅.notebook.json" in git octal encoding
    const quoted = '"\\345\\270\\202\\345\\234\\272\\345\\217\\221\\347\\216\\260\\344\\270\\216\\350\\241\\214\\346\\203\\205\\350\\256\\242\\351\\230\\205.notebook.json"';
    expect(unquoteGitPath(quoted)).toBe('市场发现与行情订阅.notebook.json');
  });

  it('unquotes mixed ASCII and octal path', () => {
    const quoted = '"docs/\\345\\270\\202\\345\\234\\272.md"';
    expect(unquoteGitPath(quoted)).toBe('docs/市场.md');
  });

  it('handles paths with spaces (no octal needed)', () => {
    expect(unquoteGitPath('"path with spaces/file.txt"')).toBe('path with spaces/file.txt');
  });

  it('handles escaped backslash', () => {
    expect(unquoteGitPath('"path\\\\with\\\\backslash"')).toBe('path\\with\\backslash');
  });

  it('handles escaped double quote', () => {
    expect(unquoteGitPath('"path\\"with\\"quote"')).toBe('path"with"quote');
  });

  it('handles escaped tab and newline', () => {
    expect(unquoteGitPath('"path\\twith\\ntab"')).toBe('path\twith\ntab');
  });
});
