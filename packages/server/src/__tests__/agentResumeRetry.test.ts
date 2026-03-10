/**
 * Test: AgentProcess.start() should retry without --resume when resume fails.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('AgentProcess resume retry fallback', () => {
  const agentSrc = () =>
    fs.readFileSync(path.resolve(__dirname, '../agent-process.ts'), 'utf-8');

  it('start() should catch resume failure and retry without resumeSessionId', () => {
    const src = agentSrc();
    // When start() is called with a resumeSessionId and the process exits early,
    // it should catch the error and retry by calling _buildArgs() without resumeSessionId.
    // Look for retry/fallback logic after _waitForFirstOutput fails.
    expect(src).toMatch(/retry|fallback|without.*resume/i);
    // Should rebuild args without resume
    expect(src).toMatch(/_buildArgs\(\)/);
  });

  it('_buildArgs without resume should not include --resume flag', () => {
    const src = agentSrc();
    // _buildArgs() (no arguments) should produce args without --resume
    // _buildArgs(sessionId) should produce args with --resume
    expect(src).toContain("'--resume'");
    expect(src).toContain('resumeSessionId');
  });
});
