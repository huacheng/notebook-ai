/**
 * Test for session creation race condition.
 *
 * Bug: Multiple concurrent createSession calls for the same notebook
 * can bypass the idempotency check and create multiple sessions.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SessionManager } from '../session.js';
import * as AgentProcessModule from '../agent-process.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

// Mock AgentProcess to avoid actually spawning claude
vi.mock('../agent-process.js', async (importOriginal) => {
  const orig = await importOriginal<typeof AgentProcessModule>();
  return {
    ...orig,
    AgentProcess: class MockAgentProcess {
      engine: string;
      cwd: string;
      constructor(engine: string, cwd: string) {
        this.engine = engine;
        this.cwd = cwd;
      }
      async start() { /* mock: don't spawn */ }
      async stop() { /* mock */ }
      sendPrompt() { /* mock */ }
      interrupt() { /* mock */ }
    },
  };
});

describe('SessionManager createSession race condition', () => {
  let tempDir: string;
  let notebookPath: string;
  let sessionManager: SessionManager;

  beforeEach(async () => {
    // Create temp directory with notebook
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'session-race-test-'));
    notebookPath = path.join(tempDir, 'test.notebook.json');
    await fs.writeFile(notebookPath, JSON.stringify({
      version: 1,
      metadata: { title: 'Test', created: new Date().toISOString(), updated: new Date().toISOString() },
      cells: [],
      slide: { generated: false, sections: [] },
    }));

    sessionManager = new SessionManager();
  });

  afterEach(async () => {
    // Cleanup sessions
    for (const [id] of (sessionManager as any).sessions) {
      try {
        await sessionManager.closeSession(id);
      } catch { /* ignore */ }
    }
    // Cleanup temp dir
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  it('should not create multiple sessions when called concurrently', async () => {
    // Fire 5 concurrent createSession calls for the same notebook
    const promises = Array(5).fill(null).map(() =>
      sessionManager.createSession(notebookPath, tempDir)
    );

    const sessions = await Promise.all(promises);

    // All should return the same session instance
    const firstSession = sessions[0];
    for (let i = 1; i < sessions.length; i++) {
      expect(sessions[i]).toBe(firstSession);
    }

    // Only one session should exist
    const allSessions = (sessionManager as any).sessions;
    expect(allSessions.size).toBe(1);
  });

  it('should only create one AgentProcess for concurrent requests', async () => {
    // Fire concurrent requests
    const promises = Array(3).fill(null).map(() =>
      sessionManager.createSession(notebookPath, tempDir)
    );

    const sessions = await Promise.all(promises);

    // All sessions should have the same agentProcess instance
    const firstAgent = sessions[0].agentProcess;
    for (let i = 1; i < sessions.length; i++) {
      expect(sessions[i].agentProcess).toBe(firstAgent);
    }
  });
});
