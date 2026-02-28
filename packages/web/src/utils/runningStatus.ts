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

/** Lightweight output shape for token estimation (avoids importing full shared types). */
interface OutputLike {
  type: string;
  content?: string;
  result?: string;
  input?: unknown;
  name?: string;
}

interface StreamBufLike {
  text: string;
  thinking: string;
}

/**
 * Split token estimation into input (↑) and output (↓).
 *
 * Input  = prompt source + tool result content
 * Output = model text + thinking + tool_use call input JSON
 */
export function estimateTokens(
  source: string,
  outputs: OutputLike[],
  buf: StreamBufLike | undefined,
): { input: number; output: number } {
  // ↑ Input: prompt source + tool result strings
  let inputChars = source.length;
  for (const o of outputs) {
    if (o.type === 'tool_use' && typeof o.result === 'string') {
      inputChars += o.result.length;
    }
  }

  // ↓ Output: streaming text/thinking + completed text/thinking + tool_use call input
  let outputChars = (buf?.text.length ?? 0) + (buf?.thinking.length ?? 0);
  for (const o of outputs) {
    if (o.type === 'text' && typeof o.content === 'string') {
      outputChars += o.content.length;
    } else if (o.type === 'thinking' && typeof o.content === 'string') {
      outputChars += o.content.length;
    } else if (o.type === 'tool_use' && o.input !== undefined && typeof o.result !== 'string') {
      // Only count input JSON when there's no result yet (avoid double-counting)
      outputChars += JSON.stringify(o.input).length;
    }
  }

  return {
    input: Math.floor(inputChars / 4),
    output: Math.floor(outputChars / 4),
  };
}

/** Determine the status label for RunningStatus. */
export function getStatusLabel(isThinking: boolean, hasAnyOutput: boolean, elapsedSec: number): string {
  if (isThinking) return 'Thinking…';
  if (!hasAnyOutput && elapsedSec >= 5) return 'Processing…';
  return 'Running…';
}
