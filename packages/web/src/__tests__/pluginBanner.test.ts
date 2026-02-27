/**
 * Plugin multi-marketplace store — defaults and actions.
 */

import { describe, it, expect } from 'vitest';
import { createUiSlice } from '../store/uiSlice';

function createTestUiSlice() {
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

  return { state, set, get };
}

// ── Defaults ────────────────────────────────────────────────────

describe('plugin store defaults', () => {
  it('pluginStatus defaults to null', () => {
    const { state } = createTestUiSlice();
    expect(state.pluginStatus).toBe(null);
  });

  it('pluginLoading defaults to false', () => {
    const { state } = createTestUiSlice();
    expect(state.pluginLoading).toBe(false);
  });

  it('pluginActionKey defaults to null', () => {
    const { state } = createTestUiSlice();
    expect(state.pluginActionKey).toBe(null);
  });

  it('pluginDismissed defaults to false', () => {
    const { state } = createTestUiSlice();
    expect(state.pluginDismissed).toBe(false);
  });

  it('pluginPanelOpen defaults to false', () => {
    const { state } = createTestUiSlice();
    expect(state.pluginPanelOpen).toBe(false);
  });

  it('pluginOverlay defaults to null', () => {
    const { state } = createTestUiSlice();
    expect(state.pluginOverlay).toBe(null);
  });
});

// ── Synchronous actions ──────────────────────────────────────────

describe('dismissPluginBanner', () => {
  it('sets pluginDismissed to true', () => {
    const { state } = createTestUiSlice();
    expect(state.pluginDismissed).toBe(false);
    state.dismissPluginBanner();
    expect(state.pluginDismissed).toBe(true);
  });
});

describe('openPluginPanel', () => {
  it('sets pluginPanelOpen to true', () => {
    const { state } = createTestUiSlice();
    expect(state.pluginPanelOpen).toBe(false);
    state.openPluginPanel();
    expect(state.pluginPanelOpen).toBe(true);
  });
});

describe('closePluginPanel', () => {
  it('sets pluginPanelOpen to false', () => {
    const { state } = createTestUiSlice();
    state.openPluginPanel();
    expect(state.pluginPanelOpen).toBe(true);
    state.closePluginPanel();
    expect(state.pluginPanelOpen).toBe(false);
  });
});

// ── Update actions ────────────────────────────────────────────

describe('updateMarketplace', () => {
  it('is a function on the store', () => {
    const { state } = createTestUiSlice();
    expect(typeof state.updateMarketplace).toBe('function');
  });
});

describe('updatePlugin', () => {
  it('is a function on the store', () => {
    const { state } = createTestUiSlice();
    expect(typeof state.updatePlugin).toBe('function');
  });
});
