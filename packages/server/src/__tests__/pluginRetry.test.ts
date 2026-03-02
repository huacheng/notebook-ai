import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  invokeWithRetry,
  categorizeError,
  getSlotTimeout,
  InvocationResult,
  ErrorCategory,
} from '../task-ai/plugin-retry';

describe('pluginRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('categorizeError', () => {
    it('should categorize network errors', () => {
      expect(categorizeError(new Error('ECONNREFUSED'))).toBe('network');
      expect(categorizeError(new Error('ENOTFOUND'))).toBe('network');
      expect(categorizeError(new Error('ETIMEDOUT'))).toBe('network');
      expect(categorizeError(new Error('Network request failed'))).toBe('network');
    });

    it('should categorize timeout errors', () => {
      expect(categorizeError(new Error('timeout'))).toBe('timeout');
      expect(categorizeError(new Error('Request timed out'))).toBe('timeout');
      expect(categorizeError(new Error('AbortError: timeout'))).toBe('timeout');
    });

    it('should categorize format errors', () => {
      expect(categorizeError(new Error('JSON parse error'))).toBe('format');
      expect(categorizeError(new Error('Unexpected token'))).toBe('format');
      expect(categorizeError(new Error('Invalid response format'))).toBe('format');
    });

    it('should categorize empty result errors', () => {
      expect(categorizeError(new Error('empty result'))).toBe('empty');
      expect(categorizeError(new Error('No data returned'))).toBe('empty');
    });

    it('should categorize plugin errors', () => {
      expect(categorizeError(new Error('Plugin crashed'))).toBe('plugin');
      expect(categorizeError(new Error('Plugin not found'))).toBe('plugin');
    });

    it('should return unknown for unrecognized errors', () => {
      expect(categorizeError(new Error('Something weird happened'))).toBe('unknown');
    });
  });

  describe('getSlotTimeout', () => {
    it('should return 60000ms for doc-parse', () => {
      expect(getSlotTimeout('doc-parse')).toBe(60000);
    });

    it('should return 45000ms for code-review', () => {
      expect(getSlotTimeout('code-review')).toBe(45000);
    });

    it('should return 45000ms for debugging', () => {
      expect(getSlotTimeout('debugging')).toBe(45000);
    });

    it('should return 30000ms for unknown slots', () => {
      expect(getSlotTimeout('unknown-slot')).toBe(30000);
    });

    it('should return 30000ms for domain-*', () => {
      expect(getSlotTimeout('domain-*')).toBe(30000);
    });
  });

  describe('invokeWithRetry', () => {
    it('should return success on first attempt when function succeeds', async () => {
      const fn = vi.fn().mockResolvedValue('result');

      const resultPromise = invokeWithRetry(fn, 'test-slot');
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(result.data).toBe('result');
      expect(result.attempts).toBe(1);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry network errors up to 2 times', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValue('success');

      const resultPromise = invokeWithRetry(fn, 'test-slot');
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(3);
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should fail after max network retries', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      const resultPromise = invokeWithRetry(fn, 'test-slot');
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(3); // 1 initial + 2 retries
    });

    it('should retry timeout errors up to 2 times', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValue('success');

      const resultPromise = invokeWithRetry(fn, 'test-slot');
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(2);
    });

    it('should not retry format errors', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('JSON parse error'));

      const resultPromise = invokeWithRetry(fn, 'test-slot');
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(1);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should not retry plugin errors', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('Plugin crashed'));

      const resultPromise = invokeWithRetry(fn, 'test-slot');
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(1);
    });

    it('should not retry unknown errors', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('Unknown error'));

      const resultPromise = invokeWithRetry(fn, 'test-slot');
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(1);
    });

    it('should retry empty result errors once', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('empty result'))
        .mockResolvedValue('data');

      const resultPromise = invokeWithRetry(fn, 'test-slot');
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(2);
    });

    it('should fail empty result after max retries', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('empty result'));

      const resultPromise = invokeWithRetry(fn, 'test-slot');
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(2); // 1 initial + 1 retry
    });

    it('should use exponential backoff', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValue('success');

      const resultPromise = invokeWithRetry(fn, 'test-slot');

      // First call immediately
      expect(fn).toHaveBeenCalledTimes(1);

      // After 1000ms (first backoff)
      await vi.advanceTimersByTimeAsync(1000);
      expect(fn).toHaveBeenCalledTimes(2);

      // After another 2000ms (second backoff = 1000 * 2)
      await vi.advanceTimersByTimeAsync(2000);
      expect(fn).toHaveBeenCalledTimes(3);

      const result = await resultPromise;
      expect(result.success).toBe(true);
    });

    it('should track total time', async () => {
      vi.useRealTimers(); // Use real timers for this test

      const fn = vi.fn().mockImplementation(() =>
        new Promise(resolve => setTimeout(() => resolve('result'), 10))
      );

      const result = await invokeWithRetry(fn, 'test-slot');

      expect(result.totalTimeMs).toBeGreaterThanOrEqual(10);
      expect(result.totalTimeMs).toBeLessThan(1000);

      vi.useFakeTimers(); // Restore fake timers
    });

    it('should include error in result on failure', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('Test error'));

      const resultPromise = invokeWithRetry(fn, 'test-slot');
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.message).toBe('Test error');
    });

    it('should handle null/undefined results as empty', async () => {
      const fn = vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValue('actual-data');

      const resultPromise = invokeWithRetry(fn, 'test-slot');
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(result.data).toBe('actual-data');
      expect(result.attempts).toBe(2);
    });
  });
});
