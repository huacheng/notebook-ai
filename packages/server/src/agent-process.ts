import { spawn, type ChildProcess } from 'child_process';
import * as readline from 'readline';

export type AgentEngine = 'claude' | 'gemini';

/**
 * AgentProcess wraps a persistent agent subprocess (Claude Code or Gemini CLI).
 * It stays alive in memory and waits for prompts via stdin.
 */
export class AgentProcess {
  private proc: ChildProcess | null = null;
  private rl: readline.Interface | null = null;

  constructor(
    public readonly engine: AgentEngine,
    private readonly cwd: string,
    private readonly systemPrompt?: string,
  ) {}

  /**
   * Spawns the agent process and sets up persistent communication.
   */
  async start(
    onMessage: (msg: unknown) => void,
    onExit?: (code: number | null) => void,
  ): Promise<void> {
    const env = { ...process.env };
    delete env['CLAUDECODE'];

    const args: string[] = [];

    if (this.engine === 'claude') {
      args.push(
        '-p',
        '--input-format', 'stream-json',
        '--output-format', 'stream-json',
        '--verbose',
        '--dangerously-skip-permissions',
        '--tools', 'default',
      );
      if (this.systemPrompt) {
        args.push('--append-system-prompt', this.systemPrompt);
      }
    } else {
      // Gemini CLI
      args.push(
        '-o', 'stream-json',
        '-y', // YOLO mode
      );
      // To keep Gemini resident, we don't pass a prompt argument.
      // Depending on the version, it might need '--prompt' '' or just no prompt.
    }

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
        onMessage(msg);
      } catch (e) {
        // Silently ignore non-JSON output
      }
    });

    // Wait for the process to emit its first line of output to confirm it's ready.
    await this._waitForFirstOutput();
  }

  /**
   * Sends a raw text prompt to the resident agent.
   * Internal logic handles engine-specific protocol (like Claude's JSON wrapper).
   */
  sendPrompt(prompt: string): void {
    if (!this.proc?.stdin) {
      throw new Error(`${this.engine} process is not running.`);
    }

    if (this.engine === 'claude') {
      // Claude persistent mode requires prompts to be wrapped in JSON lines
      const line = JSON.stringify({
        type: 'user',
        message: { role: 'user', content: prompt },
      });
      this.proc.stdin.write(line + '\n');
    } else {
      // Gemini and standard interactive CLI tools take raw text
      this.proc.stdin.write(prompt + '\n');
    }
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
    return this.proc !== null && this.proc.exitCode === null && !this.proc.killed;
  }

  private _waitForFirstOutput(timeoutMs = 20_000): Promise<void> {
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
