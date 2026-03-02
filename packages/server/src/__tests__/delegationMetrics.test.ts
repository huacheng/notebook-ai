import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  recordDelegationEvent,
  recordDelegationOutcome,
  aggregateMetrics,
  DelegationEvent,
  DelegationOutcome,
} from '../task-ai/delegation-metrics';

describe('delegationMetrics', () => {
  const tempDir = '/tmp/test-delegation-metrics';
  const metricsFile = path.join(tempDir, '.delegation-events.jsonl');

  beforeEach(() => {
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('recordDelegationEvent', () => {
    it('should append event to JSONL file', () => {
      const event: DelegationEvent = {
        id: 'evt-001',
        timestamp: '2024-01-15T10:00:00Z',
        notebook: 'test-notebook',
        slot: 'code-review',
        plugin: 'superpowers:code-review',
        confidence: 'high',
        actionItems: ['Fix bug', 'Add test'],
        latencyMs: 1500,
      };

      recordDelegationEvent(event, tempDir);

      expect(fs.existsSync(metricsFile)).toBe(true);
      const content = fs.readFileSync(metricsFile, 'utf-8');
      const parsed = JSON.parse(content.trim());
      expect(parsed.id).toBe('evt-001');
      expect(parsed.slot).toBe('code-review');
    });

    it('should append multiple events', () => {
      const event1: DelegationEvent = {
        id: 'evt-001',
        timestamp: '2024-01-15T10:00:00Z',
        notebook: 'test-1',
        slot: 'code-review',
        plugin: 'superpowers:code-review',
        confidence: 'high',
        actionItems: [],
        latencyMs: 1000,
      };

      const event2: DelegationEvent = {
        id: 'evt-002',
        timestamp: '2024-01-15T10:01:00Z',
        notebook: 'test-2',
        slot: 'debugging',
        plugin: 'superpowers:debugging',
        confidence: 'medium',
        actionItems: ['Debug step'],
        latencyMs: 2000,
      };

      recordDelegationEvent(event1, tempDir);
      recordDelegationEvent(event2, tempDir);

      const content = fs.readFileSync(metricsFile, 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines.length).toBe(2);
    });
  });

  describe('recordDelegationOutcome', () => {
    it('should append outcome to JSONL file', () => {
      const outcome: DelegationOutcome = {
        delegationId: 'evt-001',
        adoptedItems: 2,
        totalItems: 3,
        contributedToReplan: false,
      };

      recordDelegationOutcome(outcome, tempDir);

      const content = fs.readFileSync(metricsFile, 'utf-8');
      const parsed = JSON.parse(content.trim());
      expect(parsed.delegationId).toBe('evt-001');
      expect(parsed.adoptedItems).toBe(2);
    });
  });

  describe('aggregateMetrics', () => {
    it('should aggregate metrics by slot and plugin', () => {
      // Create test data
      const events: DelegationEvent[] = [
        {
          id: 'evt-001',
          timestamp: '2024-01-15T10:00:00Z',
          notebook: 'nb-1',
          slot: 'code-review',
          plugin: 'superpowers:code-review',
          confidence: 'high',
          actionItems: ['Item 1', 'Item 2'],
          latencyMs: 1000,
        },
        {
          id: 'evt-002',
          timestamp: '2024-01-15T10:01:00Z',
          notebook: 'nb-2',
          slot: 'code-review',
          plugin: 'superpowers:code-review',
          confidence: 'high',
          actionItems: ['Item 1'],
          latencyMs: 1500,
        },
      ];

      const outcomes: DelegationOutcome[] = [
        { delegationId: 'evt-001', adoptedItems: 2, totalItems: 2, contributedToReplan: false },
        { delegationId: 'evt-002', adoptedItems: 0, totalItems: 1, contributedToReplan: true },
      ];

      // Write events
      for (const event of events) {
        recordDelegationEvent(event, tempDir);
      }
      for (const outcome of outcomes) {
        recordDelegationOutcome(outcome, tempDir);
      }

      const metrics = aggregateMetrics(tempDir);
      const codeReview = metrics.get('code-review:superpowers:code-review');

      expect(codeReview).toBeDefined();
      expect(codeReview!.totalCalls).toBe(2);
      expect(codeReview!.avgLatencyMs).toBe(1250); // (1000 + 1500) / 2
    });

    it('should handle empty metrics file', () => {
      const metrics = aggregateMetrics(tempDir);
      expect(metrics.size).toBe(0);
    });

    it('should calculate adopted rate correctly', () => {
      const events: DelegationEvent[] = [
        {
          id: 'evt-001',
          timestamp: '2024-01-15T10:00:00Z',
          notebook: 'nb-1',
          slot: 'tdd',
          plugin: 'superpowers:tdd',
          confidence: 'high',
          actionItems: ['Test 1', 'Test 2', 'Test 3'],
          latencyMs: 1000,
        },
      ];

      const outcomes: DelegationOutcome[] = [
        { delegationId: 'evt-001', adoptedItems: 2, totalItems: 3, contributedToReplan: false },
      ];

      for (const event of events) {
        recordDelegationEvent(event, tempDir);
      }
      for (const outcome of outcomes) {
        recordDelegationOutcome(outcome, tempDir);
      }

      const metrics = aggregateMetrics(tempDir);
      const tdd = metrics.get('tdd:superpowers:tdd');

      expect(tdd).toBeDefined();
      expect(tdd!.adoptedRate).toBeCloseTo(0.67, 1); // 2/3 ≈ 0.67
    });

    it('should count replan contributions', () => {
      const events: DelegationEvent[] = [
        { id: 'evt-001', timestamp: '2024-01-15T10:00:00Z', notebook: 'nb-1', slot: 'debugging', plugin: 'debug-tool', confidence: 'medium', actionItems: ['Fix'], latencyMs: 1000 },
        { id: 'evt-002', timestamp: '2024-01-15T10:01:00Z', notebook: 'nb-2', slot: 'debugging', plugin: 'debug-tool', confidence: 'low', actionItems: ['Fix'], latencyMs: 1000 },
        { id: 'evt-003', timestamp: '2024-01-15T10:02:00Z', notebook: 'nb-3', slot: 'debugging', plugin: 'debug-tool', confidence: 'high', actionItems: ['Fix'], latencyMs: 1000 },
      ];

      const outcomes: DelegationOutcome[] = [
        { delegationId: 'evt-001', adoptedItems: 1, totalItems: 1, contributedToReplan: true },
        { delegationId: 'evt-002', adoptedItems: 0, totalItems: 1, contributedToReplan: true },
        { delegationId: 'evt-003', adoptedItems: 1, totalItems: 1, contributedToReplan: false },
      ];

      for (const event of events) {
        recordDelegationEvent(event, tempDir);
      }
      for (const outcome of outcomes) {
        recordDelegationOutcome(outcome, tempDir);
      }

      const metrics = aggregateMetrics(tempDir);
      const debugging = metrics.get('debugging:debug-tool');

      expect(debugging).toBeDefined();
      expect(debugging!.replanContributions).toBe(2);
    });
  });
});
