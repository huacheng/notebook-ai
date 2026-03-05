import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { detectCompaction, buildRecoverySignal } from './compaction-strategy.js';

// Signal validation whitelists (from SKILL.md §Signal Validation)
const VALID_STEPS = new Set([
  'plan', 'check', 'exec', 'merge', 'highlight', 'report',
  'research', 'verify', 'annotate',
]);

const VALID_PHASES = new Set(['target', 'planning', 'execution', 'finalization']);

// Stall detection constants
const HEARTBEAT_INTERVAL_MS = 60_000;
const STALL_THRESHOLD = 3; // consecutive idle heartbeats before stall suspected
const MAX_RECOVERIES_PER_ITERATION = 3;
const MAX_RECOVERIES_TOTAL = 10;
const DEDUP_WINDOW_SIZE = 5;
const DEDUP_IDENTICAL_THRESHOLD = 3;

// Quota exhaustion keywords (case-insensitive match)
const QUOTA_KEYWORDS = [
  'rate limit', 'quota exceeded', 'usage limit',
  'token limit', 'try again later',
];

// Stall pattern matchers (ordered by priority)
const STALL_PATTERNS: Array<{
  name: string;
  test: (msg: string) => boolean;
  message: string;
}> = [
  {
    name: 'continuation',
    test: (msg) => /continue\??|press enter/i.test(msg),
    message: 'continue',
  },
  {
    name: 'yesno',
    test: (msg) => /\(y\/n\)|\[y\/n\]|\[Y\/n\]|\[y\/N\]/i.test(msg),
    message: 'y',
  },
  {
    name: 'proceed',
    test: (msg) => /do you want to proceed|shall i continue/i.test(msg),
    message: 'yes',
  },
];

export interface AutoSignal {
  step: string;
  result: string;
  next: string;
  checkpoint?: string;
  iteration: number;
  compaction_count?: number;
  vfp_cycles_completed?: number;
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

export interface StallRecoveryAction {
  type: 'idle' | 'dedup' | 'step_timeout';
  pattern?: string;
  message?: string;
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
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  startedAt: number = 0;

  // Stall detection state
  private lastActivityTimestamp: number = 0;
  private stallCount: number = 0;
  private recoveryCountIteration: number = 0;
  private recoveryCountTotal: number = 0;
  private lastMessage: string = '';
  private messageHashes: string[] = [];
  private dedupRecoveryFails: number = 0;
  private isQuotaWait: boolean = false;

  // Timeout suspension during quota-wait
  private timeoutRemainingMs: number = 0;

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
    this.lastActivityTimestamp = Date.now();

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

    // Heartbeat polling timer
    this.heartbeatTimer = setInterval(() => {
      this.heartbeatPoll();
    }, HEARTBEAT_INTERVAL_MS);
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
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Called externally when a stream-json message is received from the agent.
   * Optional content parameter enables content-level detection (dedup, pattern matching).
   */
  reportStreamActivity(content?: string): void {
    this.lastActivityTimestamp = Date.now();
    this.stallCount = 0;

    // Exit quota-wait if we receive a non-quota message
    if (this.isQuotaWait) {
      const isQuotaMsg = content && QUOTA_KEYWORDS.some((kw) => content.toLowerCase().includes(kw));
      if (isQuotaMsg) {
        // Still quota-limited
        this.emit('quota-wait', { keyword: 'rate limit', content });
        return;
      }
      // Non-quota message — exit quota-wait, resume timeout
      this.exitQuotaWait();
    }

    if (content) {
      this.lastMessage = content;

      // Content-level dedup detection
      const hash = crypto.createHash('sha256').update(content).digest('hex');
      this.messageHashes.push(hash);
      if (this.messageHashes.length > DEDUP_WINDOW_SIZE) {
        this.messageHashes.shift();
      }

      // Check for system compaction (highest priority after quota)
      if (detectCompaction(content)) {
        const signal = buildRecoverySignal(this.taskDir);
        this.emit('compaction-recovery', signal);
        return;
      }

      // Check for quota exhaustion keywords (first time)
      const lower = content.toLowerCase();
      for (const kw of QUOTA_KEYWORDS) {
        if (lower.includes(kw)) {
          this.enterQuotaWait();
          this.emit('quota-wait', { keyword: kw, content });
          return;
        }
      }

      // Check for 3 identical consecutive hashes
      if (this.messageHashes.length >= DEDUP_IDENTICAL_THRESHOLD) {
        const tail = this.messageHashes.slice(-DEDUP_IDENTICAL_THRESHOLD);
        if (tail.every((h) => h === tail[0])) {
          this.dedupRecoveryFails++;
          if (this.dedupRecoveryFails > 2) {
            this.writeStopFile('reasoning_loop');
            this.emit('complete', 'reasoning_loop');
          } else {
            this.emitRecovery({
              type: 'dedup',
              message: 'You appear to be in a loop. Stop current approach. Re-read .auto-signal and .status.json to determine your next step, then proceed.',
            });
          }
          // Reset hashes after detection
          this.messageHashes = [];
        }
      }
    }
  }

  private enterQuotaWait(): void {
    this.isQuotaWait = true;
    this.stallCount = 0;

    // Suspend timeout: calculate remaining time and clear timer
    if (this.timeoutTimer && this.timeoutMinutes > 0) {
      const elapsed = Date.now() - this.startedAt;
      const totalTimeout = this.timeoutMinutes * 60 * 1000;
      this.timeoutRemainingMs = Math.max(0, totalTimeout - elapsed);
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
  }

  private exitQuotaWait(): void {
    this.isQuotaWait = false;

    // Resume timeout with remaining time
    if (this.timeoutRemainingMs > 0 && !this.timeoutTimer) {
      this.timeoutTimer = setTimeout(() => {
        this.writeStopFile('timeout');
        this.emit('complete', 'timeout');
      }, this.timeoutRemainingMs);
      this.timeoutRemainingMs = 0;
    }
  }

  private heartbeatPoll(): void {
    if (this._status !== 'running') return;
    if (this.isQuotaWait) return; // Don't count quota wait as stall

    const idleMs = Date.now() - this.lastActivityTimestamp;
    if (idleMs >= HEARTBEAT_INTERVAL_MS) {
      this.stallCount++;
    } else {
      this.stallCount = 0;
      return;
    }

    if (this.stallCount >= STALL_THRESHOLD) {
      this.handleStall();
    }
  }

  private handleStall(): void {
    // Check recovery limits
    if (this.recoveryCountIteration >= MAX_RECOVERIES_PER_ITERATION ||
        this.recoveryCountTotal >= MAX_RECOVERIES_TOTAL) {
      this.writeStopFile('stall_limit');
      this.emit('complete', 'stall_limit');
      this.stop();
      return;
    }

    // Pattern match the last message
    for (const pattern of STALL_PATTERNS) {
      if (this.lastMessage && pattern.test(this.lastMessage)) {
        this.emitRecovery({
          type: 'idle',
          pattern: pattern.name,
          message: pattern.message,
        });
        this.stallCount = 0;
        return;
      }
    }

    // No pattern matched — generic idle recovery
    this.emitRecovery({ type: 'idle' });
    this.stallCount = 0;
  }

  private emitRecovery(action: StallRecoveryAction): void {
    this.recoveryCountIteration++;
    this.recoveryCountTotal++;
    this.emit('stall-recovery', action);
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

    // Reset per-iteration recovery counter on new signal
    this.recoveryCountIteration = 0;
    this.dedupRecoveryFails = 0;
    this.lastActivityTimestamp = Date.now();
    this.stallCount = 0;

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
