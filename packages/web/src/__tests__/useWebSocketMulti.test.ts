/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { computeSubscriptionDiff } from '../hooks/useWebSocket';

describe('computeSubscriptionDiff', () => {
  it('subscribes to all open session IDs on mount', () => {
    const subscribed = new Set<string>();
    const current = new Set(['s1', 's2']);
    const diff = computeSubscriptionDiff(subscribed, current);
    expect(diff.toSubscribe).toEqual(['s1', 's2']);
    expect(diff.toUnsubscribe).toEqual([]);
  });

  it('subscribes new session when notebook tab opens', () => {
    const subscribed = new Set(['s1']);
    const current = new Set(['s1', 's2']);
    const diff = computeSubscriptionDiff(subscribed, current);
    expect(diff.toSubscribe).toEqual(['s2']);
    expect(diff.toUnsubscribe).toEqual([]);
  });

  it('unsubscribes when notebook tab closes', () => {
    const subscribed = new Set(['s1', 's2']);
    const current = new Set(['s1']);
    const diff = computeSubscriptionDiff(subscribed, current);
    expect(diff.toSubscribe).toEqual([]);
    expect(diff.toUnsubscribe).toEqual(['s2']);
  });

  it('does not unsubscribe on tab switch (only on close)', () => {
    // When switching tabs, all sessions remain in current set
    const subscribed = new Set(['s1', 's2']);
    const current = new Set(['s1', 's2']);
    const diff = computeSubscriptionDiff(subscribed, current);
    expect(diff.toSubscribe).toEqual([]);
    expect(diff.toUnsubscribe).toEqual([]);
  });
});
