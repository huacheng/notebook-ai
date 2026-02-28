import { describe, it, expect } from 'vitest';
import {
  computeSplitView,
  computeSplitEntryWidth,
  clampSplitRatio,
} from '../utils/splitView';

describe('computeSplitView', () => {
  const base = {
    hasActiveFile: true,
    hasNotebook: true,
    fileViewerMaximized: false,
    pluginPanelOpen: false,
    modelPanelOpen: false,
  };

  it('true when file + notebook active, nothing else open', () => {
    expect(computeSplitView(base)).toBe(true);
  });
  it('false when no active file', () => {
    expect(computeSplitView({ ...base, hasActiveFile: false })).toBe(false);
  });
  it('false when no notebook', () => {
    expect(computeSplitView({ ...base, hasNotebook: false })).toBe(false);
  });
  it('false when maximized', () => {
    expect(computeSplitView({ ...base, fileViewerMaximized: true })).toBe(false);
  });
  it('false when plugin panel open', () => {
    expect(computeSplitView({ ...base, pluginPanelOpen: true })).toBe(false);
  });
  it('false when model panel open', () => {
    expect(computeSplitView({ ...base, modelPanelOpen: true })).toBe(false);
  });
});

describe('computeSplitEntryWidth', () => {
  it('returns half for sidebar default (272)', () => {
    expect(computeSplitEntryWidth(272)).toBe(136);
  });
  it('returns half for right panel default (300)', () => {
    expect(computeSplitEntryWidth(300)).toBe(150);
  });
  it('clamps to 120 minimum', () => {
    expect(computeSplitEntryWidth(200)).toBe(120);
  });
  it('rounds when odd width', () => {
    expect(computeSplitEntryWidth(273)).toBe(137);
  });
  it('returns 120 for very small width', () => {
    expect(computeSplitEntryWidth(100)).toBe(120);
  });
});

describe('clampSplitRatio', () => {
  it('clamps low end to 0.2', () => {
    expect(clampSplitRatio(0.05)).toBe(0.2);
  });
  it('clamps high end to 0.8', () => {
    expect(clampSplitRatio(0.95)).toBe(0.8);
  });
  it('passes through valid ratio', () => {
    expect(clampSplitRatio(0.6)).toBe(0.6);
  });
});
