/**
 * @vitest-environment node
 *
 * Tests that AgentProcess.start() falls back to a fresh process (without --resume)
 * when the resume session fails — specifically when the process outputs an error
 * result line and then exits immediately (code 1).
 *
 * Bug: _waitForFirstOutput resolved on the error output line, so the catch-block
 * fallback (retry without --resume) never triggered, leaving a dead process.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { AgentProcess } from '../agent-process.js';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';

// We'll test _waitForFirstOutput behavior by mocking spawn
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

import { spawn } from 'child_process';
const mockSpawn = vi.mocked(spawn);

function createMockProcess() {
  const proc = new EventEmitter() as any;
  proc.stdin = { write: vi.fn(), end: vi.fn() };
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.exitCode = null;
  proc.killed = false;
  proc.kill = vi.fn(() => { proc.killed = true; });
  proc.pid = 12345;
  return proc;
}

describe('AgentProcess resume failure fallback', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should retry without --resume when process outputs error and exits quickly', async () => {
    const spawnCalls: string[][] = [];

    // First spawn: resume attempt — outputs error JSON then exits with code 1
    const failProc = createMockProcess();
    // Second spawn: fresh start — stays alive
    const freshProc = createMockProcess();

    let spawnCount = 0;
    mockSpawn.mockImplementation((_cmd: any, args: any, _opts: any) => {
      spawnCalls.push(args as string[]);
      spawnCount++;
      if (spawnCount === 1) {
        // First call: resume attempt
        // Simulate: output an error result line, then exit
        setTimeout(() => {
          failProc.stdout.write(
            JSON.stringify({ type: 'result', is_error: true, result: 'Session not found' }) + '\n'
          );
          // Process exits shortly after
          setTimeout(() => {
            failProc.exitCode = 1;
            failProc.emit('exit', 1);
          }, 50);
        }, 10);
        return failProc;
      } else {
        // Second call: fresh start — output a normal line and stay alive
        setTimeout(() => {
          freshProc.stdout.write(
            JSON.stringify({ type: 'system', subtype: 'hook_started', session_id: 'new-session' }) + '\n'
          );
        }, 10);
        return freshProc;
      }
    });

    const agent = new AgentProcess('claude', '/tmp');
    const messages: any[] = [];

    await agent.start(
      (msg) => messages.push(msg),
      undefined,
      'bad-resume-session-id',
    );

    // Should have spawned twice: once with --resume, once without
    expect(spawnCalls.length).toBe(2);
    expect(spawnCalls[0]).toContain('--resume');
    expect(spawnCalls[0]).toContain('bad-resume-session-id');
    expect(spawnCalls[1]).not.toContain('--resume');

    // Process should be alive (the fresh one)
    expect(agent.isAlive()).toBe(true);
  });

  it('should succeed normally when resume works (process stays alive)', async () => {
    const goodProc = createMockProcess();

    mockSpawn.mockReset();
    mockSpawn.mockImplementation(() => {
      setTimeout(() => {
        goodProc.stdout.write(
          JSON.stringify({ type: 'system', subtype: 'hook_started', session_id: 'good-session' }) + '\n'
        );
      }, 10);
      return goodProc;
    });

    const agent = new AgentProcess('claude', '/tmp');

    await agent.start(
      () => {},
      undefined,
      'good-resume-session-id',
    );

    // Should only spawn once — resume worked
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    expect(agent.isAlive()).toBe(true);
  });
});
