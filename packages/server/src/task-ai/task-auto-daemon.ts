import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';

// Signal validation whitelists (from SKILL.md §Signal Validation)
const VALID_STEPS = new Set([
  'plan', 'check', 'exec', 'merge', 'highlight', 'report',
  'research', 'verify', 'annotate',
]);

const VALID_PHASES = new Set(['target', 'planning', 'execution', 'finalization']);

export interface AutoSignal {
  step: string;
  result: string;
  next: string;
  iteration: number;
  compaction_count?: number;
  phase: string;
  phase_progress: number;
  stage?: { current: number; total: number } | null;
  check_score: {
    overall: number;
    d1_correctness: number;
    d2_security: number;
    d3_reliability: number;
    d4_performance: number;
    d5_architecture: number;
    d6_maintainability: number;
  } | null;
  retry_count: number;
  delegation_failures: string[];
  timestamp: string;
}

export interface TaskAutoDaemonOptions {
  sessionId: string;
  taskDir: string;
  maxIterations: number;
  timeoutMinutes: number;
}

export class TaskAutoDaemon extends EventEmitter {
  readonly sessionId: string;
  private taskDir: string;
  private maxIterations: number;
  private timeoutMinutes: number;
  private _status: 'idle' | 'running' | 'stopped' = 'idle';
  private watcher: fs.FSWatcher | null = null;
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  startedAt: number = 0;

  constructor(opts: TaskAutoDaemonOptions) {
    super();
    this.sessionId = opts.sessionId;
    this.taskDir = opts.taskDir;
    this.maxIterations = opts.maxIterations;
    this.timeoutMinutes = opts.timeoutMinutes;
  }

  get status() {
    return this._status;
  }

  start(): void {
    if (this._status === 'running') return;
    this._status = 'running';
    this.startedAt = Date.now();

    // Watch taskDir for .auto-signal changes
    try {
      this.watcher = fs.watch(this.taskDir, (_eventType, filename) => {
        if (filename === '.auto-signal') {
          this.handleSignalChange();
        }
      });
    } catch {
      // Directory might not exist yet — use polling fallback
      this.watcher = null;
    }

    // Timeout timer
    if (this.timeoutMinutes > 0) {
      this.timeoutTimer = setTimeout(() => {
        this.writeStopFile('timeout');
        this.emit('complete', 'timeout');
      }, this.timeoutMinutes * 60 * 1000);
    }
  }

  stop(): void {
    if (this._status === 'stopped') return;
    this._status = 'stopped';

    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
  }

  private handleSignalChange(): void {
    const signalPath = path.join(this.taskDir, '.auto-signal');

    let raw: string;
    try {
      raw = fs.readFileSync(signalPath, 'utf-8');
    } catch {
      return; // File might be mid-write
    }

    let signal: AutoSignal;
    try {
      signal = JSON.parse(raw);
    } catch {
      return; // Corrupt JSON — wait for next write
    }

    // Validate fields and emit warnings for invalid values
    const warnings: string[] = [];
    if (signal.step && !VALID_STEPS.has(signal.step)) {
      warnings.push(`Invalid step: ${signal.step}`);
    }
    if (signal.phase && !VALID_PHASES.has(signal.phase)) {
      warnings.push(`Invalid phase: ${signal.phase}`);
    }

    for (const w of warnings) {
      this.emit('warning', w);
    }

    // Emit signal event (even if validation warnings — daemon is observer)
    this.emit('signal', signal);

    // Check iteration limit
    if (typeof signal.iteration === 'number' && signal.iteration >= this.maxIterations) {
      this.writeStopFile('max_iterations');
    }

    // Check natural completion
    if (signal.next === '(stop)') {
      this.emit('complete', 'natural');
    }
  }

  private writeStopFile(reason: string): void {
    const stopPath = path.join(this.taskDir, '.auto-stop');
    const data = JSON.stringify({
      reason,
      timestamp: new Date().toISOString(),
    }, null, 2);

    // Atomic write
    const tmpPath = stopPath + '.tmp';
    try {
      fs.writeFileSync(tmpPath, data, 'utf-8');
      fs.renameSync(tmpPath, stopPath);
    } catch {
      // Best-effort — directory might be gone
    }
  }
}
