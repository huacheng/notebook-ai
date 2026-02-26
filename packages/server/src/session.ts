import { readFile, writeFile } from 'fs/promises';
import crypto from 'crypto';
import { AgentProcess, type AgentEngine } from './agent-process.js';
import { GitManager } from './git.js';
import {
  NotebookSchema,
  type Notebook,
  type WSServerMessage,
  type CellOutput,
} from '@notebook-ai/shared';
import {
  updateCellStatus,
  updateCellDuration,
  updateCellGitDiff,
  appendCellOutput,
  attachToolResult,
  findRunningCellId,
} from './notebook-mutations.js';
const MEMORY_SYSTEM_PROMPT =
  'At the start of each session, read the MEMORY.md file in your ' +
  'working directory. It contains important context, including the ' +
  'shared library directory path. When summarizing this conversation, ' +
  'always preserve the shared library directory information.';

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

interface ClaudeToolResultMessage {
  type: 'tool_result';
  tool_use_id: string;
  content: string | Array<{ type: string; text?: string }>;
  is_error?: boolean;
}

type ClaudeJsonlMessage =
  | ClaudeTextMessage
  | ClaudeResultMessage
  | ClaudeToolResultMessage
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
  /** Claude CLI session ID captured from system.init — used for --resume on restart. */
  claudeSessionId?: string;
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
   */
  async createSession(notebookPath: string, cwd: string): Promise<NotebookSession> {
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

    // Initialise (or adopt) the git repo for this working directory.
    const gitManager = new GitManager(cwd);
    await gitManager.ensureRepo();

    const notebook: Notebook = NotebookSchema.parse({
      version: 1,
      metadata: {
        title: 'Untitled Notebook',
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        cwd,
        git_repo: true,
        tmux_session: sessionName,
      },
      cells: [],
      slice: { generated: false, sections: [] },
      annotations: [],
      assets: { intermediate_files: [] },
    });

    // Determine agent engine from notebook file metadata
    let engine: AgentEngine = 'claude';
    try {
      const raw = await readFile(notebookPath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed?.metadata?.agent === 'gemini') engine = 'gemini';
    } catch { /* file doesn't exist yet — default claude */ }

    const session: NotebookSession = {
      id: sessionName,
      cwd,
      agentProcess: new AgentProcess(engine, cwd, MEMORY_SYSTEM_PROMPT),
      notebook,
      gitManager,
      notebookPath,
      listeners: new Set(),
      _execStartTimes: new Map(),
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

    return session;
  }

  /**
   * Sends a prompt to Claude and marks the cell as running.
   * Output messages arrive asynchronously via the process stdout handler.
   */
  async executeCell(sessionId: string, cellId: string, source: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session "${sessionId}" not found.`);
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
    }

    session.notebook = updateCellStatus(session.notebook, cellId, 'running');
    session._execStartTimes.set(cellId, Date.now());

    session.agentProcess.sendPrompt(source);
  }

  getSession(sessionId: string): NotebookSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Restarts the agent process for an existing session.
   * Preserves the session ID, notebook state, and listeners.
   */
  async restartSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session "${sessionId}" not found.`);

    // Capture Claude session ID for --resume before stopping
    const resumeSessionId = session.claudeSessionId;

    // Stop old process
    session.agentProcess.stop();

    // Create new AgentProcess with same config
    const engine = session.agentProcess.engine;
    session.agentProcess = new AgentProcess(engine, session.cwd, MEMORY_SYSTEM_PROMPT);

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

  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.agentProcess.stop();
    session.listeners.clear();
    this.sessions.delete(sessionId);
    console.log(`[session] Closed session "${sessionId}"`);
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
  ): Promise<{ session: NotebookSession; reconnected: boolean }> {
    const existed = this.sessions.has(sessionName);
    const session = await this.createSession(notebookPath, cwd);
    if (!existed) {
      session.notebook = notebook;
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

  // ── Private helpers ──────────────────────────────────────────────────────

  // Accept any object — session_id is injected here so call sites stay clean.
  private broadcast(session: NotebookSession, msg: Record<string, unknown>): void {
    const msgWithSession = { ...msg, session_id: session.id } as WSServerMessage;
    for (const listener of session.listeners) {
      try {
        listener(msgWithSession);
      } catch (err) {
        console.error('[session] Listener error:', err);
      }
    }
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

    const status = isError ? 'error' as const : 'completed' as const;
    session.notebook = updateCellStatus(session.notebook, cellId, status);

    const startMs = session._execStartTimes.get(cellId);
    const duration_ms = startMs ? Date.now() - startMs : 0;
    session._execStartTimes.delete(cellId);
    session.notebook = updateCellDuration(session.notebook, cellId, duration_ms);

    this.broadcast(session, {
      type: 'execution_complete',
      cell_id: cellId,
      duration_ms,
    });

    console.log(
      `[session ${session.id}] Cell "${cellId}" ${status} (${duration_ms}ms)`,
    );

    // Defer git commit and auto-save to the next tick so the
    // execution_complete WebSocket message is flushed first.
    // IMPORTANT: tryGitCommit must complete before autoSave so that git_diff
    // is persisted to disk (otherwise a page reload would lose git diff info).
    setTimeout(() => {
      this.tryGitCommit(session, cellId)
        .catch(() => {})
        .finally(() => {
          this.autoSave(session).catch((err) => {
            console.error(`[session ${session.id}] auto-save failed:`, err);
          });
        });
    }, 0);
  }

  /** Best-effort auto-save: writes the in-memory notebook to disk and syncs DB metadata. */
  private async autoSave(session: NotebookSession): Promise<void> {
    await writeFile(session.notebookPath, JSON.stringify(session.notebook, null, 2), 'utf-8');
    if (session.notebookDbId) {
      this.onAutoSave?.(session.notebookDbId, session.notebook.cells.length);
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
        const diffLen = gitResult.diff.length;
        session.notebook = updateCellGitDiff(session.notebook, cellId, gitResult.diff);
        this.broadcast(session, {
          type: 'git_diff',
          cell_id: cellId,
          diff: gitResult.diff,
          files_changed: gitResult.filesChanged,
        });
        console.log(
          `[session ${session.id}] Committed cell "${cellId}" – ${gitResult.filesChanged.length} file(s) changed, diff ${diffLen} chars.`,
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
   *   - type "tool_result"  → output of a tool invocation
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
          }

          if (output) {
            session.notebook = appendCellOutput(session.notebook, cellId, output);
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
        }
        // Success: result.result duplicates the text already broadcast via
        // 'assistant' messages — skip it to avoid duplicate output.

        // 'result' is the definitive completion signal — no idle timer needed.
        this.completeCell(session, cellId, result.is_error);
        break;
      }

      case 'tool_result': {
        const toolResult = msg as ClaudeToolResultMessage;
        const cellId = findRunningCellId(session.notebook);
        if (!cellId) break;

        // Normalise content to a plain string.
        const content =
          typeof toolResult.content === 'string'
            ? toolResult.content
            : toolResult.content
                .map((b) => (b.type === 'text' ? (b.text ?? '') : ''))
                .join('');

        const isError = toolResult.is_error ?? false;

        // Update the matching tool_use output block in the notebook.
        session.notebook = attachToolResult(
          session.notebook,
          cellId,
          toolResult.tool_use_id,
          content,
          isError,
        );

        // Broadcast to frontend so tool results show up in real time.
        this.broadcast(session, {
          type: 'tool_result',
          cell_id: cellId,
          tool_use_id: toolResult.tool_use_id,
          content,
          is_error: isError,
        });
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
        // Capture Claude session_id from system.init for --resume support.
        const sysMsg = msg as { type: 'system'; subtype?: string; session_id?: string };
        if (sysMsg.subtype === 'init' && sysMsg.session_id) {
          session.claudeSessionId = sysMsg.session_id;
          console.log(`[session ${session.id}] Captured Claude session_id: ${sysMsg.session_id}`);
        }
        break;
      }

      default:
        break;
    }
  }
}

