import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SessionManager, getClaudeDefaultModel } from '../session.js';
import { NotebookStore } from '../notebook-store.js';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

describe('getClaudeDefaultModel', () => {
  let tempHome: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-home-'));
    originalHome = process.env.HOME;
    process.env.HOME = tempHome;
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it('returns model from ~/.claude/settings.json when present', async () => {
    const claudeDir = path.join(tempHome, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(
      path.join(claudeDir, 'settings.json'),
      JSON.stringify({ model: 'claude-opus-4-5', language: '简体中文' }),
    );

    const model = await getClaudeDefaultModel();
    expect(model).toBe('claude-opus-4-5');
  });

  it('returns undefined when settings.json does not exist', async () => {
    const model = await getClaudeDefaultModel();
    expect(model).toBeUndefined();
  });

  it('returns undefined when settings.json has no model field', async () => {
    const claudeDir = path.join(tempHome, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(
      path.join(claudeDir, 'settings.json'),
      JSON.stringify({ language: '简体中文' }),
    );

    const model = await getClaudeDefaultModel();
    expect(model).toBeUndefined();
  });

  it('returns undefined when settings.json is malformed', async () => {
    const claudeDir = path.join(tempHome, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(path.join(claudeDir, 'settings.json'), 'not valid json');

    const model = await getClaudeDefaultModel();
    expect(model).toBeUndefined();
  });
});

describe('SessionManager.createSession with default model', () => {
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
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-model-test-'));
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-home-'));
    originalHome = process.env.HOME;
    process.env.HOME = tempHome;

    const { AgentProcess } = await import('../agent-process.js');
    startSpy = vi.spyOn(AgentProcess.prototype, 'start').mockImplementation(async (onMsg) => {
      onMsg({ type: 'system', subtype: 'hook_started' });
    });
    stopSpy = vi.spyOn(AgentProcess.prototype, 'stop').mockImplementation(async () => {});
  });

  afterEach(() => {
    startSpy.mockRestore();
    stopSpy.mockRestore();
    process.env.HOME = originalHome;
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it('uses model from Claude settings when notebook has no model', async () => {
    // Setup Claude settings with default model
    const claudeDir = path.join(tempHome, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(
      path.join(claudeDir, 'settings.json'),
      JSON.stringify({ model: 'claude-opus-4-5' }),
    );

    // Create notebook without model
    const nbPath = path.join(tempDir, 'test.notebook.json');
    const nbContent = {
      version: 1,
      metadata: { title: 'Test', cwd: tempDir },
      cells: [],
    };
    fs.writeFileSync(nbPath, JSON.stringify(nbContent));

    const session = await sm.createSession(nbPath, tempDir);

    expect(session.notebook.metadata.model).toBe('claude-opus-4-5');
  });

  it('prefers notebook model over Claude settings model', async () => {
    // Setup Claude settings with default model
    const claudeDir = path.join(tempHome, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(
      path.join(claudeDir, 'settings.json'),
      JSON.stringify({ model: 'claude-opus-4-5' }),
    );

    // Create notebook WITH a model set
    const nbPath = path.join(tempDir, 'test.notebook.json');
    const nbContent = {
      version: 1,
      metadata: { title: 'Test', cwd: tempDir, model: 'claude-sonnet-4-5' },
      cells: [],
    };
    fs.writeFileSync(nbPath, JSON.stringify(nbContent));

    const session = await sm.createSession(nbPath, tempDir);

    // Notebook model should take precedence
    expect(session.notebook.metadata.model).toBe('claude-sonnet-4-5');
  });

  it('has no model when neither notebook nor Claude settings have one', async () => {
    // No Claude settings file
    const nbPath = path.join(tempDir, 'test.notebook.json');
    const nbContent = {
      version: 1,
      metadata: { title: 'Test', cwd: tempDir },
      cells: [],
    };
    fs.writeFileSync(nbPath, JSON.stringify(nbContent));

    const session = await sm.createSession(nbPath, tempDir);

    expect(session.notebook.metadata.model).toBeUndefined();
  });

  it('reads Claude settings on every createSession call (not cached)', { timeout: 10000 }, async () => {
    const claudeDir = path.join(tempHome, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });

    // First session: model is opus
    fs.writeFileSync(
      path.join(claudeDir, 'settings.json'),
      JSON.stringify({ model: 'claude-opus-4-5' }),
    );

    const nbPath1 = path.join(tempDir, 'test1.notebook.json');
    fs.writeFileSync(nbPath1, JSON.stringify({ version: 1, metadata: { title: 'T1', cwd: tempDir }, cells: [] }));
    const session1 = await sm.createSession(nbPath1, tempDir);
    expect(session1.notebook.metadata.model).toBe('claude-opus-4-5');

    // Update settings to haiku
    fs.writeFileSync(
      path.join(claudeDir, 'settings.json'),
      JSON.stringify({ model: 'claude-haiku-4-5' }),
    );

    // Second session: should see the updated model
    const nbPath2 = path.join(tempDir, 'test2.notebook.json');
    fs.writeFileSync(nbPath2, JSON.stringify({ version: 1, metadata: { title: 'T2', cwd: tempDir }, cells: [] }));
    const session2 = await sm.createSession(nbPath2, tempDir);
    expect(session2.notebook.metadata.model).toBe('claude-haiku-4-5');
  });
});
