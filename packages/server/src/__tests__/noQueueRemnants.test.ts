/**
 * Ensures no queue-related remnants remain in production source and test mocks.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('No queue remnants in codebase', () => {
  it('session.ts should not reference _promptQueue or _queueVersion', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../session.ts'), 'utf-8');
    expect(src).not.toContain('_promptQueue');
    expect(src).not.toContain('_queueVersion');
    expect(src).not.toContain('_saveQueue');
    expect(src).not.toContain('processNextQueueItem');
  });

  it('ws-handler.ts should not reference queue handlers', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../ws-handler.ts'), 'utf-8');
    expect(src).not.toContain('queue_state');
    expect(src).not.toContain('getQueueState');
  });

  it('interruptDeadProcess test mock should not have queue fields', () => {
    const src = fs.readFileSync(path.resolve(__dirname, 'interruptDeadProcess.test.ts'), 'utf-8');
    expect(src).not.toContain('_promptQueue');
    expect(src).not.toContain('_queueVersion');
  });
});
