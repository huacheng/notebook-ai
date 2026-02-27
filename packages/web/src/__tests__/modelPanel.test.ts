/**
 * Model panel tests — TDD Red phase.
 *
 * Tests:
 * 1. modelPanelOpen defaults to false
 * 2. openModelPanel sets modelPanelOpen to true
 * 3. closeModelPanel sets modelPanelOpen to false
 * 4. changeModel is a function on the store
 */

import { describe, it, expect } from 'vitest';
import { createUiSlice } from '../store/uiSlice';

// ── Minimal slice test harness ─────────────────────────────────────────────

function createTestSlice() {
  let state: Record<string, any> = {};

  const set = (update: any) => {
    if (typeof update === 'function') {
      Object.assign(state, update(state));
    } else {
      Object.assign(state, update);
    }
  };

  const get = () => state as any;

  const slice = createUiSlice(set as any, get, {} as any);
  Object.assign(state, slice);

  return { state, getAction: (name: string) => (state as any)[name].bind(state) };
}

describe('modelPanelOpen', () => {
  it('defaults to false', () => {
    const { state } = createTestSlice();
    expect(state.modelPanelOpen).toBe(false);
  });

  it('openModelPanel sets to true', () => {
    const { state, getAction } = createTestSlice();
    getAction('openModelPanel')();
    expect(state.modelPanelOpen).toBe(true);
  });

  it('closeModelPanel sets to false', () => {
    const { state, getAction } = createTestSlice();
    getAction('openModelPanel')();
    expect(state.modelPanelOpen).toBe(true);
    getAction('closeModelPanel')();
    expect(state.modelPanelOpen).toBe(false);
  });

  it('openModelPanel closes plugin panel if open', () => {
    const { state, getAction } = createTestSlice();
    getAction('openPluginPanel')();
    expect(state.pluginPanelOpen).toBe(true);
    getAction('openModelPanel')();
    expect(state.modelPanelOpen).toBe(true);
    expect(state.pluginPanelOpen).toBe(false);
  });
});

describe('changeModel', () => {
  it('is a function', () => {
    const { state } = createTestSlice();
    expect(typeof state.changeModel).toBe('function');
  });
});
