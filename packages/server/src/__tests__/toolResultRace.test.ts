/**
 * Tool result race condition tests.
 *
 * Bug: When Claude CLI emits `result` before the last `tool_result`,
 * findRunningCellId() returns null (cell already completed) and the
 * tool_result is silently dropped, leaving tool spinners stuck.
 *
 * Fix: Track _currentCellId on the session so tool_result can still
 * find the correct cell after completion.
 *
 * D1: Ephemeral tool outputs — regular tool_result (Read/Bash/etc.) is NOT
 * persisted to notebook, only broadcast. These tests verify broadcast works.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SessionManager } from '../session.js';
import { NotebookStore } from '../notebook-store.js';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

describe('tool_result after result (race condition)', () => {
  let sm: SessionManager;
  let ns: NotebookStore;
  let tempDir: string;
  let startSpy: ReturnType<typeof vi.spyOn>;
  let stopSpy: ReturnType<typeof vi.spyOn>;
  let sendPromptSpy: ReturnType<typeof vi.spyOn>;
  let onMessage: (msg: unknown) => void;

  beforeEach(async () => {
    sm = new SessionManager();
    ns = new NotebookStore();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-race-test-'));

    const { AgentProcess } = await import('../agent-process.js');
    startSpy = vi.spyOn(AgentProcess.prototype, 'start').mockImplementation(async (onMsg) => {
      onMessage = onMsg;
      onMsg({ type: 'system', subtype: 'hook_started' });
    });
    stopSpy = vi.spyOn(AgentProcess.prototype, 'stop').mockImplementation(async () => {});
    sendPromptSpy = vi.spyOn(AgentProcess.prototype, 'sendPrompt').mockImplementation(() => {});
  });

  afterEach(() => {
    startSpy.mockRestore();
    stopSpy.mockRestore();
    sendPromptSpy.mockRestore();
  });

  async function createSessionWithToolUse() {
    const nbPath = path.join(tempDir, 'test.notebook.json');
    await ns.save(nbPath, ns.createNew('Test', tempDir));

    const session = await sm.createSession(nbPath, tempDir);

    // Simulate: cell starts running, assistant emits a tool_use block
    session.notebook = {
      ...session.notebook,
      cells: [
        {
          id: 'c1',
          type: 'prompt' as const,
          source: 'read /etc/hostname',
          outputs: [
            {
              type: 'tool_use' as const,
              tool_use_id: 'tu-1',
              name: 'Read',
              input: { file_path: '/etc/hostname' },
            },
          ],
          execution_count: 1,
          status: 'running' as const,
        },
      ],
    };

    return session;
  }

  it('tool_result arriving after result still broadcasts to cell (ephemeral)', async () => {
    const session = await createSessionWithToolUse();
    const messages: any[] = [];
    session.listeners.add((msg: any) => messages.push(msg));

    // Step 1: `result` arrives first → cell completes
    onMessage({ type: 'result', result: 'done reading', is_error: false });

    // Cell should now be completed
    expect(session.notebook.cells[0].status).toBe('completed');

    // Step 2: `tool_result` arrives AFTER completion
    onMessage({
      type: 'user',
      message: {
        content: [{
          type: 'tool_result',
          tool_use_id: 'tu-1',
          content: 'my-hostname',
        }],
      },
    });

    // D1: Regular tool_result is NOT persisted to notebook (ephemeral)
    const cell = session.notebook.cells[0];
    expect(cell.type).toBe('prompt');
    const toolOutput = (cell as any).outputs[0];
    expect(toolOutput.type).toBe('tool_use');
    expect(toolOutput.result).toBeUndefined();  // NOT persisted

    // A tool_result WS message should still have been broadcast
    const toolResultMsg = messages.find((m: any) => m.type === 'tool_result');
    expect(toolResultMsg).toBeDefined();
    expect(toolResultMsg.tool_use_id).toBe('tu-1');
    expect(toolResultMsg.content).toBe('my-hostname');
    expect(toolResultMsg.cell_id).toBe('c1');  // Routed to correct cell
  });

  it('tool_result broadcasts correctly when cell is running (ephemeral)', async () => {
    const session = await createSessionWithToolUse();
    const messages: any[] = [];
    session.listeners.add((msg: any) => messages.push(msg));

    // tool_result arrives while cell is still running (normal case)
    onMessage({
      type: 'user',
      message: {
        content: [{
          type: 'tool_result',
          tool_use_id: 'tu-1',
          content: 'normal-result',
        }],
      },
    });

    // D1: Regular tool_result is NOT persisted to notebook (ephemeral)
    const cell = session.notebook.cells[0] as any;
    const toolOutput = cell.outputs[0];
    expect(toolOutput.type).toBe('tool_use');
    expect(toolOutput.result).toBeUndefined();  // NOT persisted

    // But it should be broadcast
    const toolResultMsg = messages.find((m: any) => m.type === 'tool_result');
    expect(toolResultMsg).toBeDefined();
    expect(toolResultMsg.content).toBe('normal-result');
  });

  it('late tool_result broadcast routes to correct cell by tool_use_id', async () => {
    const session = await createSessionWithToolUse();
    const messages: any[] = [];
    session.listeners.add((msg: any) => messages.push(msg));

    // Complete cell c1
    onMessage({ type: 'result', result: 'done', is_error: false });
    expect(session.notebook.cells[0].status).toBe('completed');

    // Start a new cell c2
    session.notebook = {
      ...session.notebook,
      cells: [
        ...session.notebook.cells,
        {
          id: 'c2',
          type: 'prompt' as const,
          source: 'next prompt',
          outputs: [
            {
              type: 'tool_use' as const,
              tool_use_id: 'tu-2',
              name: 'Bash',
              input: { command: 'ls' },
            },
          ],
          execution_count: 1,
          status: 'running' as const,
        },
      ],
    };

    // A stale tool_result for tu-1 should be broadcast with correct cell_id
    onMessage({
      type: 'user',
      message: {
        content: [{
          type: 'tool_result',
          tool_use_id: 'tu-1',
          content: 'late-result-for-c1',
        }],
      },
    });

    // D1: Regular tool_result is NOT persisted (ephemeral)
    const c1Tool = (session.notebook.cells[0] as any).outputs[0];
    expect(c1Tool.result).toBeUndefined();  // NOT persisted

    const c2Tool = (session.notebook.cells[1] as any).outputs[0];
    expect(c2Tool.result).toBeUndefined();  // NOT persisted

    // But broadcast should route to correct cell (c1, not c2)
    const toolResultMsg = messages.find((m: any) =>
      m.type === 'tool_result' && m.tool_use_id === 'tu-1'
    );
    expect(toolResultMsg).toBeDefined();
    expect(toolResultMsg.cell_id).toBe('c1');  // Routed to c1, not c2
    expect(toolResultMsg.content).toBe('late-result-for-c1');
  });
});
