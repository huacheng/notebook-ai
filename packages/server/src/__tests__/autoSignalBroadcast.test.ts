/**
 * Test: task status is driven by .status.json, not .auto-signal.
 * Daemon does NOT broadcast auto_status — ws-handler watches .status.json directly.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Task status via .status.json (not .auto-signal)', () => {
  it('ws-handler watches .status.json and sends task_status messages', () => {
    const wsHandlerSrc = fs.readFileSync(
      path.resolve(__dirname, '../ws-handler.ts'), 'utf-8'
    );
    expect(wsHandlerSrc).toContain('.status.json');
    expect(wsHandlerSrc).toContain('task_status');
    expect(wsHandlerSrc).toContain('task_status_subscribe');
  });

  it('wireDaemonToSession does NOT listen for signal events', () => {
    const taskAutoSrc = fs.readFileSync(
      path.resolve(__dirname, '../routes/task-auto.ts'), 'utf-8'
    );
    // signal → auto_status broadcast was removed; .status.json handles it
    expect(taskAutoSrc).not.toContain("daemon.on('signal'");
  });

  it('Notebook renders PhaseProgressBar from taskStatus (not autoStatus)', () => {
    const notebookSrc = fs.readFileSync(
      path.resolve(__dirname, '../../../web/src/components/Notebook.tsx'), 'utf-8'
    );
    // PhaseProgressBar should use taskStatus, not autoStatus
    expect(notebookSrc).toMatch(/PhaseProgressBar[\s\S]*?taskStatus/);
    expect(notebookSrc).not.toMatch(/PhaseProgressBar[\s\S]*?autoStatus\.phase/);
  });
});
