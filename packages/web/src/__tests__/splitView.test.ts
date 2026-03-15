import { describe, it, expect } from 'vitest';
import {
  computeSplitView,
  computeSplitEntryWidth,
  clampSplitRatio,
  splitRightPaneContent,
} from '../utils/splitView';

describe('computeSplitView (always true — persistent split layout)', () => {
  const base = {
    hasActiveFile: true,
    hasNotebook: true,
    pluginPanelOpen: false,
    modelPanelOpen: false,
  };

  it('always returns true', () => {
    expect(computeSplitView(base)).toBe(true);
    expect(computeSplitView({ ...base, hasActiveFile: false })).toBe(true);
    expect(computeSplitView({ ...base, hasNotebook: false })).toBe(true);
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

describe('splitRightPaneContent', () => {
  it('returns overlay when gitTabOpen in split view', () => {
    expect(splitRightPaneContent({ inSplitView: true, gitTabOpen: true })).toBe('overlay');
  });
  it('returns notebook when gitTab closed in split view', () => {
    expect(splitRightPaneContent({ inSplitView: true, gitTabOpen: false })).toBe('notebook');
  });
  it('returns notebook when not in split view even with git open', () => {
    expect(splitRightPaneContent({ inSplitView: false, gitTabOpen: true })).toBe('notebook');
  });
});
