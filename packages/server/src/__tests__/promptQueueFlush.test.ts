import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('Prompt Queue Flush on Close', () => {
  const sessionSrc = () => readFileSync(
    path.resolve(__dirname, '../session.ts'),
    'utf-8'
  );

  it('should call _saveQueue.flush() in closeSession', () => {
    const src = sessionSrc();
    // closeSession should flush the queue before closing
    expect(src).toMatch(/closeSession[\s\S]*?_saveQueue\.flush\(\)/);
  });

  it('should await flush before stopping agent', () => {
    const src = sessionSrc();
    // flush should be awaited before agentProcess.stop()
    const closeSessionMatch = src.match(/async closeSession[\s\S]*?agentProcess\.stop\(\)/);
    expect(closeSessionMatch).toBeTruthy();
    expect(closeSessionMatch![0]).toContain('await');
    expect(closeSessionMatch![0]).toContain('flush');
  });
});

describe('Prompt Queue Constants', () => {
  const sessionSrc = () => readFileSync(
    path.resolve(__dirname, '../session.ts'),
    'utf-8'
  );

  it('should have constant for base64 to bytes ratio', () => {
    const src = sessionSrc();
    expect(src).toMatch(/BASE64_TO_BYTES_RATIO/);
  });

  it('should use the constant instead of magic number 0.75', () => {
    const src = sessionSrc();
    // Should not have bare 0.75 for image size calculation
    expect(src).not.toMatch(/img\.data\.length\s*\*\s*0\.75/);
  });
});

describe('Prompt Queue Execute Retry', () => {
  const sessionSrc = () => readFileSync(
    path.resolve(__dirname, '../session.ts'),
    'utf-8'
  );

  it('should have retry logic or error notification in processNextQueueItem', () => {
    const src = sessionSrc();
    // Should either retry or broadcast error when executeCell fails
    const processNextMatch = src.match(/processNextQueueItem[\s\S]*?catch[\s\S]*?\{[\s\S]*?\}/);
    expect(processNextMatch).toBeTruthy();
    // Should have more than just console.error
    expect(processNextMatch![0]).toMatch(/broadcast|setTimeout|retry/i);
  });
});
