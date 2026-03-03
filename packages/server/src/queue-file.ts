/**
 * Prompt Queue File Persistence
 *
 * Handles saving and loading the prompt queue to/from a separate JSON file,
 * independent of the notebook.json file for performance reasons.
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { PromptQueueFileSchema, type QueuedPrompt, type PromptQueueFile } from '@notebook-ai/shared';

/**
 * Load queue from file. Returns empty queue if file doesn't exist or is corrupted.
 */
export async function loadQueueFromFile(queuePath: string): Promise<PromptQueueFile> {
  try {
    const content = await readFile(queuePath, 'utf-8');
    const parsed = JSON.parse(content);
    const result = PromptQueueFileSchema.safeParse(parsed);
    if (result.success) {
      return result.data;
    }
    // Invalid structure - return empty queue
    console.warn(`[queue-file] Invalid queue file structure at ${queuePath}, returning empty queue`);
    return { version: 0, items: [] };
  } catch (err) {
    // File doesn't exist or read error - return empty queue
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[queue-file] Failed to load queue from ${queuePath}:`, err);
    }
    return { version: 0, items: [] };
  }
}

/**
 * Save queue to file. Creates parent directories if needed.
 */
export async function saveQueueToFile(
  queuePath: string,
  items: QueuedPrompt[],
  version: number,
): Promise<void> {
  const data: PromptQueueFile = { version, items };
  const content = JSON.stringify(data, null, 2);

  // Ensure parent directory exists
  const dir = path.dirname(queuePath);
  await mkdir(dir, { recursive: true });

  await writeFile(queuePath, content, 'utf-8');
}

/**
 * Create a debounced saver function.
 * Multiple calls within the interval will only trigger one save with the latest data.
 */
export function createDebouncedSaver<T extends unknown[]>(
  saveFn: (...args: T) => Promise<void>,
  intervalMs: number,
): ((...args: T) => void) & { flush: () => Promise<void> } {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let pendingArgs: T | null = null;
  let pendingPromise: Promise<void> | null = null;
  let pendingResolve: (() => void) | null = null;

  const debouncedFn = (...args: T): void => {
    pendingArgs = args;

    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    if (!pendingPromise) {
      pendingPromise = new Promise((resolve) => {
        pendingResolve = resolve;
      });
    }

    timeoutId = setTimeout(async () => {
      timeoutId = null;
      if (pendingArgs) {
        const argsToUse = pendingArgs;
        pendingArgs = null;
        try {
          await saveFn(...argsToUse);
        } catch (err) {
          console.error('[queue-file] Debounced save failed:', err);
        }
        if (pendingResolve) {
          pendingResolve();
          pendingResolve = null;
          pendingPromise = null;
        }
      }
    }, intervalMs);
  };

  debouncedFn.flush = async (): Promise<void> => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    if (pendingArgs) {
      const argsToUse = pendingArgs;
      pendingArgs = null;
      try {
        await saveFn(...argsToUse);
      } catch (err) {
        console.error('[queue-file] Flush save failed:', err);
      }
    }
    if (pendingResolve) {
      pendingResolve();
      pendingResolve = null;
      pendingPromise = null;
    }
  };

  return debouncedFn;
}
