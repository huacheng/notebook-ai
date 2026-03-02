/**
 * Pure logic extracted for RenameModal's handleConfirm.
 * Mirrors deleteFlow.ts structure for consistency.
 */

export type RenamePhase = 'editing' | 'saving' | 'done' | 'error';

export interface RenameFlowCallbacks {
  setPhase: (phase: RenamePhase) => void;
  setErrorMsg: (msg: string) => void;
  /** Called ONLY after successful rename. NOT on cancel or error. */
  onDone?: () => void;
}

/**
 * Executes the rename flow:
 *   saving → (await onConfirm) → done + onDone()
 *   saving → (onConfirm throws) → error
 */
export async function runRenameFlow(
  onConfirm: () => Promise<void>,
  cb: RenameFlowCallbacks,
): Promise<void> {
  cb.setPhase('saving');
  try {
    await onConfirm();
    cb.setPhase('done');
    cb.onDone?.();
  } catch (err: any) {
    cb.setErrorMsg(err?.message || 'Rename failed');
    cb.setPhase('error');
  }
}
