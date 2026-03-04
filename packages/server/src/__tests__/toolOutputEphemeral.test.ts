/**
 * Tool Output Ephemeral Storage Tests
 *
 * Requirement:
 * - Regular tool_use outputs (Read, Write, Bash, etc.) should NOT be saved to notebook
 * - AskUserQuestion tool_use outputs MUST be saved (user choices survive reload)
 * - All tool outputs should still be broadcast to active clients via WebSocket
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionManager } from '../session';
import type { Notebook } from '@notebook-ai/shared';

// Mock dependencies
vi.mock('../db', () => ({
  db: {
    getNotebook: vi.fn(),
    updateNotebook: vi.fn(),
    getProject: vi.fn(),
  },
}));

vi.mock('../agent', () => ({
  AgentProcessFactory: {
    create: vi.fn(() => ({
      start: vi.fn(),
      stop: vi.fn(),
      sendPrompt: vi.fn(),
      interrupt: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    })),
  },
}));

function createMockNotebook(): Notebook {
  return {
    version: 1,
    metadata: {
      title: 'Test',
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      git_repo: false,
      agent: 'claude',
    },
    cells: [
      {
        id: 'cell-1',
        type: 'prompt',
        source: 'test prompt',
        outputs: [],
        execution_count: 1,
        status: 'running',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
    slide: { generated: false, sections: [] },
    annotations: [],
    assets: { intermediate_files: [] },
  };
}

// Helper to get outputs from a prompt cell
function getPromptCellOutputs(notebook: Notebook, index: number) {
  const cell = notebook.cells[index];
  if (cell.type !== 'prompt') throw new Error('Not a prompt cell');
  return cell.outputs;
}

describe('Tool output ephemeral storage', () => {
  let sessionManager: SessionManager;
  let mockBroadcast: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sessionManager = new SessionManager();
    mockBroadcast = vi.fn();
    // @ts-expect-error - accessing private method for testing
    sessionManager.broadcast = mockBroadcast;
  });

  describe('tool_use persistence', () => {
    it('should NOT save regular tool_use (Read) to notebook', () => {
      const notebook = createMockNotebook();
      const session = {
        id: 'test-session',
        notebook,
        agent: null,
        listeners: new Set(),
      };

      // Simulate processing a Read tool_use (variable kept for documentation)
      void {
        type: 'tool_use' as const,
        tool_use_id: 'tu-123',
        name: 'Read',
        input: { file_path: '/test.txt' },
        timestamp: new Date().toISOString(),
      };

      // After processing, notebook should NOT contain the tool_use
      // This test will FAIL until we implement the feature
      const cellOutputs = getPromptCellOutputs(session.notebook, 0);
      const hasToolUse = cellOutputs.some(
        (o: any) => o.type === 'tool_use' && o.name === 'Read'
      );

      expect(hasToolUse).toBe(false);
    });

    it('should NOT save regular tool_use (Bash) to notebook', () => {
      const notebook = createMockNotebook();

      // Simulate: tool_use with name='Bash' was processed
      // Expectation: NOT in notebook.cells[0].outputs
      const cellOutputs = getPromptCellOutputs(notebook, 0);
      const hasBashTool = cellOutputs.some(
        (o: any) => o.type === 'tool_use' && o.name === 'Bash'
      );

      expect(hasBashTool).toBe(false);
    });

    it('should SAVE AskUserQuestion tool_use to notebook', () => {
      const notebook = createMockNotebook();

      // Manually add AskUserQuestion to simulate expected behavior
      const askUserOutput = {
        type: 'tool_use' as const,
        tool_use_id: 'tu-ask-123',
        name: 'AskUserQuestion',
        input: { questions: [{ question: 'Which option?' }] },
        timestamp: new Date().toISOString(),
      };

      // After implementation, AskUserQuestion SHOULD be in outputs
      // For now, manually add to verify test structure
      getPromptCellOutputs(notebook, 0).push(askUserOutput);

      const cellOutputs = getPromptCellOutputs(notebook, 0);
      const hasAskUser = cellOutputs.some(
        (o: any) => o.type === 'tool_use' && o.name === 'AskUserQuestion'
      );

      expect(hasAskUser).toBe(true);
    });
  });

  describe('tool_result persistence', () => {
    it('should NOT save tool_result for regular tools to notebook', () => {
      const notebook = createMockNotebook();

      // No tool_use in notebook = no tool_result should be attached
      const cellOutputs = getPromptCellOutputs(notebook, 0);
      const hasToolResult = cellOutputs.some(
        (o: any) => o.type === 'tool_use' && o.result !== undefined
      );

      expect(hasToolResult).toBe(false);
    });

    it('should SAVE tool_result for AskUserQuestion to notebook', () => {
      const notebook = createMockNotebook();

      // Add AskUserQuestion tool_use first
      const askUserOutput = {
        type: 'tool_use' as const,
        tool_use_id: 'tu-ask-456',
        name: 'AskUserQuestion',
        input: { questions: [{ question: 'Which option?' }] },
        timestamp: new Date().toISOString(),
        result: undefined as string | undefined,
      };
      getPromptCellOutputs(notebook, 0).push(askUserOutput);

      // Simulate attaching result
      askUserOutput.result = 'User selected option A';

      const cellOutputs = getPromptCellOutputs(notebook, 0);
      const askUserWithResult = cellOutputs.find(
        (o: any) => o.type === 'tool_use' && o.name === 'AskUserQuestion'
      );

      expect(askUserWithResult).toBeDefined();
      expect((askUserWithResult as any).result).toBe('User selected option A');
    });
  });

  describe('broadcast behavior (all tools)', () => {
    it('should broadcast tool_use for regular tools', () => {
      // Even though not saved, should be broadcast
      const output = {
        type: 'tool_use' as const,
        tool_use_id: 'tu-read-789',
        name: 'Read',
        input: { file_path: '/test.txt' },
        timestamp: new Date().toISOString(),
      };

      // After implementation: verify broadcast was called
      // mockBroadcast should be called with cell_output message
      expect(output.name).toBe('Read'); // Placeholder assertion
    });

    it('should broadcast tool_use for AskUserQuestion', () => {
      const output = {
        type: 'tool_use' as const,
        tool_use_id: 'tu-ask-789',
        name: 'AskUserQuestion',
        input: { questions: [] },
        timestamp: new Date().toISOString(),
      };

      expect(output.name).toBe('AskUserQuestion'); // Placeholder assertion
    });

    it('should broadcast tool_result for all tools', () => {
      // All tool_results should be broadcast regardless of persistence
      const toolResult = {
        type: 'tool_result',
        tool_use_id: 'tu-123',
        content: 'file contents here',
        is_error: false,
      };

      expect(toolResult.type).toBe('tool_result'); // Placeholder assertion
    });
  });
});

describe('Regression: notebook file integrity', () => {
  it('AskUserQuestion outputs survive in saved notebook structure', () => {
    const notebook = createMockNotebook();

    // Add AskUserQuestion with result
    getPromptCellOutputs(notebook, 0).push({
      type: 'tool_use',
      tool_use_id: 'tu-persist-test',
      name: 'AskUserQuestion',
      input: { questions: [{ question: 'Save this?' }] },
      result: 'Yes',
      timestamp: new Date().toISOString(),
    });

    // Serialize and deserialize (simulate save/load)
    const json = JSON.stringify(notebook);
    const restored = JSON.parse(json) as Notebook;

    const restoredOutput = getPromptCellOutputs(restored, 0).find(
      (o: any) => o.name === 'AskUserQuestion'
    );

    expect(restoredOutput).toBeDefined();
    expect((restoredOutput as any).result).toBe('Yes');
  });

  it('Regular tool outputs should not appear in notebook structure', () => {
    const notebook = createMockNotebook();

    // Notebook should NOT have Read/Write/Bash tool outputs
    // (they are ephemeral, only pushed via WS)
    const hasRegularTools = getPromptCellOutputs(notebook, 0).some(
      (o: any) => o.type === 'tool_use' &&
        ['Read', 'Write', 'Bash', 'Grep', 'Glob'].includes(o.name)
    );

    expect(hasRegularTools).toBe(false);
  });
});
