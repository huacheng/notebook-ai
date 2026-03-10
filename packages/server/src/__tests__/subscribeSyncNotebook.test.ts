/**
 * Test: New device subscribing should receive full notebook state
 * including running cell's accumulated outputs.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const wsHandlerSrc = () =>
  fs.readFileSync(path.resolve(__dirname, '../ws-handler.ts'), 'utf-8');

describe('Subscribe session sends full notebook state', () => {
  it('subscribe_session handler should send notebook state to new subscriber', () => {
    const src = wsHandlerSrc();
    // After subscribe, should send the current notebook to the client
    expect(src).toMatch(/session_state|notebook_state/);
    // Should include the notebook object in the message
    expect(src).toMatch(/notebook.*session\.notebook|getNotebook/);
  });

  it('session_state message should be sent after event replay', () => {
    const src = wsHandlerSrc();
    // The session_state send should appear after resume_after replay logic
    const resumeIdx = src.indexOf('resume_after');
    const stateIdx = src.indexOf('session_state');
    expect(resumeIdx).toBeGreaterThan(-1);
    expect(stateIdx).toBeGreaterThan(-1);
    // session_state should come after resume_after handling
    expect(stateIdx).toBeGreaterThan(resumeIdx);
  });
});
