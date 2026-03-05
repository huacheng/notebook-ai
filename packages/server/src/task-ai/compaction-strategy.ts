import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Types
// ============================================================================

export interface CompactionDecision {
  shouldCompact: boolean;
  reason: string;
}

export interface SummaryContext {
  notebook: string;
  status: string;
  phase: string;
  nextStep: string;
  branch: string;
}

export interface ValidationResult {
  ready: boolean;
  errors: string[];
}

export interface RecoverySignal {
  type: 'human';
  message: string;
}

// ============================================================================
// Compaction Decision
// ============================================================================

/**
 * Determine whether to trigger structured compaction.
 * Strategy: Only compact once (on first trigger at 82%), then rely on file recovery.
 */
export function shouldCompact(
  usage: number,
  compactionCount: number
): CompactionDecision {
  // Strategy: only trigger compaction once, then rely on file recovery
  if (compactionCount >= 1) {
    return {
      shouldCompact: false,
      reason: 'Already compacted once, rely on file recovery',
    };
  }

  if (usage >= 0.82) {
    return {
      shouldCompact: true,
      reason: `Usage ${(usage * 100).toFixed(1)}% >= 82% threshold`,
    };
  }

  return { shouldCompact: false, reason: 'Below threshold' };
}

// ============================================================================
// Compaction Detection
// ============================================================================

const COMPACTION_INDICATORS = [
  'ran out of context',
  'conversation that ran out of context',
  'context window limit',
  'session is being continued',
];

/**
 * Detect if output indicates Claude system performed context compaction.
 */
export function detectCompaction(output: string): boolean {
  const lower = output.toLowerCase();
  return COMPACTION_INDICATORS.some(indicator =>
    lower.includes(indicator.toLowerCase())
  );
}

// ============================================================================
// Summary Writer with Recovery Header
// ============================================================================

const RECOVERY_HEADER = `<!-- TASK-AI RECOVERY CONTEXT -->
<!-- If you see this after context compaction, execute recovery protocol: -->
<!-- 1. Read .auto-signal for loop position -->
<!-- 2. Read .status.json for status -->
<!-- 3. Resume from \`next\` step -->

`;

/**
 * Write summary content with recovery header prepended.
 * This ensures agent can recover context after system compaction.
 */
export function writeSummaryWithRecoveryHeader(
  content: string,
  ctx: SummaryContext
): string {
  const statusLine = `# Task: ${ctx.notebook}
**Status**: ${ctx.status} | **Phase**: ${ctx.phase} | **Next**: ${ctx.nextStep}
**Branch**: ${ctx.branch}

---

`;
  return RECOVERY_HEADER + statusLine + content;
}

// ============================================================================
// Recovery Validation
// ============================================================================

interface CheckScore {
  overall?: number;
  d1_correctness?: number;
  d2_security?: number;
  d3_reliability?: number;
  d4_performance?: number;
  d5_architecture?: number;
  d6_maintainability?: number;
}

interface AutoSignal {
  step?: string;
  result?: string;
  next?: string;
  iteration?: number;
  timestamp?: string;
  phase?: string;
  phase_progress?: number;
  check_score?: CheckScore | null;
  retry_count?: number;
  delegation_failures?: string[];
}

interface StatusJson {
  status?: string;
  title?: string;
  type?: string;
  branch?: string;
}

function readAutoSignal(workingDir: string): AutoSignal | null {
  const filePath = path.join(workingDir, '.auto-signal');
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function readStatusJson(workingDir: string): StatusJson | null {
  const filePath = path.join(workingDir, '.status.json');
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function readSummaryMd(workingDir: string): string | null {
  const filePath = path.join(workingDir, '.summary.md');
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Validate that all required recovery files exist and contain required fields.
 */
export function validateRecoveryReadiness(workingDir: string): ValidationResult {
  const errors: string[] = [];

  // 1. .auto-signal exists and contains required fields
  const signal = readAutoSignal(workingDir);
  if (!signal) {
    errors.push('.auto-signal missing');
  } else {
    for (const field of ['step', 'next', 'iteration', 'timestamp', 'phase', 'phase_progress', 'retry_count']) {
      if (!(field in signal) || (signal as Record<string, unknown>)[field] === undefined) {
        errors.push(`.auto-signal missing field: ${field}`);
      }
    }
  }

  // 2. .status.json exists and contains required fields
  const index = readStatusJson(workingDir);
  if (!index) {
    errors.push('.status.json missing');
  } else {
    for (const field of ['status', 'title', 'type', 'branch']) {
      if (!(field in index) || index[field as keyof StatusJson] === undefined) {
        errors.push(`.status.json missing field: ${field}`);
      }
    }
  }

  // 3. .summary.md exists and contains recovery header
  const summary = readSummaryMd(workingDir);
  if (!summary) {
    errors.push('.summary.md missing');
  } else if (!summary.includes('TASK-AI RECOVERY CONTEXT')) {
    errors.push('.summary.md missing recovery header');
  }

  return {
    ready: errors.length === 0,
    errors,
  };
}

// ============================================================================
// Recovery Signal Builder
// ============================================================================

/**
 * Build a recovery signal to send to agent after compaction detection.
 */
export function buildRecoverySignal(workingDir: string): RecoverySignal {
  return {
    type: 'human',
    message: `Context compacted by system. Execute recovery protocol:

1. Read ${workingDir}/.auto-signal — get iteration, step, next
2. Read ${workingDir}/.status.json — confirm status
3. Read ${workingDir}/.summary.md — restore task context
4. Resume auto loop from \`next\` step

Do NOT ask for confirmation. Execute recovery and continue.`,
  };
}
