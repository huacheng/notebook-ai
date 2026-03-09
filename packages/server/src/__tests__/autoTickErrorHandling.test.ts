/**
 * Tests that autoTick wraps appendPrompt in try-catch so exceptions
 * don't crash the setInterval callback.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const sessionSrc = () =>
  fs.readFileSync(path.resolve(__dirname, '../session.ts'), 'utf-8');

describe('autoTick error handling', () => {
  it('should wrap appendPrompt call in try-catch', () => {
    const src = sessionSrc();
    // Extract autoTick method body
    const autoTickBody = src.match(/private autoTick\([\s\S]*?(?=\n  \/\*\*|\n  private [a-z]|\n  \/\/ ──)/);
    expect(autoTickBody).toBeTruthy();
    // appendPrompt call should be inside a try block
    const appendInTry = autoTickBody![0].match(/try\s*\{[\s\S]*?appendPrompt[\s\S]*?\}\s*catch/);
    expect(appendInTry).toBeTruthy();
  });
});
