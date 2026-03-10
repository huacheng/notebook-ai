/**
 * D6 tests: agent-process module constants
 */
import { describe, it, expect } from 'vitest';

describe('agent-process constants - D6', () => {
  it('should export AGENT_START_TIMEOUT_MS constant', async () => {
    const module = await import('../agent-process.js');
    expect(typeof (module as Record<string, unknown>).AGENT_START_TIMEOUT_MS).toBe('number');
    expect((module as Record<string, unknown>).AGENT_START_TIMEOUT_MS).toBe(60_000);
  });
});
