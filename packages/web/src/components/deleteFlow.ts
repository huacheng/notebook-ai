/**
 * Pure logic extracted from ConfirmDeleteModal's handleConfirm.
 *
 * Separates the async flow (phase transitions + callback routing)
 * from React rendering, making it independently testable.
 */

export type DeletePhase = 'confirm' | 'deleting' | 'done' | 'error';

export interface DeleteFlowCallbacks {
  setPhase: (phase: DeletePhase) => void;
  setErrorMsg: (msg: string) => void;
  /** Called ONLY after successful delete. NOT on cancel or error. */
  onDone?: () => void;
}

/**
 * Executes the delete confirmation flow:
 *   deleting → (await onConfirm) → done + onDone()
 *   deleting → (onConfirm throws) → error
 *
 * Key contract: onDone fires only on success. The caller (component)
 * is responsible for onCancel (user dismiss) — this function never
 * touches onCancel.
 */
export async function runDeleteFlow(
  onConfirm: () => Promise<void>,
  cb: DeleteFlowCallbacks,
): Promise<void> {
  cb.setPhase('deleting');
  try {
    await onConfirm();
    cb.setPhase('done');
    cb.onDone?.();
  } catch (err: any) {
    cb.setErrorMsg(err?.message || 'Delete failed');
    cb.setPhase('error');
  }
}
