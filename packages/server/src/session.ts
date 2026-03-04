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
  type QueuedPrompt,
} from '@notebook-ai/shared';
import { loadQueueFromFile, saveQueueToFile, createDebouncedSaver } from './queue-file.js';
import { EventBuffer } from './event-buffer.js';
import {
  updateCellStatus,
  updateCellDuration,
  appendCellOutput,
  attachToolResult,
  findRunningCellId,
  findCellByToolUseId,
} from './notebook-mutations.js';

// ── Prompt Queue Limits ───────────────────────────────────────────────────────

/** Maximum number of prompts in the queue */
export const MAX_QUEUE_LENGTH = 30;

/** Maximum size for a single image (5 MB) */
export const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

/** Maximum number of images across all queued prompts */
export const MAX_QUEUE_IMAGES = 10;

/** Maximum total size of images across all queued prompts (30 MB) */
export const MAX_QUEUE_IMAGES_SIZE = 30 * 1024 * 1024;

/** Base64 to bytes conversion ratio (base64 encoding adds ~33% overhead) */
export const BASE64_TO_BYTES_RATIO = 0.75;

// ── Heartbeat Constants ───────────────────────────────────────────────────────

/** Heartbeat check interval (30 seconds) */
export const HEARTBEAT_INTERVAL_MS = 30 * 1000;

/** Threshold for detecting stuck cells (120 seconds without output) */
export const STUCK_THRESHOLD_MS = 120 * 1000;

/** Maximum retry attempts for stuck cells before giving up */
export const MAX_STUCK_RETRIES = 3;

/** Prompt sent to unstick a stuck cell */
export const CONTINUE_PROMPT = '继续';

/** Threshold for notifying user about long-running tool (5 minutes) */
export const TOOL_LONG_RUNNING_MS = 5 * 60 * 1000;

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
  /** Prompt queue: pending prompts waiting for execution. */
  _promptQueue: QueuedPrompt[];
  /** Prompt queue version for optimistic locking (concurrency control). */
  _queueVersion: number;
  /** Debounced queue file saver. */
  _saveQueue: ((items: QueuedPrompt[], version: number) => void) & { flush: () => Promise<void> };
  /** Heartbeat: last time output was received from agent (ms timestamp). */
  _lastOutputTime: number;
  /** Heartbeat: number of "继续" retries sent for current stuck cell. */
  _stuckRetryCount: number;
  /** Heartbeat: interval timer reference. */
  _heartbeatTimer: ReturnType<typeof setInterval> | null;
  /** Heartbeat: tool_use IDs awaiting tool_result (tool execution in progress). */
  _pendingToolUseIds: Set<string>;
  /** Heartbeat: flag to prevent repeated tool_long_running notifications. */
  _toolLongRunningNotified: boolean;
}

// ── SessionManager ───────────────────────────────────────────────────────────

export class SessionManager {
  private sessions = new Map<string, NotebookSession>();

  /** Optional callback invoked after a successful auto-save to sync DB metadata. */
  onAutoSave?: (notebookDbId: string, cellCount: number) => void;

  /**
   * Creates a new notebook session: spawns a persistent `claude -p` process,
   * waits for it to initialise, and wires its stdout to the JSONL message handler.
   *
   * @param notebookPath  Absolute path to the .notebook.json file.
   * @param cwd           Working directory for the Claude process.
   * @param gitRoot       Root directory for GitManager (defaults to cwd).
   */
  async createSession(notebookPath: string, cwd: string, gitRoot?: string): Promise<NotebookSession> {
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

    // Load prompt queue from independent file
    const queuePath = path.join(cwd, '.prompt-queue.json');
    const queueData = await loadQueueFromFile(queuePath);

    // Create debounced queue saver (500ms debounce)
    const saveQueue = createDebouncedSaver(
      async (items: QueuedPrompt[], version: number) => {
        await saveQueueToFile(queuePath, items, version);
      },
      500,
    );

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
      _promptQueue: queueData.items,
      _queueVersion: queueData.version,
      _saveQueue: saveQueue,
      _lastOutputTime: Date.now(),
      _stuckRetryCount: 0,
      _heartbeatTimer: null,
      _pendingToolUseIds: new Set(),
      _toolLongRunningNotified: false,
    };

    // Start the agent process.  Messages arrive asynchronously via stdout.
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
    );

    this.sessions.set(sessionName, session);
    console.log(`[session] Created session "${sessionName}" for "${notebookPath}"`);

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

    // Stop old process
    session.agentProcess.stop();

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

    session._interrupted = true;
    session.agentProcess.interrupt();
    // Claude CLI will emit a 'result' message → completeCell() handles the rest
  }

  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Stop heartbeat timer
    this.stopHeartbeat(session);

    // D3: Await any pending post-completion work (git commit + autoSave) before closing
    await session._pendingPostComplete.catch(() => {});

    // D3-5: Flush pending queue writes before closing
    await session._saveQueue.flush();

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
  ): Promise<{ session: NotebookSession; reconnected: boolean }> {
    const existed = this.sessions.has(sessionName);
    const session = await this.createSession(notebookPath, cwd, gitRoot);
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

  // ── Prompt Queue Management ─────────────────────────────────────────────────

  /**
   * Get current queue state for a session.
   */
  getQueueState(sessionId: string): { items: QueuedPrompt[]; version: number } | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    return { items: session._promptQueue, version: session._queueVersion };
  }

  /**
   * Add a prompt to the queue. Returns error string if version mismatch or other failure.
   */
  addToQueue(
    sessionId: string,
    prompt: QueuedPrompt,
    clientVersion: number,
  ): { success: true } | { success: false; error: string; code: string } {
    const session = this.sessions.get(sessionId);
    if (!session) return { success: false, error: 'Session not found', code: 'SESSION_NOT_FOUND' };

    // Version check for optimistic locking
    if (clientVersion !== session._queueVersion) {
      return { success: false, error: 'Version mismatch', code: 'VERSION_MISMATCH' };
    }

    // Queue length limit
    if (session._promptQueue.length >= MAX_QUEUE_LENGTH) {
      return { success: false, error: `Queue is full (max ${MAX_QUEUE_LENGTH} items)`, code: 'QUEUE_FULL' };
    }

    // Image limits
    if (prompt.images && prompt.images.length > 0) {
      // Check individual image sizes
      for (const img of prompt.images) {
        const imgSize = img.data.length * BASE64_TO_BYTES_RATIO; // base64 to bytes approximation
        if (imgSize > MAX_IMAGE_SIZE) {
          return { success: false, error: `Image exceeds ${MAX_IMAGE_SIZE / 1024 / 1024}MB limit`, code: 'IMAGE_TOO_LARGE' };
        }
      }

      // Count total images in queue
      let totalImages = prompt.images.length;
      let totalImagesSize = prompt.images.reduce((sum, img) => sum + img.data.length * BASE64_TO_BYTES_RATIO, 0);
      for (const p of session._promptQueue) {
        if (p.images) {
          totalImages += p.images.length;
          totalImagesSize += p.images.reduce((sum, img) => sum + img.data.length * BASE64_TO_BYTES_RATIO, 0);
        }
      }

      if (totalImages > MAX_QUEUE_IMAGES) {
        return { success: false, error: `Too many images in queue (max ${MAX_QUEUE_IMAGES})`, code: 'TOO_MANY_IMAGES' };
      }

      if (totalImagesSize > MAX_QUEUE_IMAGES_SIZE) {
        return { success: false, error: `Total images size exceeds ${MAX_QUEUE_IMAGES_SIZE / 1024 / 1024}MB limit`, code: 'IMAGES_SIZE_EXCEEDED' };
      }
    }

    session._promptQueue.push(prompt);
    session._queueVersion++;
    session._saveQueue(session._promptQueue, session._queueVersion);

    // Broadcast updated queue state
    this.broadcast(session, {
      type: 'queue_state',
      items: session._promptQueue,
      version: session._queueVersion,
    });

    return { success: true };
  }

  /**
   * Remove a prompt from the queue by ID.
   */
  removeFromQueue(
    sessionId: string,
    promptId: string,
    clientVersion: number,
  ): { success: true } | { success: false; error: string; code: string } {
    const session = this.sessions.get(sessionId);
    if (!session) return { success: false, error: 'Session not found', code: 'SESSION_NOT_FOUND' };

    if (clientVersion !== session._queueVersion) {
      return { success: false, error: 'Version mismatch', code: 'VERSION_MISMATCH' };
    }

    const index = session._promptQueue.findIndex((p) => p.id === promptId);
    if (index === -1) {
      return { success: false, error: 'Prompt not found in queue', code: 'PROMPT_NOT_FOUND' };
    }

    session._promptQueue.splice(index, 1);
    session._queueVersion++;
    session._saveQueue(session._promptQueue, session._queueVersion);

    this.broadcast(session, {
      type: 'queue_state',
      items: session._promptQueue,
      version: session._queueVersion,
    });

    return { success: true };
  }

  /**
   * Reorder the queue by providing new order of IDs.
   */
  reorderQueue(
    sessionId: string,
    newOrder: string[],
    clientVersion: number,
  ): { success: true } | { success: false; error: string; code: string } {
    const session = this.sessions.get(sessionId);
    if (!session) return { success: false, error: 'Session not found', code: 'SESSION_NOT_FOUND' };

    if (clientVersion !== session._queueVersion) {
      return { success: false, error: 'Version mismatch', code: 'VERSION_MISMATCH' };
    }

    // Validate that newOrder contains exactly the same IDs
    const currentIds = new Set(session._promptQueue.map((p) => p.id));
    const newIds = new Set(newOrder);
    if (currentIds.size !== newIds.size || ![...currentIds].every((id) => newIds.has(id))) {
      return { success: false, error: 'Invalid order: IDs do not match', code: 'INVALID_ORDER' };
    }

    // Reorder
    const idToPrompt = new Map(session._promptQueue.map((p) => [p.id, p]));
    session._promptQueue = newOrder.map((id) => idToPrompt.get(id)!);
    session._queueVersion++;
    session._saveQueue(session._promptQueue, session._queueVersion);

    this.broadcast(session, {
      type: 'queue_state',
      items: session._promptQueue,
      version: session._queueVersion,
    });

    return { success: true };
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

    // Determine final status: interrupted > error > completed
    let status: 'completed' | 'error' | 'interrupted';
    if (session._interrupted) {
      status = 'interrupted';
      delete session._interrupted;
    } else {
      status = isError ? 'error' : 'completed';
    }
    session.notebook = updateCellStatus(session.notebook, cellId, status);

    // Heartbeat: reset stuck retry count and clear pending tools on completion
    session._stuckRetryCount = 0;
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

    // Process prompt queue: if not interrupted and queue has items, execute next
    if (status !== 'interrupted') {
      console.log(`[session ${session.id}] completeCell: scheduling processNextQueueItem (status=${status})`);
      setTimeout(() => this.processNextQueueItem(session), 0);
    } else {
      console.log(`[session ${session.id}] completeCell: skipping queue (status=${status})`);
    }
  }

  /**
   * Process the next item in the prompt queue.
   * Dequeues and executes the first prompt if no cell is currently running.
   */
  private processNextQueueItem(session: NotebookSession): void {
    console.log(`[session ${session.id}] processNextQueueItem called, queue length: ${session._promptQueue.length}`);

    // Skip if a cell is already running
    const runningId = findRunningCellId(session.notebook);
    if (runningId) {
      console.log(`[session ${session.id}] processNextQueueItem: cell ${runningId} still running, skipping`);
      return;
    }

    // Skip if queue is empty
    if (session._promptQueue.length === 0) {
      console.log(`[session ${session.id}] processNextQueueItem: queue empty, skipping`);
      return;
    }

    // Dequeue first item
    const prompt = session._promptQueue.shift()!;
    session._queueVersion++;
    session._saveQueue(session._promptQueue, session._queueVersion);

    // Broadcast updated queue state
    this.broadcast(session, {
      type: 'queue_state',
      items: session._promptQueue,
      version: session._queueVersion,
    });

    // Create new cell
    const cellId = crypto.randomUUID();
    const newCell = {
      id: cellId,
      type: 'prompt' as const,
      source: prompt.source,
      images: prompt.images,
      status: 'idle' as const,
      execution_count: 0,
      outputs: [] as CellOutput[],
      created_at: new Date().toISOString(),
    };
    session.notebook = {
      ...session.notebook,
      cells: [...session.notebook.cells, newCell],
    };

    // Broadcast cell_created to all subscribers (same as normal executeCell flow)
    this.broadcast(session, {
      type: 'cell_created',
      cell_id: cellId,
      source: prompt.source,
      images: prompt.images,
    });

    // Execute the cell
    console.log(`[session ${session.id}] processNextQueueItem: executing queued prompt "${prompt.source.slice(0, 50)}..." as cell ${cellId}`);
    this.executeCell(session.id, cellId, prompt.source, prompt.images).catch((err) => {
      console.error(`[session ${session.id}] Queue execute failed:`, err);
    });
  }

  // ── Heartbeat Mechanism ─────────────────────────────────────────────────────

  /**
   * Start heartbeat timer for a session.
   * Checks for stuck cells and processes queue periodically.
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
   * Stop heartbeat timer for a session.
   */
  stopHeartbeat(session: NotebookSession): void {
    if (session._heartbeatTimer) {
      clearInterval(session._heartbeatTimer);
      session._heartbeatTimer = null;
    }
  }

  /**
   * Heartbeat check: detect stuck cells and process queue.
   */
  private heartbeatCheck(session: NotebookSession): void {
    const runningCellId = findRunningCellId(session.notebook);

    if (runningCellId) {
      const now = Date.now();
      const elapsed = now - session._lastOutputTime;

      // Skip stuck detection if tools are executing (waiting for tool_result)
      if (session._pendingToolUseIds.size > 0) {
        // Notify user once if tool is taking unusually long (prevent spam)
        if (elapsed > TOOL_LONG_RUNNING_MS && !session._toolLongRunningNotified) {
          session._toolLongRunningNotified = true;
          this.broadcast(session, {
            type: 'tool_long_running',
            cell_id: runningCellId,
            elapsed_ms: elapsed,
            pending_tools: session._pendingToolUseIds.size,
          });
        }
        return;
      }

      // Check if cell is stuck (no output for STUCK_THRESHOLD_MS)

      if (elapsed > STUCK_THRESHOLD_MS) {
        // Cell appears stuck
        if (session._stuckRetryCount < MAX_STUCK_RETRIES) {
          session._stuckRetryCount++;
          console.log(
            `[session ${session.id}] Cell "${runningCellId}" stuck (${Math.round(elapsed / 1000)}s), ` +
            `sending "${CONTINUE_PROMPT}" (retry ${session._stuckRetryCount}/${MAX_STUCK_RETRIES})`
          );

          // Send continue prompt to unstick
          try {
            session.agentProcess.sendPrompt(CONTINUE_PROMPT);
          } catch (err) {
            console.error(`[session ${session.id}] Failed to send continue prompt:`, err);
          }

          // Reset output time to avoid immediate re-trigger
          session._lastOutputTime = Date.now();
        } else {
          // Retries exhausted — complete cell as error and notify frontend
          console.error(
            `[session ${session.id}] Cell "${runningCellId}" stuck after ${MAX_STUCK_RETRIES} retries, marking as error`
          );

          // Notify frontend of stuck exhaustion
          this.broadcast(session, {
            type: 'stuck_exhausted',
            cell_id: runningCellId,
            retries: MAX_STUCK_RETRIES,
          });

          // Complete the cell as error
          this.completeCell(session, runningCellId, true);
        }
      }
    } else {
      // No running cell — check if queue needs processing
      this.processNextQueueItem(session);
    }
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
              timestamp: new Date().toISOString(),
            };
            // Heartbeat: track pending tool execution (awaiting tool_result)
            session._pendingToolUseIds.add(block.id);
          }

          if (output) {
            // Heartbeat: update last output time
            session._lastOutputTime = Date.now();

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

