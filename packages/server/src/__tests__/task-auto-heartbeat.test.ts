import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir } from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import os from 'os';
import path from 'path';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'auto-heartbeat-test-'));
  vi.useFakeTimers({ shouldAdvanceTime: false });
});

afterEach(async () => {
  vi.useRealTimers();
  await rm(tmpDir, { recursive: true, force: true });
});

describe('TaskAutoDaemon heartbeat & stall recovery', () => {
  it('reportStreamActivity updates last activity timestamp', async () => {
    const { TaskAutoDaemon } = await import('../task-ai/task-auto-daemon.js');
    const taskDir = path.join(tmpDir, '.working');
    await mkdir(taskDir, { recursive: true });

    const daemon = new TaskAutoDaemon({
      sessionId: 'test',
      taskDir,
      maxIterations: 20,
      timeoutMinutes: 30,
    });

    daemon.start();

    // reportStreamActivity should exist and update internal timestamp
    expect(typeof daemon.reportStreamActivity).toBe('function');
    daemon.reportStreamActivity();

    daemon.stop();
  });

  it('emits stall-recovery after 3 consecutive idle heartbeats', async () => {
    const { TaskAutoDaemon } = await import('../task-ai/task-auto-daemon.js');
    const taskDir = path.join(tmpDir, '.working');
    await mkdir(taskDir, { recursive: true });

    const daemon = new TaskAutoDaemon({
      sessionId: 'test',
      taskDir,
      maxIterations: 20,
      timeoutMinutes: 30,
    });

    const recoveries: any[] = [];
    daemon.on('stall-recovery', (action: any) => recoveries.push(action));

    daemon.start();
    // No stream activity — advance 3 heartbeat intervals (3 * 60s)
    vi.advanceTimersByTime(60_000); // poll 1
    vi.advanceTimersByTime(60_000); // poll 2
    vi.advanceTimersByTime(60_000); // poll 3

    daemon.stop();

    expect(recoveries.length).toBeGreaterThanOrEqual(1);
    expect(recoveries[0].type).toBe('idle');
  });

  it('resets stall count when stream activity is reported', async () => {
    const { TaskAutoDaemon } = await import('../task-ai/task-auto-daemon.js');
    const taskDir = path.join(tmpDir, '.working');
    await mkdir(taskDir, { recursive: true });

    const daemon = new TaskAutoDaemon({
      sessionId: 'test',
      taskDir,
      maxIterations: 20,
      timeoutMinutes: 30,
    });

    const recoveries: any[] = [];
    daemon.on('stall-recovery', (action: any) => recoveries.push(action));

    daemon.start();

    // 2 idle heartbeats
    vi.advanceTimersByTime(60_000);
    vi.advanceTimersByTime(60_000);

    // Activity resets the counter
    daemon.reportStreamActivity();

    // 2 more idle heartbeats — still under threshold
    vi.advanceTimersByTime(60_000);
    vi.advanceTimersByTime(60_000);

    daemon.stop();

    // Should NOT have emitted stall-recovery (never hit 3 consecutive)
    expect(recoveries.length).toBe(0);
  });

  it('detects continuation prompt pattern in last message', async () => {
    const { TaskAutoDaemon } = await import('../task-ai/task-auto-daemon.js');
    const taskDir = path.join(tmpDir, '.working');
    await mkdir(taskDir, { recursive: true });

    const daemon = new TaskAutoDaemon({
      sessionId: 'test',
      taskDir,
      maxIterations: 20,
      timeoutMinutes: 30,
    });

    const recoveries: any[] = [];
    daemon.on('stall-recovery', (action: any) => recoveries.push(action));

    daemon.start();

    // Report a message that looks like a continuation prompt
    daemon.reportStreamActivity('Do you want to Continue? Press enter to proceed.');

    // 3 idle heartbeats to trigger stall detection
    vi.advanceTimersByTime(60_000);
    vi.advanceTimersByTime(60_000);
    vi.advanceTimersByTime(60_000);

    daemon.stop();

    expect(recoveries.length).toBeGreaterThanOrEqual(1);
    expect(recoveries[0].pattern).toBe('continuation');
    expect(recoveries[0].message).toContain('continue');
  });

  it('detects y/n prompt pattern', async () => {
    const { TaskAutoDaemon } = await import('../task-ai/task-auto-daemon.js');
    const taskDir = path.join(tmpDir, '.working');
    await mkdir(taskDir, { recursive: true });

    const daemon = new TaskAutoDaemon({
      sessionId: 'test',
      taskDir,
      maxIterations: 20,
      timeoutMinutes: 30,
    });

    const recoveries: any[] = [];
    daemon.on('stall-recovery', (action: any) => recoveries.push(action));

    daemon.start();
    daemon.reportStreamActivity('Would you like to apply these changes? (y/n)');

    vi.advanceTimersByTime(60_000 * 3);

    daemon.stop();

    expect(recoveries.length).toBeGreaterThanOrEqual(1);
    expect(recoveries[0].pattern).toBe('yesno');
    expect(recoveries[0].message).toBe('y');
  });

  it('detects quota exhaustion and emits quota-wait instead of stall', async () => {
    const { TaskAutoDaemon } = await import('../task-ai/task-auto-daemon.js');
    const taskDir = path.join(tmpDir, '.working');
    await mkdir(taskDir, { recursive: true });

    const daemon = new TaskAutoDaemon({
      sessionId: 'test',
      taskDir,
      maxIterations: 20,
      timeoutMinutes: 30,
    });

    const recoveries: any[] = [];
    const quotaEvents: any[] = [];
    daemon.on('stall-recovery', (action: any) => recoveries.push(action));
    daemon.on('quota-wait', (info: any) => quotaEvents.push(info));

    daemon.start();
    daemon.reportStreamActivity('Error: rate limit exceeded. Please try again later.');

    vi.advanceTimersByTime(60_000 * 3);

    daemon.stop();

    // Quota exhaustion is NOT a stall
    expect(recoveries.length).toBe(0);
    expect(quotaEvents.length).toBeGreaterThanOrEqual(1);
  });

  it('detects output deduplication (3 identical consecutive hashes)', async () => {
    const { TaskAutoDaemon } = await import('../task-ai/task-auto-daemon.js');
    const taskDir = path.join(tmpDir, '.working');
    await mkdir(taskDir, { recursive: true });

    const daemon = new TaskAutoDaemon({
      sessionId: 'test',
      taskDir,
      maxIterations: 20,
      timeoutMinutes: 30,
    });

    const recoveries: any[] = [];
    daemon.on('stall-recovery', (action: any) => recoveries.push(action));

    daemon.start();

    // Send 3 identical messages
    daemon.reportStreamActivity('I will now proceed to implement the feature.');
    daemon.reportStreamActivity('I will now proceed to implement the feature.');
    daemon.reportStreamActivity('I will now proceed to implement the feature.');

    daemon.stop();

    expect(recoveries.length).toBeGreaterThanOrEqual(1);
    expect(recoveries[0].type).toBe('dedup');
  });

  it('writes .auto-stop after exceeding max recovery per iteration (3)', async () => {
    const { TaskAutoDaemon } = await import('../task-ai/task-auto-daemon.js');
    const taskDir = path.join(tmpDir, '.working');
    await mkdir(taskDir, { recursive: true });

    const daemon = new TaskAutoDaemon({
      sessionId: 'test',
      taskDir,
      maxIterations: 20,
      timeoutMinutes: 30,
    });

    daemon.start();

    // Trigger 4 stall recoveries (exceed limit of 3 per iteration)
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(60_000 * 3); // 3 idle heartbeats each round
    }

    daemon.stop();

    const stopFile = path.join(taskDir, '.auto-stop');
    expect(existsSync(stopFile)).toBe(true);
    const stopData = JSON.parse(readFileSync(stopFile, 'utf-8'));
    expect(stopData.reason).toBe('stall_limit');
  });

  it('tracks total recovery count across multiple stall cycles', async () => {
    const { TaskAutoDaemon } = await import('../task-ai/task-auto-daemon.js');
    const taskDir = path.join(tmpDir, '.working');
    await mkdir(taskDir, { recursive: true });

    const daemon = new TaskAutoDaemon({
      sessionId: 'test',
      taskDir,
      maxIterations: 20,
      timeoutMinutes: 0,
    });

    const recoveries: any[] = [];
    const completions: string[] = [];
    daemon.on('stall-recovery', (action: any) => recoveries.push(action));
    daemon.on('complete', (reason: string) => completions.push(reason));

    daemon.start();

    // Per-iteration limit is 3, so after 3 recoveries + 1 attempt = stall_limit
    // The 4th handleStall call writes .auto-stop
    // We get at most 3 recoveries before the daemon auto-stops
    vi.advanceTimersByTime(60_000 * 3); // stall 1
    vi.advanceTimersByTime(60_000 * 3); // stall 2
    vi.advanceTimersByTime(60_000 * 3); // stall 3
    vi.advanceTimersByTime(60_000 * 3); // stall 4 → exceeds per-iteration limit

    daemon.stop();

    // 3 recoveries emitted before limit hit
    expect(recoveries.length).toBe(3);
    // Daemon reported stall_limit completion
    expect(completions).toContain('stall_limit');

    const stopFile = path.join(taskDir, '.auto-stop');
    expect(existsSync(stopFile)).toBe(true);
    const stopData = JSON.parse(readFileSync(stopFile, 'utf-8'));
    expect(stopData.reason).toBe('stall_limit');
  });

  it('heartbeat timer is cleaned up on stop', async () => {
    const { TaskAutoDaemon } = await import('../task-ai/task-auto-daemon.js');
    const taskDir = path.join(tmpDir, '.working');
    await mkdir(taskDir, { recursive: true });

    const daemon = new TaskAutoDaemon({
      sessionId: 'test',
      taskDir,
      maxIterations: 20,
      timeoutMinutes: 30,
    });

    const recoveries: any[] = [];
    daemon.on('stall-recovery', (action: any) => recoveries.push(action));

    daemon.start();
    daemon.stop();

    // After stop, advancing timers should NOT emit events
    vi.advanceTimersByTime(60_000 * 5);

    expect(recoveries.length).toBe(0);
  });
});

describe('TaskAutoDaemon quota-wait mode', () => {
  it('suspends timeout during quota-wait and resumes after', async () => {
    const { TaskAutoDaemon } = await import('../task-ai/task-auto-daemon.js');
    const taskDir = path.join(tmpDir, '.working');
    await mkdir(taskDir, { recursive: true });

    const daemon = new TaskAutoDaemon({
      sessionId: 'test',
      taskDir,
      maxIterations: 20,
      timeoutMinutes: 5, // 5 minute timeout
    });

    const completions: string[] = [];
    daemon.on('complete', (reason: string) => completions.push(reason));

    daemon.start();

    // At 2 minutes, enter quota-wait
    vi.advanceTimersByTime(2 * 60_000);
    daemon.reportStreamActivity('Error: rate limit exceeded. Please try again later.');

    // Wait 10 minutes in quota-wait (should NOT trigger timeout)
    vi.advanceTimersByTime(10 * 60_000);
    expect(completions.length).toBe(0); // No timeout yet

    // Exit quota-wait with normal activity
    daemon.reportStreamActivity('Resuming operation...');

    // Now 3 more minutes should trigger the timeout (2 + 3 = 5 minutes active)
    vi.advanceTimersByTime(3 * 60_000);

    daemon.stop();

    expect(completions).toContain('timeout');
  });

  it('does not trigger stall detection during quota-wait', async () => {
    const { TaskAutoDaemon } = await import('../task-ai/task-auto-daemon.js');
    const taskDir = path.join(tmpDir, '.working');
    await mkdir(taskDir, { recursive: true });

    const daemon = new TaskAutoDaemon({
      sessionId: 'test',
      taskDir,
      maxIterations: 20,
      timeoutMinutes: 30,
    });

    const recoveries: any[] = [];
    daemon.on('stall-recovery', (action: any) => recoveries.push(action));

    daemon.start();

    // Enter quota-wait
    daemon.reportStreamActivity('quota exceeded, try again later');

    // 5 minutes of idle — normally would trigger stall, but we're in quota-wait
    vi.advanceTimersByTime(5 * 60_000);

    daemon.stop();

    expect(recoveries.length).toBe(0);
  });

  it('exits quota-wait when non-quota message arrives', async () => {
    const { TaskAutoDaemon } = await import('../task-ai/task-auto-daemon.js');
    const taskDir = path.join(tmpDir, '.working');
    await mkdir(taskDir, { recursive: true });

    const daemon = new TaskAutoDaemon({
      sessionId: 'test',
      taskDir,
      maxIterations: 20,
      timeoutMinutes: 30,
    });

    const quotaEvents: any[] = [];
    const recoveries: any[] = [];
    daemon.on('quota-wait', (info: any) => quotaEvents.push(info));
    daemon.on('stall-recovery', (action: any) => recoveries.push(action));

    daemon.start();

    // Enter quota-wait
    daemon.reportStreamActivity('rate limit exceeded');
    expect(quotaEvents.length).toBe(1);

    // Exit quota-wait with normal message
    daemon.reportStreamActivity('OK, proceeding with implementation');

    // Now stall detection should work again — 3 idle heartbeats
    vi.advanceTimersByTime(60_000 * 3);

    daemon.stop();

    expect(recoveries.length).toBeGreaterThanOrEqual(1);
  });
});

describe('TaskAutoDaemon compaction detection', () => {
  it('emits compaction-recovery when system compaction is detected', async () => {
    const { TaskAutoDaemon } = await import('../task-ai/task-auto-daemon.js');
    const taskDir = path.join(tmpDir, '.working');
    await mkdir(taskDir, { recursive: true });

    const daemon = new TaskAutoDaemon({
      sessionId: 'test',
      taskDir,
      maxIterations: 20,
      timeoutMinutes: 30,
    });

    const compactionEvents: any[] = [];
    daemon.on('compaction-recovery', (signal: any) => compactionEvents.push(signal));

    daemon.start();

    // Report a message that indicates system compaction
    daemon.reportStreamActivity(
      'This session is being continued from a previous conversation that ran out of context.',
    );

    daemon.stop();

    expect(compactionEvents.length).toBe(1);
    expect(compactionEvents[0].type).toBe('human');
    expect(compactionEvents[0].message).toContain('Context compacted');
    expect(compactionEvents[0].message).toContain('.auto-signal');
  });

  it('does not emit compaction-recovery for normal messages', async () => {
    const { TaskAutoDaemon } = await import('../task-ai/task-auto-daemon.js');
    const taskDir = path.join(tmpDir, '.working');
    await mkdir(taskDir, { recursive: true });

    const daemon = new TaskAutoDaemon({
      sessionId: 'test',
      taskDir,
      maxIterations: 20,
      timeoutMinutes: 30,
    });

    const compactionEvents: any[] = [];
    daemon.on('compaction-recovery', (signal: any) => compactionEvents.push(signal));

    daemon.start();
    daemon.reportStreamActivity('All tests pass. Moving to next step.');
    daemon.stop();

    expect(compactionEvents.length).toBe(0);
  });
});
