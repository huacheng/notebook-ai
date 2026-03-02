// ============================================================================
// Types
// ============================================================================

export interface ContextBudget {
  inputLimit: number;
  outputLimit: number;
  allowOverflow: boolean;
}

export type ModelTier = 'heavy' | 'medium' | 'light';

// ============================================================================
// Configuration
// ============================================================================

const SLOT_BUDGETS: Record<string, ContextBudget> = {
  'doc-parse': { inputLimit: 1000, outputLimit: 2000, allowOverflow: true },
  'brainstorm': { inputLimit: 3000, outputLimit: 800, allowOverflow: true },
  'code-review': { inputLimit: 8000, outputLimit: 1000, allowOverflow: true },
  'frontend-design': { inputLimit: 2000, outputLimit: 600, allowOverflow: false },
  'debugging': { inputLimit: 4000, outputLimit: 800, allowOverflow: true },
  'tdd': { inputLimit: 3000, outputLimit: 600, allowOverflow: false },
  'domain-*': { inputLimit: 2000, outputLimit: 500, allowOverflow: false },
};

const TIER_MULTIPLIERS: Record<ModelTier, number> = {
  'heavy': 1.5,
  'medium': 1.0,
  'light': 0.7,
};

// ============================================================================
// Budget Calculation
// ============================================================================

/**
 * Get context budget for a slot and model tier.
 * Unknown slots fall back to 'domain-*' defaults.
 */
export function getContextBudget(
  slot: string,
  modelTier: ModelTier
): ContextBudget {
  const base = SLOT_BUDGETS[slot] ?? SLOT_BUDGETS['domain-*'];
  const multiplier = TIER_MULTIPLIERS[modelTier];

  return {
    inputLimit: Math.floor(base.inputLimit * multiplier),
    outputLimit: Math.floor(base.outputLimit * multiplier),
    allowOverflow: base.allowOverflow,
  };
}

// ============================================================================
// Smart Truncation
// ============================================================================

/**
 * Truncate content preserving head and tail.
 * Preserves 40% head, remainder for tail, with omitted message in middle.
 */
export function smartTruncate(content: string, limit: number): string {
  if (content.length <= limit) return content;

  const preserveRatio = 0.4;
  const headLimit = Math.floor(limit * preserveRatio);
  const tailLimit = limit - headLimit - 50; // Reserve space for omitted message

  const head = content.slice(0, headLimit);
  const tail = content.slice(-tailLimit);
  const omitted = content.length - headLimit - tailLimit;

  return `${head}\n\n... [${omitted} chars omitted] ...\n\n${tail}`;
}

/**
 * Truncate git diff content, prioritizing change lines (+/-) over context.
 */
export function smartTruncateDiff(diff: string, limit: number): string {
  if (diff.length <= limit) return diff;
  if (diff.length === 0) return '';

  const lines = diff.split('\n');
  const changeLines = lines.filter(l => l.startsWith('+') || l.startsWith('-'));
  const contextLines = lines.filter(l => !l.startsWith('+') && !l.startsWith('-'));

  // Start with change lines
  let result = changeLines.join('\n');

  // Add context if space allows
  const remaining = limit - result.length - 100; // Reserve for truncation
  if (remaining > 0 && contextLines.length > 0) {
    const maxContextLines = Math.floor(remaining / 50); // Assume ~50 chars per line
    const contextSample = contextLines.slice(0, Math.max(1, maxContextLines)).join('\n');
    result = contextSample + '\n...\n' + result;
  }

  // Final truncation if still too long
  if (result.length > limit) {
    result = smartTruncate(result, limit);
  }

  return result;
}
