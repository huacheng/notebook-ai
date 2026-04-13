/**
 * Returns the label/copy strings for the delete/reset modal based on
 * whether the notebook is the default (root-level) notebook.
 *
 * When isDefault=true the action is a "reset" (contents cleared, .working and
 * .deliverables preserved), not a full delete. The HTTP call is the same
 * DELETE endpoint — the backend decides the behaviour.
 */
export interface DeleteModalCopy {
  /** Short action label for the primary CTA button */
  buttonLabel: string;
  /** Modal title */
  title: string;
  /** Confirmation body text */
  confirmText: string;
}

export function getDeleteModalCopy(isDefault: boolean, name: string): DeleteModalCopy {
  if (isDefault) {
    return {
      buttonLabel: '重置',
      title: `重置 "${name}"？`,
      confirmText: `重置 ${name}？内容将清空，.working 与 .deliverables 保留。`,
    };
  }
  return {
    buttonLabel: '删除',
    title: `删除 "${name}"？`,
    confirmText: `确定要删除 ${name} 吗？此操作不可撤销。`,
  };
}
