import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'auto-wire-test-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('daemon-to-session recovery wiring', () => {
  it('sends recovery prompt to agent when compaction detected', async () => {
    const { TaskAutoDaemon } = await import('../task-ai/task-auto-daemon.js');
    const { wireDaemonToSession } = await import('../routes/task-auto.js');
    const taskDir = path.join(tmpDir, '.working');
    await mkdir(taskDir, { recursive: true });

    const daemon = new TaskAutoDaemon({
      sessionId: 'test-session',
      taskDir,
      maxIterations: 20,
      timeoutMinutes: 30,
    });

    // Mock session with sendPrompt
    const sendPrompt = vi.fn();
    const mockSession = {
      agentProcess: { sendPrompt, isAlive: () => true },
    };
    const mockSessionManager = {
      getSession: vi.fn().mockReturnValue(mockSession),
    };

    wireDaemonToSession(daemon, mockSessionManager as any);
    daemon.start();

    // Trigger compaction detection
    daemon.reportStreamActivity(
      'This session is being continued from a previous conversation that ran out of context.',
    );

    daemon.stop();

    expect(sendPrompt).toHaveBeenCalledTimes(1);
    expect(sendPrompt.mock.calls[0][0]).toContain('Context compacted');
  });

  it('sends stall recovery prompt to agent on idle stall', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });

    const { TaskAutoDaemon } = await import('../task-ai/task-auto-daemon.js');
    const { wireDaemonToSession } = await import('../routes/task-auto.js');
    const taskDir = path.join(tmpDir, '.working');
    await mkdir(taskDir, { recursive: true });

    const daemon = new TaskAutoDaemon({
      sessionId: 'test-session',
      taskDir,
      maxIterations: 20,
      timeoutMinutes: 30,
    });

    const sendPrompt = vi.fn();
    const mockSession = {
      agentProcess: { sendPrompt, isAlive: () => true },
    };
    const mockSessionManager = {
      getSession: vi.fn().mockReturnValue(mockSession),
    };

    wireDaemonToSession(daemon, mockSessionManager as any);
    daemon.start();

    // Report a continuation prompt then go idle
    daemon.reportStreamActivity('Do you want to Continue?');

    // 3 idle heartbeats → stall recovery
    vi.advanceTimersByTime(60_000 * 3);

    daemon.stop();
    vi.useRealTimers();

    expect(sendPrompt).toHaveBeenCalledTimes(1);
    expect(sendPrompt.mock.calls[0][0]).toBe('continue');
  });

  it('does not send if session not found', async () => {
    const { TaskAutoDaemon } = await import('../task-ai/task-auto-daemon.js');
    const { wireDaemonToSession } = await import('../routes/task-auto.js');
    const taskDir = path.join(tmpDir, '.working');
    await mkdir(taskDir, { recursive: true });

    const daemon = new TaskAutoDaemon({
      sessionId: 'nonexistent',
      taskDir,
      maxIterations: 20,
      timeoutMinutes: 30,
    });

    const mockSessionManager = {
      getSession: vi.fn().mockReturnValue(undefined),
    };

    wireDaemonToSession(daemon, mockSessionManager as any);
    daemon.start();

    // Should not throw even if session doesn't exist
    daemon.reportStreamActivity(
      'This session is being continued from a previous conversation that ran out of context.',
    );

    daemon.stop();

    // No crash, getSession was called
    expect(mockSessionManager.getSession).toHaveBeenCalledWith('nonexistent');
  });
});
