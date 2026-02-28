/** Format elapsed seconds: <60 → "32s", ≥60 → "2m 15s" */
export function formatTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

/** Format token estimate: <1000 → "423", ≥1000 → "1.2k" */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1)}k`;
}
