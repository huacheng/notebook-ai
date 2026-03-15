/** @deprecated Split view is now always active. Kept for test compatibility. */
export function computeSplitView(_args: {
  hasActiveFile: boolean;
  hasNotebook: boolean;
  pluginPanelOpen: boolean;
  modelPanelOpen: boolean;
}): boolean {
  return true;
}

/** Compute the initial panel width when entering split view. */
export function computeSplitEntryWidth(normalWidth: number): number {
  return Math.max(120, Math.round(normalWidth / 2));
}

export function clampSplitRatio(ratio: number): number {
  return Math.min(0.8, Math.max(0.2, ratio));
}

/** Determine what the right split pane should display. */
export function splitRightPaneContent(opts: {
  inSplitView: boolean;
  gitTabOpen: boolean;
}): 'notebook' | 'overlay' {
  return opts.inSplitView && opts.gitTabOpen ? 'overlay' : 'notebook';
}
