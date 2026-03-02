// ============================================================================
// Types
// ============================================================================

export type ErrorCategory = 'network' | 'timeout' | 'format' | 'empty' | 'plugin' | 'unknown';

export interface InvocationResult<T> {
  success: boolean;
  data?: T;
  error?: Error;
  attempts: number;
  totalTimeMs: number;
}

interface RetryPolicy {
  maxAttempts: number;
  backoffMs: number;
}

// ============================================================================
// Configuration
// ============================================================================

const RETRY_POLICIES: Record<ErrorCategory, RetryPolicy> = {
  'network': { maxAttempts: 2, backoffMs: 1000 },
  'timeout': { maxAttempts: 2, backoffMs: 2000 },
  'empty':   { maxAttempts: 1, backoffMs: 500 },
  'format':  { maxAttempts: 0, backoffMs: 0 },
  'plugin':  { maxAttempts: 0, backoffMs: 0 },
  'unknown': { maxAttempts: 0, backoffMs: 0 },
};

const SLOT_TIMEOUTS: Record<string, number> = {
  'doc-parse': 60000,
  'code-review': 45000,
  'debugging': 45000,
  'brainstorm': 35000,
  'tdd': 35000,
  'frontend-design': 30000,
  'domain-*': 30000,
};

// ============================================================================
// Error Categorization
// ============================================================================

const ERROR_PATTERNS: Record<ErrorCategory, RegExp[]> = {
  'network': [/ECONNREFUSED/i, /ENOTFOUND/i, /ETIMEDOUT/i, /network/i],
  'timeout': [/timeout/i, /timed out/i, /AbortError/i],
  'format': [/JSON/i, /parse/i, /Unexpected token/i, /format/i],
  'empty': [/empty/i, /no data/i],
  'plugin': [/plugin/i],
  'unknown': [],
};

/**
 * Categorize an error to determine retry policy.
 */
export function categorizeError(error: Error): ErrorCategory {
  const message = error.message;

  for (const [category, patterns] of Object.entries(ERROR_PATTERNS)) {
    if (category === 'unknown') continue;
    if (patterns.some(p => p.test(message))) {
      return category as ErrorCategory;
    }
  }

  return 'unknown';
}

// ============================================================================
// Timeout Configuration
// ============================================================================

/**
 * Get timeout for a slot.
 */
export function getSlotTimeout(slot: string): number {
  return SLOT_TIMEOUTS[slot] ?? SLOT_TIMEOUTS['domain-*'];
}

// ============================================================================
// Utility Functions
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function timeoutPromise(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error('timeout')), ms)
  );
}

// ============================================================================
// Retry Logic
// ============================================================================

/**
 * Invoke a function with retry logic based on error category.
 */
export async function invokeWithRetry<T>(
  fn: () => Promise<T>,
  slot: string
): Promise<InvocationResult<T>> {
  const timeout = getSlotTimeout(slot);
  const startTime = Date.now();
  let attempts = 0;
  let lastError: Error | undefined;

  while (true) {
    attempts++;
    try {
      const data = await Promise.race([fn(), timeoutPromise(timeout)]);

      // Treat null/undefined as empty
      if (data == null) {
        throw new Error('empty result');
      }

      return {
        success: true,
        data,
        attempts,
        totalTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      lastError = error as Error;
      const category = categorizeError(lastError);
      const policy = RETRY_POLICIES[category];

      // Check if we should retry
      if (attempts > policy.maxAttempts) {
        break;
      }

      // Apply backoff with exponential increase
      const backoff = policy.backoffMs * attempts;
      await sleep(backoff);
    }
  }

  return {
    success: false,
    error: lastError,
    attempts,
    totalTimeMs: Date.now() - startTime,
  };
}
