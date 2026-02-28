/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../store';

describe('lastEventIndex tracking', () => {
  beforeEach(() => {
    useStore.setState({
      lastEventIndex: {},
    });
  });

  it('lastEventIndex defaults to empty object', () => {
    const state = useStore.getState();
    expect(state.lastEventIndex).toEqual({});
  });

  it('updateLastEventIndex sets index for session', () => {
    useStore.getState().updateLastEventIndex('s1', 5);
    expect(useStore.getState().lastEventIndex.s1).toBe(5);
  });

  it('updateLastEventIndex updates existing index', () => {
    useStore.getState().updateLastEventIndex('s1', 5);
    useStore.getState().updateLastEventIndex('s1', 10);
    expect(useStore.getState().lastEventIndex.s1).toBe(10);
  });

  it('tracks multiple sessions independently', () => {
    useStore.getState().updateLastEventIndex('s1', 3);
    useStore.getState().updateLastEventIndex('s2', 7);
    const { lastEventIndex } = useStore.getState();
    expect(lastEventIndex.s1).toBe(3);
    expect(lastEventIndex.s2).toBe(7);
  });
});
