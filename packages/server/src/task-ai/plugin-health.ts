// ============================================================================
// Types
// ============================================================================

export interface PluginHealthRecord {
  plugin: string;
  slot: string;
  invocations: number;
  success: number;
  fail: number;
  timeout: number;
  confidenceSum: number; // sum of confidence scores (high=1, medium=0.6, low=0.3)
  recentResults: ('success' | 'fail' | 'timeout')[];
}

export interface HealthScore {
  score: number; // 0.0 - 1.0
  successRate: number;
  avgConfidence: number;
  recentTrend: 'improving' | 'stable' | 'declining';
}

export interface PluginCandidate {
  plugin: string;
  slot: string;
  relevanceScore: number;
}

export type ConfidenceLevel = 'high' | 'medium' | 'low';
export type ResultType = 'success' | 'fail' | 'timeout';

// ============================================================================
// Constants
// ============================================================================

const CONFIDENCE_VALUES: Record<ConfidenceLevel, number> = {
  high: 1.0,
  medium: 0.6,
  low: 0.3,
};

const MAX_RECENT_RESULTS = 10;
const MIN_SAMPLES_FOR_FULL_WEIGHT = 5;

// ============================================================================
// Trend Calculation
// ============================================================================

function calculateTrend(recent: ('success' | 'fail' | 'timeout')[]): 'improving' | 'stable' | 'declining' {
  if (recent.length < 6) return 'stable';

  // Compare last 5 vs previous 5
  const recent5 = recent.slice(-5).filter(r => r === 'success').length;
  const prev5 = recent.slice(-10, -5).filter(r => r === 'success').length;

  if (recent5 - prev5 >= 2) return 'improving';
  if (prev5 - recent5 >= 2) return 'declining';
  return 'stable';
}

// ============================================================================
// Health Score Calculation
// ============================================================================

/**
 * Calculate health score for a plugin based on historical performance.
 *
 * Formula: 60% success rate + 30% average confidence + 10% trend bonus
 * With sample penalty for low invocation counts.
 */
export function calculateHealthScore(record: PluginHealthRecord): HealthScore {
  // Default values for new plugins
  const successRate = record.invocations > 0
    ? record.success / record.invocations
    : 0.5;

  const avgConfidence = record.invocations > 0
    ? record.confidenceSum / record.invocations
    : 0.5;

  // Recent trend calculation
  const recentTrend = calculateTrend(record.recentResults);
  const trendBonus = recentTrend === 'improving' ? 0.05 :
                     recentTrend === 'declining' ? -0.05 : 0;

  // Combined score: 60% success rate + 30% avg confidence + 10% trend
  const rawScore = 0.6 * successRate + 0.3 * avgConfidence + 0.1 * (0.5 + trendBonus * 10);

  // Sample penalty: shrink toward 0.5 when samples < 5
  const samplePenalty = Math.min(record.invocations / MIN_SAMPLES_FOR_FULL_WEIGHT, 1);
  const score = 0.5 + (rawScore - 0.5) * samplePenalty;

  return {
    score: Math.max(0, Math.min(1, score)),
    successRate,
    avgConfidence,
    recentTrend,
  };
}

// ============================================================================
// Plugin Selection
// ============================================================================

/**
 * Select the best plugin from candidates based on combined relevance and health score.
 *
 * Combined score = 70% relevance + 30% health
 */
export function selectBestPlugin(
  candidates: PluginCandidate[],
  healthRegistry: Map<string, PluginHealthRecord>
): PluginCandidate {
  if (candidates.length === 0) {
    throw new Error('No candidates provided');
  }

  if (candidates.length === 1) {
    return candidates[0];
  }

  // Calculate combined scores
  const scored = candidates.map(c => {
    const key = `${c.plugin}:${c.slot}`;
    const health = healthRegistry.get(key);
    const healthScore = health ? calculateHealthScore(health).score : 0.5;

    // Combined score: 70% relevance + 30% health
    const combinedScore = 0.7 * c.relevanceScore + 0.3 * healthScore;

    return { ...c, healthScore, combinedScore };
  });

  // Sort by combined score descending
  scored.sort((a, b) => b.combinedScore - a.combinedScore);

  // Return the best candidate
  return scored[0];
}

// ============================================================================
// Health Record Update
// ============================================================================

/**
 * Update a health record with a new invocation result.
 * Returns a new record (immutable).
 */
export function updateHealthRecord(
  record: PluginHealthRecord,
  result: ResultType,
  confidence: ConfidenceLevel
): PluginHealthRecord {
  const newRecord = { ...record };

  // Increment counters
  newRecord.invocations++;
  if (result === 'success') {
    newRecord.success++;
  } else if (result === 'fail') {
    newRecord.fail++;
  } else if (result === 'timeout') {
    newRecord.timeout++;
  }

  // Update confidence sum
  newRecord.confidenceSum = record.confidenceSum + CONFIDENCE_VALUES[confidence];

  // Update recent results (keep last 10)
  newRecord.recentResults = [...record.recentResults, result].slice(-MAX_RECENT_RESULTS);

  return newRecord;
}
