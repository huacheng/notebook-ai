/**
 * Tests that appendPrompt in session.ts handles segments safely
 * without unsafe type assertions.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const sessionSrc = () =>
  fs.readFileSync(path.resolve(__dirname, '../session.ts'), 'utf-8');

describe('appendPrompt type safety', () => {
  it('should not use unsafe Record<string, unknown> cast for segments access', () => {
    const src = sessionSrc();
    const appendSection = src.match(/appendPrompt[\s\S]*?broadcast\(session/);
    expect(appendSection).toBeTruthy();
    // Should NOT use "as Record<string, unknown>" for accessing cell.segments
    expect(appendSection![0]).not.toContain('Record<string, unknown>');
  });

  it('should safely default segments to empty array', () => {
    const src = sessionSrc();
    const appendSection = src.match(/appendPrompt[\s\S]*?broadcast\(session/);
    expect(appendSection).toBeTruthy();
    // Should have a safe fallback — either ?? [], || [], or : [] ternary
    const hasSafeFallback = /segments.*(?:\?\?|\|\|)\s*\[/.test(appendSection![0])
      || /Array\.isArray.*segments.*:\s*\[/.test(appendSection![0]);
    expect(hasSafeFallback).toBe(true);
  });
});
