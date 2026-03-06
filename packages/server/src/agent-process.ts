import { spawn, type ChildProcess } from 'child_process';
import * as readline from 'readline';
import type { PromptImage } from '@notebook-ai/shared';

export type AgentEngine = 'claude' | 'gemini';

/** D6: Timeout in ms waiting for agent process to start */
export const AGENT_START_TIMEOUT_MS = 20_000;

/**
 * AgentProcess wraps a persistent agent subprocess (Claude Code or Gemini CLI).
 * It stays alive in memory and waits for prompts via stdin.
 */
export class AgentProcess {
  private proc: ChildProcess | null = null;
  private rl: readline.Interface | null = null;
  private claudeSessionId: string | null = null;

  constructor(
    public readonly engine: AgentEngine,
    private readonly cwd: string,
    private readonly systemPrompt?: string,
    public readonly model?: string,
    private readonly allowedDirs?: string[],
  ) {}

  getClaudeSessionId(): string | null {
    return this.claudeSessionId;
  }

  /** Build CLI args — extracted for testability. */
  _buildArgs(resumeSessionId?: string): string[] {
    const args: string[] = [];

    if (this.engine === 'claude') {
      args.push(
        '-p',
        '--input-format', 'stream-json',
        '--output-format', 'stream-json',
        '--verbose',
        '--permission-mode', 'bypassPermissions',
        '--tools', 'default',
      );
      if (this.model) {
        args.push('--model', this.model);
      }
      if (resumeSessionId) {
        args.push('--resume', resumeSessionId);
      }
      if (this.systemPrompt) {
        args.push('--append-system-prompt', this.systemPrompt);
      }
      if (this.allowedDirs) {
        for (const dir of this.allowedDirs) {
          args.push('--add-dir', dir);
        }
      }
    } else {
      // Gemini CLI
      args.push(
        '-o', 'stream-json',
        '-y', // YOLO mode
      );
    }

    return args;
  }

  /**
   * Spawns the agent process and sets up persistent communication.
   */
  async start(
    onMessage: (msg: unknown) => void,
    onExit?: (code: number | null) => void,
    resumeSessionId?: string,
  ): Promise<void> {
    const env = { ...process.env };
    delete env['CLAUDECODE'];

    const args = this._buildArgs(resumeSessionId);

    console.log(`[agent-process] Starting persistent ${this.engine} in ${this.cwd}...`);

    this.proc = spawn(this.engine, args, {
      cwd: this.cwd,
      env,
      stdio: ['pipe', 'pipe', 'inherit'],
    });

    this.proc.on('error', (err) => {
      console.error(`[agent-process] ${this.engine} spawn error:`, err.message);
    });

    if (onExit) {
      this.proc.on('exit', (code) => {
        console.log(`[agent-process] ${this.engine} exited with code ${code}`);
        this.proc = null;
        onExit(code);
      });
    }

    this.rl = readline.createInterface({
      input: this.proc.stdout!,
      crlfDelay: Infinity,
    });

    this.rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const msg = JSON.parse(trimmed);
        // Capture Claude session_id from system.init message
        if (msg.type === 'system' && msg.subtype === 'init' && msg.session_id) {
          this.claudeSessionId = msg.session_id;
        }
        onMessage(msg);
      } catch {
        // Ignore non-JSON lines (verbose output)
      }
    });

    // Wait for the process to emit its first line of output to confirm it's ready.
    await this._waitForFirstOutput();
  }

  /**
   * Sends a raw text prompt to the resident agent.
   * Internal logic handles engine-specific protocol (like Claude's JSON wrapper).
   */
  sendPrompt(prompt: string, images?: PromptImage[]): void {
    if (!this.proc?.stdin) {
      throw new Error(`${this.engine} process is not running.`);
    }

    if (this.engine === 'claude') {
      const hasImages = images && images.length > 0;
      const content = hasImages
        ? [
            { type: 'text', text: prompt },
            ...images.map((img) => ({
              type: 'image',
              source: { type: 'base64', media_type: img.media_type, data: img.data },
            })),
          ]
        : prompt;

      const line = JSON.stringify({
        type: 'user',
        message: { role: 'user', content },
      });
      this.proc.stdin.write(line + '\n');
    } else {
      // Gemini and standard interactive CLI tools take raw text
      this.proc.stdin.write(prompt + '\n');
    }
  }

  /**
   * Sends a tool_result back to Claude via stdin (stream-json format).
   * Used when the frontend collects user input for AskUserQuestion.
   */
  sendToolResult(toolUseId: string, content: string, isError = false): void {
    if (!this.proc?.stdin) {
      throw new Error(`${this.engine} process is not running.`);
    }
    if (this.engine !== 'claude') {
      throw new Error('Tool results only supported for Claude engine');
    }

    const line = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: toolUseId, content, is_error: isError }],
      },
    });
    this.proc.stdin.write(line + '\n');
  }

  /** Send SIGINT to interrupt current generation without killing the process. */
  interrupt(): void {
    if (!this.isAlive()) return;
    this.proc!.kill('SIGINT');
  }

  /** Terminates the persistent agent process. */
  stop(): void {
    this.rl?.close();
    this.rl = null;
    if (this.proc) {
      try { this.proc.stdin?.end(); } catch { /* ignore */ }
      try { this.proc.kill('SIGTERM'); } catch { /* ignore */ }
      this.proc = null;
    }
  }

  isAlive(): boolean {
    // Note: proc.killed becomes true after any kill signal (including SIGINT),
    // but SIGINT doesn't terminate the process—it just interrupts current generation.
    // We should only check exitCode to determine if the process is truly dead.
    return this.proc !== null && this.proc.exitCode === null;
  }

  private _waitForFirstOutput(timeoutMs = AGENT_START_TIMEOUT_MS): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error(`Timed out waiting for ${this.engine} to start.`));
        }
      }, timeoutMs);

      this.rl!.once('line', () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve();
        }
      });

      this.proc!.once('exit', (code) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error(`${this.engine} exited early with code ${code}`));
        }
      });
    });
  }
}
