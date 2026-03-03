/**
 * D6 tests: ws-handler module constants
 */
import { describe, it, expect } from 'vitest';

describe('ws-handler constants - D6', () => {
  it('should export MAX_DEVICES_PER_USER constant', async () => {
    const module = await import('../ws-handler.js');
    expect(typeof (module as Record<string, unknown>).MAX_DEVICES_PER_USER).toBe('number');
    expect((module as Record<string, unknown>).MAX_DEVICES_PER_USER).toBe(5);
  });

  it('should export MAX_WS_FILE_SIZE constant', async () => {
    const module = await import('../ws-handler.js');
    expect(typeof (module as Record<string, unknown>).MAX_WS_FILE_SIZE).toBe('number');
    expect((module as Record<string, unknown>).MAX_WS_FILE_SIZE).toBe(50 * 1024 * 1024);
  });

  it('should export EXEC_TIMEOUT constant', async () => {
    const module = await import('../ws-handler.js');
    expect(typeof (module as Record<string, unknown>).EXEC_TIMEOUT).toBe('number');
  });

  it('should export DEFAULT_GIT_LOG_LIMIT constant', async () => {
    const module = await import('../ws-handler.js');
    expect(typeof (module as Record<string, unknown>).DEFAULT_GIT_LOG_LIMIT).toBe('number');
    expect((module as Record<string, unknown>).DEFAULT_GIT_LOG_LIMIT).toBe(20);
  });
});
