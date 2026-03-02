import { describe, it, expect } from 'vitest';
import {
  calculateHealthScore,
  selectBestPlugin,
  updateHealthRecord,
  PluginHealthRecord,
  PluginCandidate,
} from '../task-ai/plugin-health';

describe('pluginHealth', () => {
  describe('calculateHealthScore', () => {
    it('should score 0.5 for new plugin with no history', () => {
      const record: PluginHealthRecord = {
        plugin: 'new-plugin',
        slot: 'test',
        invocations: 0,
        success: 0,
        fail: 0,
        timeout: 0,
        confidenceSum: 0,
        recentResults: [],
      };

      const score = calculateHealthScore(record);
      expect(score.score).toBe(0.5);
    });

    it('should score close to 1.0 for perfect plugin', () => {
      const record: PluginHealthRecord = {
        plugin: 'perfect',
        slot: 'test',
        invocations: 20,
        success: 20,
        fail: 0,
        timeout: 0,
        confidenceSum: 20, // all high confidence (1.0 each)
        recentResults: Array(10).fill('success'),
      };

      const score = calculateHealthScore(record);
      expect(score.score).toBeGreaterThan(0.9);
      expect(score.successRate).toBe(1);
      expect(score.avgConfidence).toBe(1);
    });

    it('should score below 0.5 for failing plugin', () => {
      const record: PluginHealthRecord = {
        plugin: 'failing',
        slot: 'test',
        invocations: 10,
        success: 2,
        fail: 8,
        timeout: 0,
        confidenceSum: 0.6,
        recentResults: ['fail', 'fail', 'fail', 'fail', 'fail', 'success', 'fail', 'fail', 'fail', 'success'],
      };

      const score = calculateHealthScore(record);
      expect(score.score).toBeLessThan(0.5);
    });

    it('should apply sample penalty for low invocation count', () => {
      // 2 invocations with 100% success
      const lowSample: PluginHealthRecord = {
        plugin: 'low-sample',
        slot: 'test',
        invocations: 2,
        success: 2,
        fail: 0,
        timeout: 0,
        confidenceSum: 2,
        recentResults: ['success', 'success'],
      };

      // 20 invocations with 100% success
      const highSample: PluginHealthRecord = {
        plugin: 'high-sample',
        slot: 'test',
        invocations: 20,
        success: 20,
        fail: 0,
        timeout: 0,
        confidenceSum: 20,
        recentResults: Array(10).fill('success'),
      };

      const lowScore = calculateHealthScore(lowSample);
      const highScore = calculateHealthScore(highSample);

      // Low sample should be closer to 0.5 due to penalty
      expect(Math.abs(lowScore.score - 0.5)).toBeLessThan(Math.abs(highScore.score - 0.5));
    });

    it('should detect improving trend', () => {
      const record: PluginHealthRecord = {
        plugin: 'improving',
        slot: 'test',
        invocations: 10,
        success: 7,
        fail: 3,
        timeout: 0,
        confidenceSum: 7,
        recentResults: ['fail', 'fail', 'fail', 'success', 'success', 'success', 'success', 'success', 'success', 'success'],
      };

      const score = calculateHealthScore(record);
      expect(score.recentTrend).toBe('improving');
    });

    it('should detect declining trend', () => {
      const record: PluginHealthRecord = {
        plugin: 'declining',
        slot: 'test',
        invocations: 10,
        success: 7,
        fail: 3,
        timeout: 0,
        confidenceSum: 7,
        recentResults: ['success', 'success', 'success', 'success', 'success', 'fail', 'fail', 'fail', 'success', 'fail'],
      };

      const score = calculateHealthScore(record);
      expect(score.recentTrend).toBe('declining');
    });

    it('should detect stable trend', () => {
      const record: PluginHealthRecord = {
        plugin: 'stable',
        slot: 'test',
        invocations: 10,
        success: 8,
        fail: 2,
        timeout: 0,
        confidenceSum: 8,
        recentResults: ['success', 'fail', 'success', 'success', 'success', 'success', 'fail', 'success', 'success', 'success'],
      };

      const score = calculateHealthScore(record);
      expect(score.recentTrend).toBe('stable');
    });

    it('should return stable for insufficient history', () => {
      const record: PluginHealthRecord = {
        plugin: 'short-history',
        slot: 'test',
        invocations: 3,
        success: 3,
        fail: 0,
        timeout: 0,
        confidenceSum: 3,
        recentResults: ['success', 'success', 'success'],
      };

      const score = calculateHealthScore(record);
      expect(score.recentTrend).toBe('stable');
    });
  });

  describe('selectBestPlugin', () => {
    it('should prefer higher health score over alphabetical order', () => {
      const candidates: PluginCandidate[] = [
        { plugin: 'aaa-plugin', slot: 'slot', relevanceScore: 0.8 },
        { plugin: 'zzz-plugin', slot: 'slot', relevanceScore: 0.8 },
      ];

      const registry = new Map<string, PluginHealthRecord>([
        ['aaa-plugin:slot', {
          plugin: 'aaa-plugin',
          slot: 'slot',
          invocations: 10,
          success: 5,
          fail: 5,
          timeout: 0,
          confidenceSum: 3,
          recentResults: [],
        }],
        ['zzz-plugin:slot', {
          plugin: 'zzz-plugin',
          slot: 'slot',
          invocations: 10,
          success: 10,
          fail: 0,
          timeout: 0,
          confidenceSum: 10,
          recentResults: [],
        }],
      ]);

      const best = selectBestPlugin(candidates, registry);
      expect(best.plugin).toBe('zzz-plugin');
    });

    it('should prefer higher relevance when health is similar', () => {
      const candidates: PluginCandidate[] = [
        { plugin: 'plugin-a', slot: 'slot', relevanceScore: 0.9 },
        { plugin: 'plugin-b', slot: 'slot', relevanceScore: 0.6 },
      ];

      // Both plugins have same health
      const registry = new Map<string, PluginHealthRecord>([
        ['plugin-a:slot', {
          plugin: 'plugin-a',
          slot: 'slot',
          invocations: 10,
          success: 8,
          fail: 2,
          timeout: 0,
          confidenceSum: 8,
          recentResults: [],
        }],
        ['plugin-b:slot', {
          plugin: 'plugin-b',
          slot: 'slot',
          invocations: 10,
          success: 8,
          fail: 2,
          timeout: 0,
          confidenceSum: 8,
          recentResults: [],
        }],
      ]);

      const best = selectBestPlugin(candidates, registry);
      expect(best.plugin).toBe('plugin-a'); // Higher relevance wins
    });

    it('should handle plugins not in registry (default score 0.5)', () => {
      const candidates: PluginCandidate[] = [
        { plugin: 'known-plugin', slot: 'slot', relevanceScore: 0.8 },
        { plugin: 'unknown-plugin', slot: 'slot', relevanceScore: 0.8 },
      ];

      const registry = new Map<string, PluginHealthRecord>([
        ['known-plugin:slot', {
          plugin: 'known-plugin',
          slot: 'slot',
          invocations: 20,
          success: 20,
          fail: 0,
          timeout: 0,
          confidenceSum: 20,
          recentResults: Array(10).fill('success'),
        }],
      ]);

      const best = selectBestPlugin(candidates, registry);
      expect(best.plugin).toBe('known-plugin'); // Known good plugin wins over unknown
    });

    it('should return first candidate when array has single element', () => {
      const candidates: PluginCandidate[] = [
        { plugin: 'only-plugin', slot: 'slot', relevanceScore: 0.7 },
      ];

      const registry = new Map<string, PluginHealthRecord>();

      const best = selectBestPlugin(candidates, registry);
      expect(best.plugin).toBe('only-plugin');
    });
  });

  describe('updateHealthRecord', () => {
    it('should increment success count on success', () => {
      const record: PluginHealthRecord = {
        plugin: 'test',
        slot: 'slot',
        invocations: 5,
        success: 4,
        fail: 1,
        timeout: 0,
        confidenceSum: 4,
        recentResults: ['success', 'success', 'fail', 'success', 'success'],
      };

      const updated = updateHealthRecord(record, 'success', 'high');

      expect(updated.invocations).toBe(6);
      expect(updated.success).toBe(5);
      expect(updated.fail).toBe(1);
      expect(updated.recentResults).toContain('success');
      expect(updated.recentResults.length).toBeLessThanOrEqual(10);
    });

    it('should increment fail count on fail', () => {
      const record: PluginHealthRecord = {
        plugin: 'test',
        slot: 'slot',
        invocations: 5,
        success: 4,
        fail: 1,
        timeout: 0,
        confidenceSum: 4,
        recentResults: ['success', 'success', 'fail', 'success', 'success'],
      };

      const updated = updateHealthRecord(record, 'fail', 'low');

      expect(updated.invocations).toBe(6);
      expect(updated.success).toBe(4);
      expect(updated.fail).toBe(2);
    });

    it('should increment timeout count on timeout', () => {
      const record: PluginHealthRecord = {
        plugin: 'test',
        slot: 'slot',
        invocations: 5,
        success: 4,
        fail: 1,
        timeout: 0,
        confidenceSum: 4,
        recentResults: ['success', 'success', 'fail', 'success', 'success'],
      };

      const updated = updateHealthRecord(record, 'timeout', 'low');

      expect(updated.invocations).toBe(6);
      expect(updated.timeout).toBe(1);
    });

    it('should update confidence sum based on confidence level', () => {
      const record: PluginHealthRecord = {
        plugin: 'test',
        slot: 'slot',
        invocations: 0,
        success: 0,
        fail: 0,
        timeout: 0,
        confidenceSum: 0,
        recentResults: [],
      };

      const highConf = updateHealthRecord(record, 'success', 'high');
      expect(highConf.confidenceSum).toBe(1.0);

      const medConf = updateHealthRecord(record, 'success', 'medium');
      expect(medConf.confidenceSum).toBe(0.6);

      const lowConf = updateHealthRecord(record, 'success', 'low');
      expect(lowConf.confidenceSum).toBe(0.3);
    });

    it('should keep only last 10 results', () => {
      const record: PluginHealthRecord = {
        plugin: 'test',
        slot: 'slot',
        invocations: 10,
        success: 10,
        fail: 0,
        timeout: 0,
        confidenceSum: 10,
        recentResults: Array(10).fill('success'),
      };

      const updated = updateHealthRecord(record, 'fail', 'low');

      expect(updated.recentResults.length).toBe(10);
      expect(updated.recentResults[updated.recentResults.length - 1]).toBe('fail');
      expect(updated.recentResults[0]).toBe('success'); // Oldest success should be removed
    });
  });
});
