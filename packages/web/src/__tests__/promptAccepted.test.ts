/**
 * Test: Backend should broadcast prompt_accepted after writing to stdin,
 * and frontend should track acceptance to show two-phase status.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('prompt_accepted signal', () => {
  it('backend should broadcast prompt_accepted after sendPrompt', () => {
    const src = readFileSync(
      resolve(__dirname, '../../../server/src/session.ts'), 'utf-8'
    );
    // After sendPrompt call, there should be a prompt_accepted broadcast
    const execIdx = src.indexOf('async executeCell');
    const execBlock = src.slice(execIdx, execIdx + 5000);
    expect(execBlock).toContain('prompt_accepted');
  });

  it('frontend wsSlice should handle prompt_accepted message', () => {
    const src = readFileSync(
      resolve(__dirname, '../store/wsSlice.ts'), 'utf-8'
    );
    expect(src).toContain("'prompt_accepted'");
  });

  it('RunningStatus should show Sending before prompt is accepted', () => {
    const src = readFileSync(
      resolve(__dirname, '../utils/runningStatus.ts'), 'utf-8'
    );
    expect(src).toMatch(/sending/i);
  });
});
