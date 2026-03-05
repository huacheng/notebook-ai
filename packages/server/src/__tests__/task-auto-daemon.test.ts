import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import os from 'os';
import path from 'path';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'auto-daemon-test-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('TaskAutoDaemon', () => {
  it('can be imported', async () => {
    const mod = await import('../task-ai/task-auto-daemon.js');
    expect(mod.TaskAutoDaemon).toBeDefined();
  });

  it('starts monitoring and creates initial state', async () => {
    const { TaskAutoDaemon } = await import('../task-ai/task-auto-daemon.js');
    const taskDir = path.join(tmpDir, '.working');
    await mkdir(taskDir, { recursive: true });

    const daemon = new TaskAutoDaemon({
      sessionId: 'test-session',
      taskDir,
      maxIterations: 5,
      timeoutMinutes: 10,
    });

    expect(daemon.sessionId).toBe('test-session');
    expect(daemon.status).toBe('idle');

    daemon.start();
    expect(daemon.status).toBe('running');

    daemon.stop();
    expect(daemon.status).toBe('stopped');
  });

  it('detects .auto-signal changes via polling', async () => {
    const { TaskAutoDaemon } = await import('../task-ai/task-auto-daemon.js');
    const taskDir = path.join(tmpDir, '.working');
    await mkdir(taskDir, { recursive: true });

    const daemon = new TaskAutoDaemon({
      sessionId: 'test-session',
      taskDir,
      maxIterations: 20,
      timeoutMinutes: 30,
    });

    const events: any[] = [];
    daemon.on('signal', (signal: any) => events.push(signal));

    daemon.start();

    // Write a signal file
    await writeFile(
      path.join(taskDir, '.auto-signal'),
      JSON.stringify({
        step: 'plan',
        result: '(generated)',
        next: 'check',
        iteration: 1,
        phase: 'planning',
        phase_progress: 0.5,
        check_score: null,
        retry_count: 0,
        delegation_failures: [],
        timestamp: new Date().toISOString(),
      }),
    );

    // Wait for fs.watch to fire
    await new Promise((r) => setTimeout(r, 200));

    daemon.stop();

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].step).toBe('plan');
    expect(events[0].iteration).toBe(1);
  });

  it('writes .auto-stop when max iterations exceeded', async () => {
    const { TaskAutoDaemon } = await import('../task-ai/task-auto-daemon.js');
    const taskDir = path.join(tmpDir, '.working');
    await mkdir(taskDir, { recursive: true });

    const daemon = new TaskAutoDaemon({
      sessionId: 'test-session',
      taskDir,
      maxIterations: 3,
      timeoutMinutes: 30,
    });

    daemon.start();

    // Write signal with iteration >= maxIterations
    await writeFile(
      path.join(taskDir, '.auto-signal'),
      JSON.stringify({
        step: 'exec',
        result: '(done)',
        next: 'verify',
        iteration: 3,
        phase: 'execution',
        phase_progress: 0.8,
        check_score: null,
        retry_count: 0,
        delegation_failures: [],
        timestamp: new Date().toISOString(),
      }),
    );

    await new Promise((r) => setTimeout(r, 200));

    daemon.stop();

    const stopFile = path.join(taskDir, '.auto-stop');
    expect(existsSync(stopFile)).toBe(true);
    const stopData = JSON.parse(await readFile(stopFile, 'utf-8'));
    expect(stopData.reason).toBe('max_iterations');
  });

  it('detects natural completion (next="(stop)")', async () => {
    const { TaskAutoDaemon } = await import('../task-ai/task-auto-daemon.js');
    const taskDir = path.join(tmpDir, '.working');
    await mkdir(taskDir, { recursive: true });

    const daemon = new TaskAutoDaemon({
      sessionId: 'test-session',
      taskDir,
      maxIterations: 20,
      timeoutMinutes: 30,
    });

    const completions: string[] = [];
    daemon.on('complete', (reason: string) => completions.push(reason));

    daemon.start();

    await writeFile(
      path.join(taskDir, '.auto-signal'),
      JSON.stringify({
        step: 'report',
        result: '(generated)',
        next: '(stop)',
        iteration: 5,
        phase: 'finalization',
        phase_progress: 1.0,
        check_score: null,
        retry_count: 0,
        delegation_failures: [],
        timestamp: new Date().toISOString(),
      }),
    );

    await new Promise((r) => setTimeout(r, 200));

    daemon.stop();

    expect(completions).toContain('natural');
  });

  it('emits signal events with validated fields', async () => {
    const { TaskAutoDaemon } = await import('../task-ai/task-auto-daemon.js');
    const taskDir = path.join(tmpDir, '.working');
    await mkdir(taskDir, { recursive: true });

    const daemon = new TaskAutoDaemon({
      sessionId: 'test-session',
      taskDir,
      maxIterations: 20,
      timeoutMinutes: 30,
    });

    const warnings: string[] = [];
    daemon.on('warning', (msg: string) => warnings.push(msg));

    daemon.start();

    // Write invalid signal (bad step value)
    await writeFile(
      path.join(taskDir, '.auto-signal'),
      JSON.stringify({
        step: 'INVALID_STEP',
        result: '(generated)',
        next: 'check',
        iteration: 1,
        phase: 'planning',
        timestamp: new Date().toISOString(),
      }),
    );

    await new Promise((r) => setTimeout(r, 200));

    daemon.stop();

    expect(warnings.length).toBeGreaterThanOrEqual(1);
    expect(warnings[0]).toContain('INVALID_STEP');
  });
});
