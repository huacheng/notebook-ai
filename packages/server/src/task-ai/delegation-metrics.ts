import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Types
// ============================================================================

export interface DelegationEvent {
  id: string;
  timestamp: string;
  notebook: string;
  slot: string;
  plugin: string;
  confidence: 'high' | 'medium' | 'low';
  actionItems: string[];
  latencyMs: number;
}

export interface DelegationOutcome {
  delegationId: string;
  adoptedItems: number;
  totalItems: number;
  contributedToReplan: boolean;
}

export interface DelegationMetrics {
  slot: string;
  plugin: string;
  totalCalls: number;
  adoptedRate: number;
  replanContributions: number;
  avgLatencyMs: number;
}

// ============================================================================
// File Operations
// ============================================================================

const METRICS_FILE = '.delegation-events.jsonl';

function getMetricsPath(baseDir: string): string {
  return path.join(baseDir, METRICS_FILE);
}

/**
 * Record a delegation event to JSONL file.
 */
export function recordDelegationEvent(event: DelegationEvent, baseDir: string): void {
  const filePath = getMetricsPath(baseDir);
  fs.appendFileSync(filePath, JSON.stringify(event) + '\n');
}

/**
 * Record a delegation outcome to JSONL file.
 */
export function recordDelegationOutcome(outcome: DelegationOutcome, baseDir: string): void {
  const filePath = getMetricsPath(baseDir);
  fs.appendFileSync(filePath, JSON.stringify(outcome) + '\n');
}

// ============================================================================
// Aggregation
// ============================================================================

interface AggregatedData {
  events: DelegationEvent[];
  outcomes: Map<string, DelegationOutcome>;
}

function readMetricsFile(baseDir: string): AggregatedData {
  const filePath = getMetricsPath(baseDir);

  if (!fs.existsSync(filePath)) {
    return { events: [], outcomes: new Map() };
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.trim().split('\n').filter(l => l);

  const events: DelegationEvent[] = [];
  const outcomes = new Map<string, DelegationOutcome>();

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);

      if ('delegationId' in parsed) {
        // This is an outcome
        outcomes.set(parsed.delegationId, parsed as DelegationOutcome);
      } else if ('id' in parsed && 'slot' in parsed) {
        // This is an event
        events.push(parsed as DelegationEvent);
      }
    } catch {
      // Skip malformed lines
    }
  }

  return { events, outcomes };
}

/**
 * Aggregate metrics from JSONL file.
 * Returns a map keyed by "slot:plugin".
 */
export function aggregateMetrics(baseDir: string): Map<string, DelegationMetrics> {
  const { events, outcomes } = readMetricsFile(baseDir);
  const metrics = new Map<string, DelegationMetrics>();

  // Group events by slot:plugin
  const groups = new Map<string, { events: DelegationEvent[], outcomes: DelegationOutcome[] }>();

  for (const event of events) {
    const key = `${event.slot}:${event.plugin}`;
    if (!groups.has(key)) {
      groups.set(key, { events: [], outcomes: [] });
    }
    groups.get(key)!.events.push(event);

    // Match outcome if exists
    const outcome = outcomes.get(event.id);
    if (outcome) {
      groups.get(key)!.outcomes.push(outcome);
    }
  }

  // Calculate metrics for each group
  for (const [key, group] of groups) {
    const [slot, plugin] = key.split(':');

    const totalCalls = group.events.length;
    const totalLatency = group.events.reduce((sum, e) => sum + e.latencyMs, 0);
    const avgLatencyMs = totalCalls > 0 ? totalLatency / totalCalls : 0;

    // Calculate adopted rate
    let totalAdopted = 0;
    let totalItems = 0;
    let replanContributions = 0;

    for (const outcome of group.outcomes) {
      totalAdopted += outcome.adoptedItems;
      totalItems += outcome.totalItems;
      if (outcome.contributedToReplan) {
        replanContributions++;
      }
    }

    const adoptedRate = totalItems > 0 ? totalAdopted / totalItems : 0;

    metrics.set(key, {
      slot,
      plugin,
      totalCalls,
      adoptedRate,
      replanContributions,
      avgLatencyMs,
    });
  }

  return metrics;
}
