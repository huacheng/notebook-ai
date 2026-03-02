import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const src = readFileSync(
  path.resolve(__dirname, '../url-capture.ts'),
  'utf-8',
);

/**
 * P1-4: Each url_capture request launches a full Chromium instance with no
 * concurrency control, which can exhaust memory.
 * Must have a semaphore limiting concurrent browser instances.
 */
describe('url_capture concurrency control (P1-4)', () => {
  it('should have a concurrency limit for browser launches', () => {
    // Must have some form of concurrency control: semaphore, queue, or pool
    const hasConcurrencyControl =
      /semaphore|Semaphore|concurrency|MAX_CONCURRENT|activeBrowsers|browserQueue/.test(src);
    expect(hasConcurrencyControl).toBe(true);
  });

  it('should acquire semaphore before chromium.launch', () => {
    const acquireIdx = src.search(/acquire|semaphore\.take|wait.*semaphore/i);
    const launchIdx = src.indexOf('chromium.launch');
    expect(acquireIdx).toBeGreaterThan(-1);
    expect(launchIdx).toBeGreaterThan(-1);
    expect(acquireIdx).toBeLessThan(launchIdx);
  });
});
