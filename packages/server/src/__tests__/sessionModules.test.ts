import { describe, it, expect } from 'vitest';

describe('session module structure - D5', () => {
  it('should export SessionManager from session.js', async () => {
    const { SessionManager } = await import('../session.js');
    expect(SessionManager).toBeDefined();
    expect(typeof SessionManager).toBe('function');
  });

  it('SessionManager should have all expected methods', async () => {
    const { SessionManager } = await import('../session.js');
    const manager = new SessionManager();

    // Core methods
    expect(typeof manager.createSession).toBe('function');
    expect(typeof manager.getSession).toBe('function');
    expect(typeof manager.closeSession).toBe('function');
    expect(typeof manager.closeAllSessions).toBe('function');

    // Execution methods
    expect(typeof manager.executeCell).toBe('function');
    expect(typeof manager.interruptCell).toBe('function');
    expect(typeof manager.restartSession).toBe('function');
    expect(typeof manager.rerunNotebook).toBe('function');

    // Tool/model methods
    expect(typeof manager.submitToolResult).toBe('function');
    expect(typeof manager.changeModel).toBe('function');

    // Listener methods
    expect(typeof manager.addListener).toBe('function');
    expect(typeof manager.broadcastToSession).toBe('function');
  });

  it('should export getClaudeDefaultModel helper', async () => {
    const { getClaudeDefaultModel } = await import('../session.js');
    expect(getClaudeDefaultModel).toBeDefined();
    expect(typeof getClaudeDefaultModel).toBe('function');
  });
});
