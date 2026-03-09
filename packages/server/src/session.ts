import { readFile, writeFile, readdir, realpath } from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import crypto from 'crypto';
import { AgentProcess, type AgentEngine } from './agent-process.js';
import { GitManager } from './git.js';
import {
  NotebookSchema,
  type Notebook,
  type WSServerMessage,
  type CellOutput,
  type PromptImage,
  type PromptSegment,
} from '@notebook-ai/shared';
import { EventBuffer } from './event-buffer.js';
import {
  updateCellStatus,
  updateCellDuration,
  appendCellOutput,
  attachToolResult,
  findRunningCellId,
  findCellByToolUseId,
} from './notebook-mutations.js';
import { getDaemon } from './routes/task-auto.js';

// ── Heartbeat Constants ───────────────────────────────────────────────────────

/** Heartbeat check interval for process health monitoring (30 seconds) */
export const HEARTBEAT_INTERVAL_MS = 30 * 1000;

/** Default Timer mode interval (5 minutes) */
export const DEFAULT_TIMER_INTERVAL_MS = 5 * 60 * 1000;

/** Minimum Timer mode interval (10 seconds) — prevents DoS via tiny intervals */
export const MIN_TIMER_INTERVAL_MS = 10 * 1000;

/** Maximum Timer mode interval (30 minutes) */
export const MAX_TIMER_INTERVAL_MS = 30 * 60 * 1000;

/** Prompt sent by Timer mode heartbeat to drive continuous progress */
export const CONTINUE_PROMPT = '继续';

/** Threshold for notifying user about long-running tool (5 minutes) */
export const TOOL_LONG_RUNNING_MS = 5 * 60 * 1000;

/**
 * Default cooldown when a rate-limit / usage-limit error is detected.
 * Timer mode pauses for this duration before resuming.  (5 minutes)
 */
export const AUTO_RATE_LIMIT_COOLDOWN_MS = 5 * 60 * 1000;

/** Patterns that indicate a rate/usage limit error in result.result text. */
const RATE_LIMIT_PATTERNS = [
  /rate.?limit/i,
  /too many requests/i,
  /overloaded/i,
  /usage.?limit/i,
  /resource.?exhausted/i,
];

// ── Claude settings model helper ─────────────────────────────────────────────

/**
 * Reads the default model from Claude's settings file (~/.claude/settings.json).
 * Returns undefined if the file doesn't exist, is malformed, or has no model field.
 * This is called on every notebook open to pick up any changes to Claude's config.
 */
export async function getClaudeDefaultModel(): Promise<string | undefined> {
  try {
    const home = os.homedir();
    const settingsPath = path.join(home, '.claude', 'settings.json');
    const raw = await readFile(settingsPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (typeof parsed?.model === 'string' && parsed.model) {
      return parsed.model;
    }
    return undefined;
  } catch (_err: unknown) {
    // File doesn't exist, not readable, or not valid JSON
    return undefined;
  }
}
/**
 * Generate the system prompt with absolute path to .MEMORY.md.
 * This ensures Claude can always find the memory file regardless of cwd changes.
 */
function buildMemorySystemPrompt(workspaceDir: string): string {
  const memoryPath = path.join(workspaceDir, '.MEMORY.md');
  return `Read the ${memoryPath} file. It contains important context, including the Shared Library Directory, Deliverables Directory and Project Deliverables Directory path.`;
}

// ── Claude Code JSONL message shapes ────────────────────────────────────────
// Claude Code emits streaming JSONL records.  We only need a subset.

interface ClaudeTextMessage {
  type: 'assistant';
  message: {
    content: Array<
      | { type: 'text'; text: string }
      | { type: 'thinking'; thinking: string }
      | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
    >;
  };
}

interface ClaudeResultMessage {
  type: 'result';
  result: string;
  is_error: boolean;
}

type ClaudeJsonlMessage =
  | ClaudeTextMessage
  | ClaudeResultMessage
  | { type: string };

// ── NotebookSession ──────────────────────────────────────────────────────────

interface NotebookSession {
  id: string;
  /** Absolute path to the notebook's workspace directory (used for file ops). */
  cwd: string;
  agentProcess: AgentProcess;
  notebook: Notebook;
  gitManager: GitManager;
  /** Absolute path to the .notebook.json file on disk. */
  notebookPath: string;
  /** Callbacks registered by WebSocket clients for this session. */
  listeners: Set<(msg: WSServerMessage) => void>;
  /** Database ID for this notebook (if persisted in DB). */
  notebookDbId?: string;
  /** Tracks per-cell execution start times (ms) for duration calculation. */
  _execStartTimes: Map<string, number>;
  /** Claude CLI session ID captured from hook_started/system.init — used for --resume on restart. */
  claudeSessionId?: string;
  /** Queue of pending cell IDs to execute during a rerun. */
  _rerunQueue?: string[];
  /** Set by interruptCell() so completeCell() knows to use 'interrupted' status. */
  _interrupted?: boolean;
  /** Event buffer for WS resume-after reconnection. */
  eventBuffer: EventBuffer;
  /** Allowed directories for cross-project isolation (--add-dir). */
  allowedDirs?: string[];
  /** D3: per-session mutex to prevent TOCTOU race in executeCell. */
  _executeLock: Promise<void>;
  /** D3: tracks pending post-completion work (git commit + autoSave) so closeSession can await. */
  _pendingPostComplete: Promise<void>;
  /** Last cell ID that was running — used for local_command_output that arrives after result. */
  _lastCellId?: string;
  /** D1: Track tool_use_ids that should be persisted (AskUserQuestion only). */
  _persistedToolUseIds: Set<string>;
  /** Heartbeat: last time output was received from agent (ms timestamp). */
  _lastOutputTime: number;
  /** Heartbeat: interval timer reference for process health monitoring. */
  _heartbeatTimer: ReturnType<typeof setInterval> | null;
  /** Heartbeat: tool_use IDs awaiting tool_result (tool execution in progress). */
  _pendingToolUseIds: Set<string>;
  /** Count of appended prompts sent to stdin but not yet consumed by a result. */
  _pendingAppends: number;
  /** Heartbeat: flag to prevent repeated tool_long_running notifications. */
  _toolLongRunningNotified: boolean;
  /** Timer mode: whether auto heartbeat is active. */
  _timerMode: boolean;
  /** Timer mode: interval timer reference for CONTINUE prompts. */
  _timerHandle: ReturnType<typeof setInterval> | null;
  /** Timer mode: interval in ms between CONTINUE prompts. */
  _timerIntervalMs: number;
  /** Timer mode: number of CONTINUE prompts sent in this auto session. */
  _timerIterationCount: number;
  /** Timer mode: true while an auto-created executeCell is pending (prevents cascade). */
  _timerExecuting: boolean;
  /** Timer mode: timestamp until which timer mode is paused (rate limit cooldown). 0 = not paused. */
  _timerPausedUntil: number;
}

// ── SessionManager ───────────────────────────────────────────────────────────

export class SessionManager {
  private sessions = new Map<string, NotebookSession>();

  /** Optional callback invoked after a successful auto-save to sync DB metadata. */
  onAutoSave?: (notebookDbId: string, cellCount: number) => void;

  /** Optional callback to persist Claude session ID to DB (for --resume after server restart). */
  onClaudeSessionId?: (sessionId: string, claudeSessionId: string) => void;

  /**
   * Creates a new notebook session: spawns a persistent `claude -p` process,
   * waits for it to initialise, and wires its stdout to the JSONL message handler.
   *
   * @param notebookPath  Absolute path to the .notebook.json file.
   * @param cwd           Working directory for the Claude process.
   * @param gitRoot       Root directory for GitManager (defaults to cwd).
   * @param resumeSessionId  Claude CLI session ID to resume (for context recovery after server restart).
   */
  async createSession(notebookPath: string, cwd: string, gitRoot?: string, resumeSessionId?: string): Promise<NotebookSession> {
    // Derive a short, deterministic session name from the notebook path.
    const hash = crypto
      .createHash('sha1')
      .update(notebookPath)
      .digest('hex')
      .slice(0, 8);
    const sessionName = `nb-${hash}`;

    // Idempotent: if a session already exists for this notebook, reuse it.
    const existing = this.sessions.get(sessionName);
    if (existing) return existing;

    // Initialise (or adopt) the git repo. GitManager uses gitRoot (worktree root),
    // while AgentProcess uses cwd (e.g. .deliverables/).
    const gitManager = new GitManager(gitRoot ?? cwd);
    await gitManager.ensureRepo();

    // Determine agent engine and model from notebook file metadata (read first)
    let engine: AgentEngine = 'claude';
    let model: string | undefined;
    try {
      const raw = await readFile(notebookPath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed?.metadata?.agent === 'gemini') engine = 'gemini';
      if (parsed?.metadata?.model) model = parsed.metadata.model;
    } catch (_err: unknown) { /* file doesn't exist yet — default claude */ }

    // If notebook has no model, read default from Claude's settings file
    // This is done on every notebook open so changes to Claude config are reflected
    if (!model) {
      model = await getClaudeDefaultModel();
    }

    const notebook: Notebook = NotebookSchema.parse({
      version: 1,
      metadata: {
        title: 'Untitled Notebook',
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        cwd,
        git_repo: true,
        tmux_session: sessionName,
        ...(model ? { model } : {}),  // Include model if read from file
      },
      cells: [],
      slide: { generated: false, sections: [] },
      annotations: [],
      assets: { intermediate_files: [] },
    });

    // Compute allowedDirs: sibling worktree directories under the same project
    // D2-8: resolve symlinks via realpath to prevent symlink escaping
    let allowedDirs: string[] | undefined;
    try {
      const parentDir = path.dirname(cwd);
      const realParent = await realpath(parentDir);
      const siblings = await readdir(realParent, { withFileTypes: true });
      const cwdName = path.basename(cwd);
      const resolved: string[] = [];
      for (const d of siblings) {
        if (!d.isDirectory() || d.name === cwdName || d.name.startsWith('.')) continue;
        const fullPath = path.join(realParent, d.name);
        // Verify the resolved path is still under parentDir (no symlink escape)
        const realFullPath = await realpath(fullPath).catch(() => null);
        if (realFullPath && realFullPath.startsWith(realParent + path.sep)) {
          resolved.push(realFullPath);
        }
      }
      allowedDirs = resolved.length > 0 ? resolved : undefined;
    } catch (_err: unknown) { /* parent doesn't exist or not readable — skip */ }

    const session: NotebookSession = {
      id: sessionName,
      cwd,
      agentProcess: new AgentProcess(engine, cwd, buildMemorySystemPrompt(cwd), model, allowedDirs),
      notebook,
      gitManager,
      notebookPath,
      listeners: new Set(),
      _execStartTimes: new Map(),
      _executeLock: Promise.resolve(),
      _pendingPostComplete: Promise.resolve(),
      eventBuffer: new EventBuffer(),
      allowedDirs,
      _persistedToolUseIds: new Set(),
      _lastOutputTime: Date.now(),
      _heartbeatTimer: null,
      _pendingToolUseIds: new Set(),
      _pendingAppends: 0,
      _toolLongRunningNotified: false,
      _timerMode: false,
      _timerHandle: null,
      _timerIntervalMs: DEFAULT_TIMER_INTERVAL_MS,
      _timerIterationCount: 0,
      _timerExecuting: false,
      _timerPausedUntil: 0,
    };

    // Start the agent process.  Messages arrive asynchronously via stdout.
    // If resumeSessionId is provided (e.g. after server restart), pass it to --resume
    // so Claude CLI recovers its conversation context.
    await session.agentProcess.start(
      (raw: unknown) => this.handleJsonlMessage(session, raw),
      (code) => {
        // Process exited unexpectedly — complete any running cell as an error.
        const cellId = findRunningCellId(session.notebook);
        if (cellId) {
          console.error(
            `[session ${sessionName}] Claude process exited (code ${String(code)}) ` +
            `while cell "${cellId}" was running.`,
          );
          this.completeCell(session, cellId, true);
        }
      },
      resumeSessionId,
    );

    this.sessions.set(sessionName, session);
    console.log(`[session] Created session "${sessionName}" for "${notebookPath}"${resumeSessionId ? ` (resumed ${resumeSessionId})` : ''}`);

    // Start heartbeat timer for stuck detection and queue processing
    this.startHeartbeat(sessionName);

    return session;
  }

  /**
   * Sends a prompt to Claude and marks the cell as running.
   * Output messages arrive asynchronously via the process stdout handler.
   */
  async executeCell(sessionId: string, cellId: string, source: string, images?: PromptImage[]): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session "${sessionId}" not found.`);
    }

    // D3: per-session mutex — serialize executeCell to prevent TOCTOU race
    let unlock: () => void;
    const acquired = new Promise<void>((resolve) => { unlock = resolve; });
    const prev = session._executeLock;
    session._executeLock = acquired;
    await prev;

    try {
    // If the agent process died (e.g. SIGINT during interrupt), force-complete any
    // stale running cell and restart the process before the concurrency check.
    if (!session.agentProcess.isAlive()) {
      const staleRunningId = findRunningCellId(session.notebook);
      if (staleRunningId) {
        console.log(`[session ${sessionId}] Force-completing stale cell "${staleRunningId}" (process dead).`);
        this.completeCell(session, staleRunningId, true);
      }
      console.log(`[session ${sessionId}] Agent process dead — auto-restarting (clean) before execute.`);
      await this.restartSession(sessionId, { skipResume: true });
    }

    // Reject concurrent execution: only one cell may run at a time per session.
    const alreadyRunning = session.notebook.cells.some((c) => c.status === 'running');
    if (alreadyRunning) {
      throw new Error('Another cell is already running in this session.');
    }

    // Ensure the cell exists in the server-side notebook.
    const cellExists = session.notebook.cells.some((c) => c.id === cellId);
    if (!cellExists) {
      session.notebook = {
        ...session.notebook,
        cells: [
          ...session.notebook.cells,
          {
            id: cellId,
            type: 'prompt' as const,
            source,
            outputs: [],
            execution_count: 0,
            status: 'idle' as const,
          },
        ],
      };
      // Broadcast cell_created to all subscribers for multi-device sync
      this.broadcast(session, {
        type: 'cell_created',
        cell_id: cellId,
        source,
      });
    }

    session.notebook = updateCellStatus(session.notebook, cellId, 'running');
    // Broadcast cell_status so other clients know execution started
    this.broadcast(session, {
      type: 'cell_status',
      cell_id: cellId,
      status: 'running',
    });
    session._execStartTimes.set(cellId, Date.now());
    session._lastCellId = cellId;

    if (images && images.length > 0) {
      session.agentProcess.sendPrompt(source, images);
    } else {
      session.agentProcess.sendPrompt(source);
    }
    } finally {
      unlock!();
    }
  }

  getSession(sessionId: string): NotebookSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Restarts the agent process for an existing session.
   * Preserves the session ID, notebook state, and listeners.
   */
  async restartSession(sessionId: string, opts?: { skipResume?: boolean }): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session "${sessionId}" not found.`);

    // Capture Claude session ID for --resume before stopping.
    // Skip resume when the process crashed (SIGINT death) — the session is unrecoverable.
    const resumeSessionId = opts?.skipResume ? undefined : session.claudeSessionId;

    // Reset claudeSessionId so the new process's session_id will be captured
    session.claudeSessionId = undefined;

    // Stop old process
    session.agentProcess.stop();

    // Stop timer mode before restarting to prevent stale timer on new process
    this.stopTimerMode(sessionId);

    // Clear pending tool IDs (old process won't send tool_result)
    session._pendingToolUseIds.clear();

    // Create new AgentProcess with same config (preserve model + allowedDirs)
    const engine = session.agentProcess.engine;
    const model = session.agentProcess.model;
    session.agentProcess = new AgentProcess(engine, session.cwd, buildMemorySystemPrompt(session.cwd), model, session.allowedDirs);

    // Start new process with same handlers — pass resumeSessionId for context recovery
    await session.agentProcess.start(
      (raw: unknown) => this.handleJsonlMessage(session, raw),
      (code) => {
        const cellId = findRunningCellId(session.notebook);
        if (cellId) {
          console.error(
            `[session ${sessionId}] Agent process exited (code ${String(code)}) ` +
            `while cell "${cellId}" was running.`,
          );
          this.completeCell(session, cellId, true);
        }
      },
      resumeSessionId,
    );

    console.log(`[session] Restarted session "${sessionId}"${resumeSessionId ? ` (resumed ${resumeSessionId})` : ''}`);
  }

  /**
   * Reruns the notebook from scratch: clears all outputs, resets statuses,
   * and rebuilds the agent process without resume (clean context).
   */
  async rerunNotebook(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session "${sessionId}" not found.`);

    // Stop timer mode before rerunning to prevent timer interference
    this.stopTimerMode(sessionId);

    // 1. Clear all cells' outputs and reset status to pending
    session.notebook = {
      ...session.notebook,
      cells: session.notebook.cells.map((c) =>
        'outputs' in c
          ? { ...c, outputs: [], status: 'pending' as const }
          : { ...c, status: 'pending' as const }
      ),
    };

    // 2. Stop old agent process
    session.agentProcess.stop();

    // Clear pending tool IDs (old process won't send tool_result)
    session._pendingToolUseIds.clear();

    // 3. Create new AgentProcess WITHOUT resumeSessionId (clean context)
    const engine = session.agentProcess.engine;
    const model = session.agentProcess.model;
    session.agentProcess = new AgentProcess(engine, session.cwd, buildMemorySystemPrompt(session.cwd), model, session.allowedDirs);

    // 4. Start new process — no resume
    await session.agentProcess.start(
      (raw: unknown) => this.handleJsonlMessage(session, raw),
      (code) => {
        const cellId = findRunningCellId(session.notebook);
        if (cellId) {
          console.error(
            `[session ${sessionId}] Agent process exited (code ${String(code)}) ` +
            `while cell "${cellId}" was running during rerun.`,
          );
          this.completeCell(session, cellId, true);
        }
      },
      // No resumeSessionId — intentionally undefined for clean context
    );

    console.log(`[session] Rerun initiated for session "${sessionId}" (clean context)`);

    // 5. Build rerun queue from all prompt cells and kick off execution
    session._rerunQueue = session.notebook.cells
      .filter((c) => c.type === 'prompt')
      .map((c) => c.id);
    this.executeNextRerunCell(session);
  }

  /**
   * Executes the next cell in the rerun queue.
   * Shifts the first cellId, sets it to running, and sends the prompt.
   * Cleans up _rerunQueue when empty.
   */
  private executeNextRerunCell(session: NotebookSession): void {
    if (!session._rerunQueue || session._rerunQueue.length === 0) {
      delete session._rerunQueue;
      return;
    }

    const cellId = session._rerunQueue.shift()!;
    const cell = session.notebook.cells.find((c) => c.id === cellId);
    if (!cell) {
      delete session._rerunQueue;
      return;
    }

    session.notebook = updateCellStatus(session.notebook, cellId, 'running');
    session._execStartTimes.set(cellId, Date.now());
    session._lastCellId = cellId;
    session.agentProcess.sendPrompt(cell.source);
  }

  /**
   * Changes the model for a session: updates notebook metadata,
   * stops the old agent, and spawns a new one with the new model.
   */
  async changeModel(sessionId: string, model: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session "${sessionId}" not found.`);

    // Update notebook metadata
    session.notebook = {
      ...session.notebook,
      metadata: { ...session.notebook.metadata, model },
    };

    // Stop timer mode before changing model to prevent timer on stale process
    this.stopTimerMode(sessionId);

    // Stop old process
    session.agentProcess.stop();

    // Create new AgentProcess with updated model (preserve allowedDirs)
    const engine = session.agentProcess.engine;
    session.agentProcess = new AgentProcess(engine, session.cwd, buildMemorySystemPrompt(session.cwd), model, session.allowedDirs);

    // Start new process (clean — no resume)
    await session.agentProcess.start(
      (raw: unknown) => this.handleJsonlMessage(session, raw),
      (code) => {
        const cellId = findRunningCellId(session.notebook);
        if (cellId) {
          this.completeCell(session, cellId, true);
        }
      },
    );

    // Persist the updated metadata to disk so the model survives restarts
    await this.autoSave(session);

    console.log(`[session] Model changed to "${model}" for session "${sessionId}"`);
  }

  async submitToolResult(sessionId: string, toolUseId: string, content: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session "${sessionId}" not found.`);
    session.agentProcess.sendToolResult(toolUseId, content);
  }

  /**
   * Update a tool result in the notebook without sending to Claude CLI.
   * Used for AskUserQuestion workaround: persist user's actual choice.
   */
  async updateToolResultLocal(sessionId: string, cellId: string, toolUseId: string, content: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session "${sessionId}" not found.`);
    session.notebook = attachToolResult(session.notebook, cellId, toolUseId, content, false);
    await this.autoSave(session);
  }

  async interruptCell(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session "${sessionId}" not found.`);

    // Clear rerun queue so no more cells auto-execute after interrupt
    delete session._rerunQueue;

    // Stop timer mode if active — Esc stops everything
    this.stopTimerMode(sessionId);

    session._interrupted = true;

    if (session.agentProcess.isAlive()) {
      session.agentProcess.interrupt();
      // Claude CLI will emit a 'result' message → completeCell() handles the rest
    } else {
      // Process is dead (e.g., after server restart) — force-complete any stale running cell
      const cellId = findRunningCellId(session.notebook);
      if (cellId) {
        this.completeCell(session, cellId, true);
      }
    }
  }

  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Stop heartbeat and timer mode timers
    this.stopHeartbeat(session);
    this.stopTimerMode(sessionId);

    // D3: Await any pending post-completion work (git commit + autoSave) before closing
    await session._pendingPostComplete.catch(() => {});

    session.agentProcess.stop();
    session.listeners.clear();
    session.eventBuffer.clear();
    this.sessions.delete(sessionId);
    console.log(`[session] Closed session "${sessionId}"`);
  }

  /** D3-1: Close all active sessions (for graceful shutdown). */
  async closeAllSessions(): Promise<void> {
    const ids = Array.from(this.sessions.keys());
    for (const id of ids) {
      await this.closeSession(id);
    }
  }

  /**
   * Reconnects to a session when restoring a notebook from the database.
   *
   * createSession is idempotent (same notebookPath → same session name, reuses
   * in-memory session if present).  `reconnected = true` means an existing
   * in-memory session was reused; `false` means a fresh process was spawned.
   */
  async reconnectSession(
    sessionName: string,
    notebookPath: string,
    cwd: string,
    notebook: Notebook,
    _jsonlPath?: string | null,
    notebookDbId?: string,
    gitRoot?: string,
    resumeSessionId?: string,
  ): Promise<{ session: NotebookSession; reconnected: boolean }> {
    const existed = this.sessions.has(sessionName);
    const session = await this.createSession(notebookPath, cwd, gitRoot, resumeSessionId);
    if (!existed) {
      // Preserve model from session (read from ~/.claude/settings.json) if notebook has none
      const defaultModel = session.notebook.metadata.model;
      session.notebook = notebook;
      if (!notebook.metadata.model && defaultModel) {
        session.notebook.metadata.model = defaultModel;
      }
      session.notebookDbId = notebookDbId;
    }
    return { session, reconnected: existed };
  }

  // ── Listener management ──────────────────────────────────────────────────

  addListener(
    sessionId: string,
    listener: (msg: WSServerMessage) => void,
  ): (() => void) | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    session.listeners.add(listener);
    return () => session.listeners.delete(listener);
  }

  broadcastToSession(sessionId: string, msg: Record<string, unknown>): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.broadcast(session, msg);
  }

  // ── Prompt Append (running cell) ────────────────────────────────────────────

  /**
   * Append a prompt to the currently running cell and send it to Claude stdin immediately.
   * Used when user submits while a cell is already executing.
   */
  appendPrompt(sessionId: string, cellId: string, source: string, images?: PromptImage[]): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session "${sessionId}" not found.`);

    const cell = session.notebook.cells.find((c) => c.id === cellId);
    if (!cell || cell.status !== 'running') {
      throw new Error(`Cell "${cellId}" is not running.`);
    }

    // Append segment to cell
    const segment: PromptSegment = {
      text: source,
      images,
      addedAt: new Date().toISOString(),
    };
    const existing = ('segments' in cell && Array.isArray(cell.segments)) ? cell.segments as PromptSegment[] : [];
    const segments = [...existing, segment];
    session.notebook = {
      ...session.notebook,
      cells: session.notebook.cells.map((c) =>
        c.id === cellId ? { ...c, segments } : c,
      ),
    };

    // Track pending append — completeCell will defer until Claude consumes it
    session._pendingAppends++;

    // Send to Claude stdin immediately
    if (images && images.length > 0) {
      session.agentProcess.sendPrompt(source, images);
    } else {
      session.agentProcess.sendPrompt(source);
    }

    // Broadcast to all clients
    this.broadcast(session, {
      type: 'cell_appended',
      cell_id: cellId,
      segment,
    });

    console.log(`[session ${sessionId}] Appended prompt to cell "${cellId}" (_pendingAppends=${session._pendingAppends}): "${source.slice(0, 50)}..."`);
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  // Accept any object — session_id is injected here so call sites stay clean.
  private broadcast(session: NotebookSession, msg: Record<string, unknown>): void {
    const msgWithSession = { ...msg, session_id: session.id } as WSServerMessage;
    // Buffer the event with a monotonically increasing index for resume-after.
    const buffered = session.eventBuffer.push(msgWithSession as Record<string, unknown>);
    const indexed = { ...msgWithSession, event_index: buffered.event_index } as unknown as WSServerMessage;
    for (const listener of session.listeners) {
      try {
        listener(indexed);
      } catch (err) {
        console.error('[session] Listener error:', err);
      }
    }
  }

  /** Get buffered events after a given index for resume-after support. */
  getEventsAfter(sessionId: string, afterIndex: number): Array<{ event_index: number; event: Record<string, unknown> }> {
    const session = this.sessions.get(sessionId);
    if (!session) return [];
    return session.eventBuffer.getEventsAfter(afterIndex);
  }

  /**
   * Marks a cell as completed (or error), broadcasts execution_complete,
   * and kicks off a best-effort git commit.  No-ops if the cell is no
   * longer running (guards against double-completion).
   */
  private completeCell(session: NotebookSession, cellId: string, isError: boolean): void {
    // Guard: only complete if the cell is still running.
    const cell = session.notebook.cells.find((c) => c.id === cellId);
    if (!cell || cell.status !== 'running') return;

    // Defer completion if there are appended prompts waiting for Claude to consume.
    // Each append sends a user message to stdin; Claude will produce a new result for each.
    if (session._pendingAppends > 0 && !isError) {
      session._pendingAppends--;
      console.log(`[session ${session.id}] completeCell deferred: _pendingAppends=${session._pendingAppends} remaining`);
      return;
    }
    // Reset counter on final completion
    session._pendingAppends = 0;

    // Determine final status: interrupted > error > completed
    let status: 'completed' | 'error' | 'interrupted';
    if (session._interrupted) {
      status = 'interrupted';
      delete session._interrupted;
    } else {
      status = isError ? 'error' : 'completed';
    }
    session.notebook = updateCellStatus(session.notebook, cellId, status);

    // Heartbeat: clear pending tools on completion
    session._pendingToolUseIds.clear();

    const startMs = session._execStartTimes.get(cellId);
    const duration_ms = startMs ? Date.now() - startMs : 0;
    session._execStartTimes.delete(cellId);
    session.notebook = updateCellDuration(session.notebook, cellId, duration_ms);

    this.broadcast(session, {
      type: 'execution_complete',
      cell_id: cellId,
      duration_ms,
      status,
    });

    console.log(
      `[session ${session.id}] Cell "${cellId}" ${status} (${duration_ms}ms)`,
    );

    // Defer git commit and auto-save to the next tick so the
    // execution_complete WebSocket message is flushed first.
    // IMPORTANT: tryGitCommit must complete before autoSave so that git_diff
    // is persisted to disk (otherwise a page reload would lose git diff info).
    // D3: Track the pending work so closeSession can await it.
    session._pendingPostComplete = new Promise<void>((resolve) => {
      setTimeout(() => {
        this.tryGitCommit(session, cellId)
          .catch(() => {})
          .finally(() => {
            this.autoSave(session).catch((err) => {
              console.error(`[session ${session.id}] auto-save failed:`, err);
            }).finally(resolve);
          });
      }, 0);
    });

    // Chain rerun execution: if there are more cells in the queue, execute next.
    if (session._rerunQueue && session._rerunQueue.length > 0) {
      setTimeout(() => this.executeNextRerunCell(session), 0);
    } else if (session._rerunQueue) {
      delete session._rerunQueue;
    }

  }

  // ── Heartbeat Mechanism ─────────────────────────────────────────────────────

  /**
   * Start health-check heartbeat timer for a session.
   * Monitors agent process liveness and tool execution status.
   */
  startHeartbeat(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Don't start if already running
    if (session._heartbeatTimer) return;

    session._heartbeatTimer = setInterval(() => {
      this.heartbeatCheck(session);
    }, HEARTBEAT_INTERVAL_MS);

    console.log(`[session ${sessionId}] Heartbeat started (${HEARTBEAT_INTERVAL_MS / 1000}s interval)`);
  }

  /**
   * Stop health-check heartbeat timer for a session.
   */
  stopHeartbeat(session: NotebookSession): void {
    if (session._heartbeatTimer) {
      clearInterval(session._heartbeatTimer);
      session._heartbeatTimer = null;
    }
  }

  /**
   * Health-check heartbeat: detect dead process and long-running tools.
   */
  private heartbeatCheck(session: NotebookSession): void {
    const runningCellId = findRunningCellId(session.notebook);

    if (runningCellId) {
      // D3-1: Check if agent process is still alive
      if (!session.agentProcess.isAlive()) {
        console.error(`[session ${session.id}] Agent process died while cell "${runningCellId}" was running`);

        this.broadcast(session, {
          type: 'process_dead',
          cell_id: runningCellId,
        });

        this.completeCell(session, runningCellId, true);
        return;
      }

      // Notify user once if tool is taking unusually long
      if (session._pendingToolUseIds.size > 0) {
        const elapsed = Date.now() - session._lastOutputTime;
        if (elapsed > TOOL_LONG_RUNNING_MS && !session._toolLongRunningNotified) {
          session._toolLongRunningNotified = true;
          this.broadcast(session, {
            type: 'tool_long_running',
            cell_id: runningCellId,
            elapsed_ms: elapsed,
            pending_tools: session._pendingToolUseIds.size,
          });
        }
      }
    }
  }

  // ── Timer Mode ──────────────────────────────────────────────────────────────

  /**
   * Start Timer mode for a session. Periodically sends CONTINUE prompts
   * to the Claude process to drive continuous progress.
   */
  startTimerMode(sessionId: string, intervalMs?: number): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session "${sessionId}" not found.`);

    // Stop existing timer mode if any
    this.stopTimerMode(sessionId);

    session._timerMode = true;
    const rawInterval = intervalMs ?? DEFAULT_TIMER_INTERVAL_MS;
    session._timerIntervalMs = Math.max(MIN_TIMER_INTERVAL_MS, Math.min(MAX_TIMER_INTERVAL_MS, rawInterval));
    session._timerIterationCount = 0;
    session._timerExecuting = false;
    session._timerPausedUntil = 0;

    session._timerHandle = setInterval(() => {
      this.timerTick(session);
    }, session._timerIntervalMs);

    console.log(`[session ${sessionId}] Timer mode started (${session._timerIntervalMs / 1000}s interval)`);
  }

  /**
   * Stop Timer mode for a session. Clears the timer handle and broadcasts timer_stopped.
   */
  stopTimerMode(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    if (session._timerHandle) {
      clearInterval(session._timerHandle);
      session._timerHandle = null;
    }

    if (session._timerMode) {
      session._timerMode = false;
      this.broadcast(session, {
        type: 'timer_stopped',
        iteration_count: session._timerIterationCount,
      });
      console.log(`[session ${sessionId}] Timer mode stopped after ${session._timerIterationCount} iterations`);
    }
  }

  /** Get timer mode status for a session. */
  getTimerStatus(sessionId: string): { active: boolean; intervalMs: number; iterationCount: number } | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    return {
      active: session._timerMode,
      intervalMs: session._timerIntervalMs,
      iterationCount: session._timerIterationCount,
    };
  }

  /**
   * Timer mode tick: send CONTINUE prompt to drive LLM progress.
   * Appends CONTINUE to the running cell; creates a new cell if none is running.
   */
  private timerTick(session: NotebookSession): void {
    if (!session._timerMode) return;
    if (!session.agentProcess.isAlive()) {
      console.warn(`[session ${session.id}] Timer tick: agent process not alive, stopping timer mode`);
      this.stopTimerMode(session.id);
      return;
    }

    // Determine whether to skip or send CONTINUE
    let skipReason: string | null = null;

    // Rate limit cooldown: skip tick if paused, broadcast resume when cooldown expires
    if (session._timerPausedUntil > 0) {
      if (Date.now() < session._timerPausedUntil) {
        const remainMs = session._timerPausedUntil - Date.now();
        skipReason = `rate limit cooldown (${Math.ceil(remainMs / 1000)}s remaining)`;
      } else {
        // Cooldown expired — resume
        session._timerPausedUntil = 0;
        console.log(`[session ${session.id}] Timer tick: rate limit cooldown expired, resuming`);
        this.broadcast(session, { type: 'timer_resumed' });
      }
    }

    // Pending tool check: skip if agent is waiting for tool results (e.g., sub-agent running)
    if (!skipReason && session._pendingToolUseIds.size > 0) {
      skipReason = `${session._pendingToolUseIds.size} tool(s) pending`;
    }

    // Active output check: skip if agent produced output recently (still working)
    // Quiet threshold = half the session's interval (dynamic, not global constant)
    if (!skipReason) {
      const quietMs = Math.floor(session._timerIntervalMs / 2);
      const outputAge = Date.now() - session._lastOutputTime;
      if (outputAge < quietMs) {
        skipReason = `agent active (output ${Math.floor(outputAge / 1000)}s ago, quiet=${Math.floor(quietMs / 1000)}s)`;
      }
    }

    if (!skipReason) {
      // All checks passed — send CONTINUE
      session._timerIterationCount++;

      const runningCellId = findRunningCellId(session.notebook);
      if (runningCellId) {
        try {
          this.appendPrompt(session.id, runningCellId, CONTINUE_PROMPT);
        } catch (err) {
          console.error(`[session ${session.id}] Timer tick: appendPrompt failed:`, err);
        }
      } else if (!session._timerExecuting) {
        // No running cell — create a new cell and execute CONTINUE to drive progress
        // Guard: _timerExecuting prevents cascade when previous executeCell is still pending
        session._timerExecuting = true;
        const newCellId = crypto.randomUUID();
        console.log(`[session ${session.id}] Timer tick #${session._timerIterationCount}: no running cell, creating new cell ${newCellId}`);
        this.executeCell(session.id, newCellId, CONTINUE_PROMPT)
          .catch((err) => {
            console.error(`[session ${session.id}] Timer tick: executeCell failed:`, err);
          })
          .finally(() => {
            session._timerExecuting = false;
          });
      }
    } else {
      console.log(`[session ${session.id}] Timer tick: skipped (${skipReason})`);
    }

    // Always broadcast heartbeat — lets frontend distinguish "skipped" from "timer dead"
    this.broadcast(session, {
      type: 'timer_heartbeat',
      iteration: session._timerIterationCount,
      interval_ms: session._timerIntervalMs,
      skipped: skipReason ?? undefined,
    });
  }

  /** Best-effort auto-save: writes the in-memory notebook to disk and syncs DB metadata. */
  private async autoSave(session: NotebookSession): Promise<void> {
    try {
      await writeFile(session.notebookPath, JSON.stringify(session.notebook, null, 2), 'utf-8');
      if (session.notebookDbId) {
        this.onAutoSave?.(session.notebookDbId, session.notebook.cells.length);
      }
    } catch (err) {
      console.error(`[session ${session.id}] auto-save failed:`, err);
      // D3-fix: Notify frontend of save failure so user knows data may not be persisted
      this.broadcast(session, {
        type: 'autosave_error',
        error: 'Failed to save notebook. Please save manually.',
      });
      throw err; // Re-throw so caller can handle if needed
    }
  }

  /** Best-effort git commit after a cell execution completes. */
  private async tryGitCommit(session: NotebookSession, cellId: string): Promise<void> {
    const cell = session.notebook.cells.find((c) => c.id === cellId);
    const source = cell?.source ?? '';
    try {
      // Write the notebook to disk BEFORE committing so the cell's execution
      // state (outputs, status, duration_ms) is always included in the git
      // commit — even when Claude didn't create any workspace files this turn.
      await writeFile(session.notebookPath, JSON.stringify(session.notebook, null, 2), 'utf-8');

      const gitResult = await session.gitManager.commitCellExecution(cellId, source);
      if (gitResult) {
        // D4: git_diff no longer saved to notebook or broadcast - Git Preview tab provides this
        console.log(
          `[session ${session.id}] Committed cell "${cellId}" – ${gitResult.filesChanged.length} file(s) changed.`,
        );
      } else {
        console.log(`[session ${session.id}] No workspace changes for cell "${cellId}" – skipping git commit.`);
      }
    } catch (err: unknown) {
      console.warn(
        `[session ${session.id}] Git commit failed for cell "${cellId}":`,
        String(err),
      );
    }
  }

  /**
   * Converts a raw JSONL message from Claude Code into one or more
   * WSServerMessage events and broadcasts them to listeners.
   *
   * With `--input-format stream-json --output-format stream-json --verbose`,
   * Claude emits:
   *   - type "assistant"    → content blocks (text, thinking, tool_use)
   *   - type "result"       → final result text + is_error + definitive completion
   *   - type "user"         → tool results wrapped as { message: { content: [{ type: 'tool_result', ... }] } }
   *   - type "stream_event" → streaming deltas (forwarded as cell_stream for real-time rendering)
   *   - type "content_block_delta" → direct streaming deltas (forwarded as cell_stream)
   *   - type "system"       → system messages (ignored)
   */
  private handleJsonlMessage(session: NotebookSession, raw: unknown): void {
    const msg = raw as ClaudeJsonlMessage;

    switch (msg.type) {
      case 'assistant': {
        const assistant = msg as ClaudeTextMessage;
        const cellId = findRunningCellId(session.notebook);
        if (!cellId) break;

        for (const block of assistant.message.content) {
          let output: CellOutput | null = null;

          if (block.type === 'text') {
            output = {
              type: 'text',
              content: block.text,
              timestamp: new Date().toISOString(),
            };
          } else if (block.type === 'thinking') {
            output = {
              type: 'thinking',
              content: block.thinking,
              timestamp: new Date().toISOString(),
            };
          } else if (block.type === 'tool_use') {
            output = {
              type: 'tool_use',
              tool_use_id: block.id,
              name: block.name,
              input: block.input,
              // AskUserQuestion: isActive true means waiting for user answer
              ...(block.name === 'AskUserQuestion' && { isActive: true }),
              timestamp: new Date().toISOString(),
            };
            // Heartbeat: track pending tool execution (awaiting tool_result)
            session._pendingToolUseIds.add(block.id);
          }

          if (output) {
            // Heartbeat: update last output time
            session._lastOutputTime = Date.now();

            // Notify auto daemon of stream activity (for stall detection)
            if (output.type === 'text' || output.type === 'thinking') {
              const autoDaemon = getDaemon(session.id);
              if (autoDaemon) {
                autoDaemon.reportStreamActivity(
                  output.type === 'text' ? (output as { content: string }).content : undefined,
                );
              }
            }

            // D1: Only persist AskUserQuestion tool calls (user choices must survive reload)
            const shouldPersist = output.type !== 'tool_use' ||
              (output.type === 'tool_use' && output.name === 'AskUserQuestion');
            if (shouldPersist) {
              session.notebook = appendCellOutput(session.notebook, cellId, output);
            }
            // D1: Track persisted tool_use_ids for tool_result matching
            if (output.type === 'tool_use' && shouldPersist) {
              session._persistedToolUseIds.add((output as { tool_use_id: string }).tool_use_id);
            }
            this.broadcast(session, {
              type: 'cell_output',
              cell_id: cellId,
              output,
            });

            // Drive the live StreamingText/StreamingThinking components.
            // Claude CLI stream-json doesn't emit token-level deltas — it
            // only sends complete assistant blocks.  Feed the full text into
            // cell_stream so the frontend can render it progressively as
            // each block arrives (tool-use turns produce many blocks).
            if (block.type === 'text') {
              this.broadcast(session, {
                type: 'cell_stream',
                cell_id: cellId,
                delta: block.text,
                block_type: 'text',
              });
            } else if (block.type === 'thinking') {
              this.broadcast(session, {
                type: 'cell_stream',
                cell_id: cellId,
                delta: block.thinking,
                block_type: 'thinking',
              });
            }
          }
        }
        break;
      }

      case 'result': {
        const result = msg as ClaudeResultMessage;
        const cellId = findRunningCellId(session.notebook);
        if (!cellId) break;

        if (result.is_error && result.result) {
          // Broadcast error output — it won't appear in 'assistant' messages.
          const output: CellOutput = {
            type: 'error',
            message: result.result,
            timestamp: new Date().toISOString(),
          };
          session.notebook = appendCellOutput(session.notebook, cellId, output);
          this.broadcast(session, {
            type: 'cell_output',
            cell_id: cellId,
            output,
          });
        } else if (result.result) {
          // For slash commands (like /context, /cost), there are no 'assistant' messages —
          // the output is ONLY in result.result. Add it if the cell has no outputs yet.
          const cell = session.notebook.cells.find((c) => c.id === cellId);
          const hasOutput = cell?.type === 'prompt' && cell.outputs && cell.outputs.length > 0;
          if (!hasOutput) {
            const output: CellOutput = {
              type: 'text',
              content: result.result,
              timestamp: new Date().toISOString(),
            };
            session.notebook = appendCellOutput(session.notebook, cellId, output);
            this.broadcast(session, {
              type: 'cell_output',
              cell_id: cellId,
              output,
            });
          }
          // If cell already has output, result.result duplicates content from 'assistant' messages.
        }

        // Timer mode: detect rate/usage limit errors and pause to avoid spamming
        if (result.is_error && result.result && session._timerMode) {
          const isRateLimit = RATE_LIMIT_PATTERNS.some((p) => p.test(result.result));
          if (isRateLimit) {
            session._timerPausedUntil = Date.now() + AUTO_RATE_LIMIT_COOLDOWN_MS;
            console.warn(`[session ${session.id}] Rate limit detected, pausing timer mode for ${AUTO_RATE_LIMIT_COOLDOWN_MS / 1000}s`);
            this.broadcast(session, {
              type: 'timer_paused',
              reason: 'rate_limit',
              resume_at: session._timerPausedUntil,
              cooldown_ms: AUTO_RATE_LIMIT_COOLDOWN_MS,
            });
          }
        }

        // 'result' is the definitive completion signal — no idle timer needed.
        this.completeCell(session, cellId, result.is_error);
        break;
      }

      case 'user': {
        // Claude CLI stream-json sends tool results as:
        // { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id, content }] } }
        const userMsg = msg as any;
        const blocks = userMsg.message?.content;
        if (!Array.isArray(blocks)) break;

        for (const block of blocks) {
          if (block.type !== 'tool_result' || !block.tool_use_id) continue;

          const cellId = findCellByToolUseId(session.notebook, block.tool_use_id)
            ?? findRunningCellId(session.notebook);
          if (!cellId) continue;

          // Heartbeat: tool execution completed, remove from pending and reset notification flag
          session._pendingToolUseIds.delete(block.tool_use_id);
          session._toolLongRunningNotified = false;

          const content =
            typeof block.content === 'string'
              ? block.content
              : Array.isArray(block.content)
                ? block.content.map((b: any) => (b.type === 'text' ? (b.text ?? '') : '')).join('')
                : '';

          const isError = block.is_error ?? false;

          // D1: Only persist if corresponding tool_use was persisted (AskUserQuestion)
          if (session._persistedToolUseIds.has(block.tool_use_id)) {
            session.notebook = attachToolResult(session.notebook, cellId, block.tool_use_id, content, isError);
            session._persistedToolUseIds.delete(block.tool_use_id); // cleanup
          }

          this.broadcast(session, {
            type: 'tool_result',
            cell_id: cellId,
            tool_use_id: block.tool_use_id,
            content,
            is_error: isError,
          });
        }
        break;
      }

      case 'content_block_delta':
      case 'stream_event': {
        // stream_event may wrap the actual delta; content_block_delta is direct.
        const payload = msg.type === 'stream_event' ? (msg as any).event : msg;
        if (payload?.type !== 'content_block_delta') break;

        const cellId = findRunningCellId(session.notebook);
        if (!cellId) break;

        const delta = payload.delta;
        if (delta?.type === 'text_delta' && delta.text) {
          this.broadcast(session, {
            type: 'cell_stream',
            cell_id: cellId,
            delta: delta.text,
            block_type: 'text',
          });
        } else if (delta?.type === 'thinking_delta' && delta.thinking) {
          this.broadcast(session, {
            type: 'cell_stream',
            cell_id: cellId,
            delta: delta.thinking,
            block_type: 'thinking',
          });
        }
        break;
      }

      case 'system': {
        // Capture Claude session_id from system.init or hook_started for --resume support.
        // Claude CLI uses 'content' for local_command_output, 'message' for others
        const sysMsg = msg as { type: 'system'; subtype?: string; session_id?: string; message?: string; content?: string; hook_type?: string; hook_output?: string };
        // Capture session_id from init or hook_started (hook_started comes first, before any prompt)
        if ((sysMsg.subtype === 'init' || sysMsg.subtype === 'hook_started') && sysMsg.session_id && !session.claudeSessionId) {
          session.claudeSessionId = sysMsg.session_id;
          console.log(`[session ${session.id}] Captured Claude session_id from ${sysMsg.subtype}: ${sysMsg.session_id}`);
          // Persist to DB so server restart can --resume this session
          this.onClaudeSessionId?.(session.id, sysMsg.session_id);
        }
        // Log hook events for debugging .MEMORY.md loading
        if (sysMsg.subtype === 'hook_started' || sysMsg.subtype === 'hook_completed') {
          console.log(`[session ${session.id}] Hook event:`, JSON.stringify(sysMsg, null, 2));
        }
        // Forward non-init/hook system messages to frontend (e.g. context compaction, local_command_output)
        // Use _lastCellId as fallback since local_command_output may arrive after result completes the cell
        if (sysMsg.subtype && sysMsg.subtype !== 'init' && sysMsg.subtype !== 'hook_started' && sysMsg.subtype !== 'hook_completed') {
          this.broadcast(session, {
            type: 'system_message',
            subtype: sysMsg.subtype,
            message: sysMsg.content ?? sysMsg.message ?? '',
            cell_id: findRunningCellId(session.notebook) ?? session._lastCellId,
          } as any);
        }
        break;
      }

      default:
        break;
    }
  }
}

