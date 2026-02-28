/**
 * User tool_result message handling — TDD Red phase.
 *
 * Bug: Claude CLI `--output-format stream-json` sends tool results as
 * `{ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id, content }] } }`
 * instead of top-level `{ type: 'tool_result', ... }`. The current
 * handleJsonlMessage() never matches these, leaving tool spinners stuck.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SessionManager } from '../session.js';
import { NotebookStore } from '../notebook-store.js';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

describe('user message with tool_result blocks', () => {
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
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'user-tool-result-test-'));

    const { AgentProcess } = await import('../agent-process.js');
    startSpy = vi.spyOn(AgentProcess.prototype, 'start').mockImplementation(async (onMsg) => {
      onMessage = onMsg;
      onMsg({ type: 'system', subtype: 'hook_started' });
    });
    stopSpy = vi.spyOn(AgentProcess.prototype, 'stop').mockImplementation(() => {});
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

  it('attaches result from user message tool_result block', async () => {
    const session = await createSessionWithToolUse();

    // Claude CLI sends tool results wrapped in a user message
    onMessage({
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu-1',
            content: 'my-hostname',
          },
        ],
      },
    });

    const cell = session.notebook.cells[0] as any;
    const toolOutput = cell.outputs[0];
    expect(toolOutput.type).toBe('tool_use');
    expect(toolOutput.result).toBe('my-hostname');
  });

  it('broadcasts tool_result to frontend listeners', async () => {
    const session = await createSessionWithToolUse();
    const messages: any[] = [];
    session.listeners.add((msg: any) => messages.push(msg));

    onMessage({
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu-1',
            content: 'hostname-result',
          },
        ],
      },
    });

    const toolResultMsg = messages.find((m: any) => m.type === 'tool_result');
    expect(toolResultMsg).toBeDefined();
    expect(toolResultMsg.tool_use_id).toBe('tu-1');
    expect(toolResultMsg.content).toBe('hostname-result');
    expect(toolResultMsg.cell_id).toBe('c1');
  });

  it('extracts text from array content blocks', async () => {
    const session = await createSessionWithToolUse();

    onMessage({
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu-1',
            content: [
              { type: 'text', text: 'line 1\n' },
              { type: 'text', text: 'line 2' },
            ],
          },
        ],
      },
    });

    const cell = session.notebook.cells[0] as any;
    expect(cell.outputs[0].result).toBe('line 1\nline 2');
  });

  it('propagates is_error flag from tool_result block', async () => {
    const session = await createSessionWithToolUse();

    onMessage({
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu-1',
            content: 'file not found',
            is_error: true,
          },
        ],
      },
    });

    const cell = session.notebook.cells[0] as any;
    expect(cell.outputs[0].result).toBe('file not found');
    expect(cell.outputs[0].is_error).toBe(true);
  });

  it('handles multiple tool_result blocks in one user message', async () => {
    const session = await createSessionWithToolUse();

    // Add a second tool_use output
    session.notebook = {
      ...session.notebook,
      cells: [
        {
          ...session.notebook.cells[0],
          outputs: [
            ...(session.notebook.cells[0] as any).outputs,
            {
              type: 'tool_use' as const,
              tool_use_id: 'tu-2',
              name: 'Bash',
              input: { command: 'ls' },
            },
          ],
        } as any,
      ],
    };

    onMessage({
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu-1',
            content: 'result-1',
          },
          {
            type: 'tool_result',
            tool_use_id: 'tu-2',
            content: 'result-2',
          },
        ],
      },
    });

    const cell = session.notebook.cells[0] as any;
    expect(cell.outputs[0].result).toBe('result-1');
    expect(cell.outputs[1].result).toBe('result-2');
  });
});
