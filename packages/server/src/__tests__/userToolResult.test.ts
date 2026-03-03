/**
 * User tool_result message handling.
 *
 * Bug: Claude CLI `--output-format stream-json` sends tool results as
 * `{ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id, content }] } }`
 * instead of top-level `{ type: 'tool_result', ... }`. The current
 * handleJsonlMessage() never matches these, leaving tool spinners stuck.
 *
 * D1: Ephemeral tool outputs — regular tool_result (Read/Bash/etc.) is NOT
 * persisted to notebook, only broadcast. AskUserQuestion results ARE persisted.
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

  it('does NOT persist result for regular tool (Read) - ephemeral', async () => {
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

    // D1: Regular tool results are NOT persisted to notebook
    const cell = session.notebook.cells[0] as any;
    const toolOutput = cell.outputs[0];
    expect(toolOutput.type).toBe('tool_use');
    expect(toolOutput.result).toBeUndefined();
  });

  it('DOES persist result for AskUserQuestion tool', async () => {
    const session = await createSessionWithToolUse();

    // Replace tool_use with AskUserQuestion and register it as persisted
    session.notebook.cells[0] = {
      ...session.notebook.cells[0],
      outputs: [
        {
          type: 'tool_use' as const,
          tool_use_id: 'tu-ask',
          name: 'AskUserQuestion',
          input: { questions: [{ question: 'Which option?' }] },
        },
      ],
    } as any;
    // Simulate that tool_use was persisted (session tracks this)
    session._persistedToolUseIds.add('tu-ask');

    onMessage({
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu-ask',
            content: 'Option A',
          },
        ],
      },
    });

    // AskUserQuestion results MUST be persisted (user choice survives reload)
    const cell = session.notebook.cells[0] as any;
    const toolOutput = cell.outputs[0];
    expect(toolOutput.type).toBe('tool_use');
    expect(toolOutput.result).toBe('Option A');
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

  it('extracts text from array content blocks (AskUserQuestion)', async () => {
    const session = await createSessionWithToolUse();

    // Use AskUserQuestion to test array content extraction
    session.notebook.cells[0] = {
      ...session.notebook.cells[0],
      outputs: [
        {
          type: 'tool_use' as const,
          tool_use_id: 'tu-ask-arr',
          name: 'AskUserQuestion',
          input: { questions: [] },
        },
      ],
    } as any;
    session._persistedToolUseIds.add('tu-ask-arr');

    onMessage({
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu-ask-arr',
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

  it('propagates is_error flag from tool_result block (AskUserQuestion)', async () => {
    const session = await createSessionWithToolUse();

    session.notebook.cells[0] = {
      ...session.notebook.cells[0],
      outputs: [
        {
          type: 'tool_use' as const,
          tool_use_id: 'tu-ask-err',
          name: 'AskUserQuestion',
          input: { questions: [] },
        },
      ],
    } as any;
    session._persistedToolUseIds.add('tu-ask-err');

    onMessage({
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu-ask-err',
            content: 'user cancelled',
            is_error: true,
          },
        ],
      },
    });

    const cell = session.notebook.cells[0] as any;
    expect(cell.outputs[0].result).toBe('user cancelled');
    expect(cell.outputs[0].is_error).toBe(true);
  });

  it('handles multiple tool_result blocks - only persists AskUserQuestion', async () => {
    const session = await createSessionWithToolUse();
    const messages: any[] = [];
    session.listeners.add((msg: any) => messages.push(msg));

    // In new behavior: only AskUserQuestion tool_use is in notebook
    // (Read tool_use is ephemeral - only broadcast, not persisted)
    session.notebook = {
      ...session.notebook,
      cells: [
        {
          ...session.notebook.cells[0],
          outputs: [
            {
              type: 'tool_use' as const,
              tool_use_id: 'tu-ask-multi',
              name: 'AskUserQuestion',
              input: { questions: [] },
            },
          ],
        } as any,
      ],
    };
    // AskUserQuestion is tracked as persisted
    session._persistedToolUseIds.add('tu-ask-multi');

    onMessage({
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu-read',  // Not in notebook, not in _persistedToolUseIds
            content: 'result-read',
          },
          {
            type: 'tool_result',
            tool_use_id: 'tu-ask-multi',
            content: 'result-ask',
          },
        ],
      },
    });

    // Verify: Read tool_result was broadcast but not persisted
    const readBroadcast = messages.find(
      (m: any) => m.type === 'tool_result' && m.tool_use_id === 'tu-read'
    );
    expect(readBroadcast).toBeDefined();
    expect(readBroadcast.content).toBe('result-read');

    // Verify: AskUserQuestion tool_result was both broadcast and persisted
    const askBroadcast = messages.find(
      (m: any) => m.type === 'tool_result' && m.tool_use_id === 'tu-ask-multi'
    );
    expect(askBroadcast).toBeDefined();
    expect(askBroadcast.content).toBe('result-ask');

    // Verify notebook persistence
    const cell = session.notebook.cells[0] as any;
    expect(cell.outputs.length).toBe(1); // Only AskUserQuestion
    expect(cell.outputs[0].tool_use_id).toBe('tu-ask-multi');
    expect(cell.outputs[0].result).toBe('result-ask');
  });
});
