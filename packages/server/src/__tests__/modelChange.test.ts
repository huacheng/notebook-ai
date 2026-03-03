/**
 * Model change tests — TDD Red phase.
 *
 * Tests:
 * 1. AgentProcess accepts optional model param and passes --model to CLI
 * 2. AgentProcess without model param does NOT pass --model
 * 3. SessionManager.changeModel() stops old agent, creates new with model, starts it
 * 4. SessionManager.changeModel() updates notebook metadata
 * 5. SessionManager reads model from notebook file on createSession
 * 6. change_model WS message schema is accepted
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SessionManager } from '../session.js';
import { NotebookStore } from '../notebook-store.js';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

describe('model change', () => {
  let sm: SessionManager;
  let ns: NotebookStore;
  let tempDir: string;
  let tempHome: string;
  let originalHome: string | undefined;
  let startSpy: ReturnType<typeof vi.spyOn>;
  let stopSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    sm = new SessionManager();
    ns = new NotebookStore();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'model-test-'));
    // Set HOME to empty temp dir to avoid reading user's ~/.claude/settings.json
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'model-home-'));
    originalHome = process.env.HOME;
    process.env.HOME = tempHome;

    const { AgentProcess } = await import('../agent-process.js');
    startSpy = vi.spyOn(AgentProcess.prototype, 'start').mockImplementation(async (onMsg) => {
      onMsg({ type: 'system', subtype: 'hook_started' });
    });
    stopSpy = vi.spyOn(AgentProcess.prototype, 'stop').mockImplementation(() => {});
    vi.spyOn(AgentProcess.prototype, 'sendPrompt').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env.HOME = originalHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  async function createTestSession(model?: string) {
    const nb = ns.createNew('Test', tempDir);
    if (model) {
      (nb.metadata as any).model = model;
    }
    const nbPath = path.join(tempDir, 'test.notebook.json');
    await ns.save(nbPath, nb);
    return sm.createSession(nbPath, tempDir);
  }

  // 1. AgentProcess passes --model when model is provided
  it('AgentProcess passes --model when model is provided', async () => {
    const { AgentProcess } = await import('../agent-process.js');
    const agent = new AgentProcess('claude', tempDir, undefined, 'claude-sonnet-4-20250514');
    expect(agent).toBeDefined();
    // The model param should be stored; we verify via the spawn args in integration
    // For unit test, we verify the property exists
    expect((agent as any).model).toBe('claude-sonnet-4-20250514');
  });

  // 2. AgentProcess without model does NOT have model set
  it('AgentProcess without model param has undefined model', async () => {
    const { AgentProcess } = await import('../agent-process.js');
    const agent = new AgentProcess('claude', tempDir);
    expect((agent as any).model).toBeUndefined();
  });

  // 3. changeModel stops old agent and starts new one with model
  it('changeModel stops old agent and starts new one', async () => {
    const session = await createTestSession();
    const oldAgent = session.agentProcess;

    await sm.changeModel(session.id, 'claude-opus-4-20250514');

    // Old agent should have been stopped
    expect(stopSpy).toHaveBeenCalled();
    // New agent should be different instance
    expect(session.agentProcess).not.toBe(oldAgent);
  });

  // 4. changeModel updates notebook metadata
  it('changeModel updates notebook metadata model field', async () => {
    const session = await createTestSession();
    expect(session.notebook.metadata.model).toBeUndefined();

    await sm.changeModel(session.id, 'claude-sonnet-4-20250514');

    expect(session.notebook.metadata.model).toBe('claude-sonnet-4-20250514');
  });

  // 5. createSession reads model from notebook file
  it('createSession reads model from notebook file metadata', async () => {
    const nb = ns.createNew('ModelTest', tempDir);
    (nb.metadata as any).model = 'claude-opus-4-20250514';
    const nbPath = path.join(tempDir, 'model.notebook.json');
    await ns.save(nbPath, nb);

    const session = await sm.createSession(nbPath, tempDir);
    // The model should have been read and passed to AgentProcess
    expect((session.agentProcess as any).model).toBe('claude-opus-4-20250514');
  });

  // 6. changeModel throws for non-existent session
  it('changeModel throws for non-existent session', async () => {
    await expect(sm.changeModel('nonexistent', 'claude-sonnet-4-20250514'))
      .rejects.toThrow('not found');
  });
});

// ── NotebookMetadataSchema accepts model field ────────────────────────────

describe('NotebookMetadataSchema model field', () => {
  it('accepts model as optional string', async () => {
    const { NotebookMetadataSchema } = await import('@notebook-ai/shared');
    const result = NotebookMetadataSchema.parse({
      title: 'Test',
      created: new Date().toISOString(),
      model: 'claude-sonnet-4-20250514',
    });
    expect(result.model).toBe('claude-sonnet-4-20250514');
  });

  it('model defaults to undefined when not provided', async () => {
    const { NotebookMetadataSchema } = await import('@notebook-ai/shared');
    const result = NotebookMetadataSchema.parse({
      title: 'Test',
      created: new Date().toISOString(),
    });
    expect(result.model).toBeUndefined();
  });
});
