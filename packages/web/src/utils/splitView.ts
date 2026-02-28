export function computeSplitView(args: {
  hasActiveFile: boolean;
  hasNotebook: boolean;
  fileViewerMaximized: boolean;
  pluginPanelOpen: boolean;
  modelPanelOpen: boolean;
}): boolean {
  return args.hasActiveFile && args.hasNotebook
    && !args.fileViewerMaximized && !args.pluginPanelOpen && !args.modelPanelOpen;
}

/** Compute the initial panel width when entering split view. */
export function computeSplitEntryWidth(normalWidth: number): number {
  return Math.max(120, Math.round(normalWidth / 2));
}

export function clampSplitRatio(ratio: number): number {
  return Math.min(0.8, Math.max(0.2, ratio));
}
