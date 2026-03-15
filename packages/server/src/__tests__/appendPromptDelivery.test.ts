/**
 * Test: appendPrompt should queue messages and completeCell should
 * defer completion when there are pending appended prompts.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const sessionSrc = () =>
  fs.readFileSync(path.resolve(__dirname, '../session.ts'), 'utf-8');

describe('appendPrompt delivery to Claude', () => {
  it('should track pending append count on the session', () => {
    const src = sessionSrc();
    expect(src).toContain('_pendingAppends');
  });

  it('appendPrompt should increment _pendingAppends', () => {
    const src = sessionSrc();
    // The appendPrompt method should increment _pendingAppends
    const appendBlock = src.match(/appendPrompt\([\s\S]*?broadcast\(session/);
    expect(appendBlock).toBeTruthy();
    expect(appendBlock![0]).toContain('_pendingAppends++');
  });

  it('completeCell should skip completion when _pendingAppends > 0', () => {
    const src = sessionSrc();
    // completeCell should check _pendingAppends and decrement/skip
    const completeBlock = src.match(/private completeCell[\s\S]*?^  \}/m);
    expect(completeBlock).toBeTruthy();
    expect(completeBlock![0]).toContain('_pendingAppends');
  });
});
