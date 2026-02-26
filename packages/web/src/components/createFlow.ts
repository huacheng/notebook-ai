/**
 * Pure logic for the Project/Notebook creation overlay flow.
 *
 * Mirrors deleteFlow.ts pattern: separates async flow (phase transitions
 * + callback routing) from React rendering for independent testability.
 */

export type CreatePhase = 'idle' | 'creating' | 'done' | 'error';

export interface CreateFlowCallbacks {
  setPhase: (phase: CreatePhase) => void;
  setErrorMsg: (msg: string) => void;
  /** Called ONLY after successful create. NOT on error. */
  onDone?: () => void;
}

/**
 * Executes the create flow:
 *   creating → (await onCreate) → done + onDone()
 *   creating → (onCreate throws) → error
 */
export async function runCreateFlow(
  onCreate: () => Promise<void>,
  cb: CreateFlowCallbacks,
): Promise<void> {
  cb.setPhase('creating');
  try {
    await onCreate();
    cb.setPhase('done');
    cb.onDone?.();
  } catch (err: any) {
    cb.setErrorMsg(err?.message || 'Create failed');
    cb.setPhase('error');
  }
}
