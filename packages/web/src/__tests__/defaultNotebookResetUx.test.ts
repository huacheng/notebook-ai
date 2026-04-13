/**
 * Task 12: Default notebook shows "重置" (reset) UX instead of "删除" (delete).
 *
 * Tests the isDefault branching in ConfirmDeleteModal. We test the pure
 * label-selection logic rather than rendering the component, consistent with
 * the project's testing style (no @testing-library/react).
 */

import { describe, it, expect } from 'vitest';
import { getDeleteModalCopy } from '../utils/deleteModalCopy';

describe('getDeleteModalCopy — isDefault branching', () => {
  it('returns 删除 label when isDefault is false', () => {
    const copy = getDeleteModalCopy(false, 'My Notebook');
    expect(copy.buttonLabel).toBe('删除');
  });

  it('returns 重置 label when isDefault is true', () => {
    const copy = getDeleteModalCopy(true, 'My Notebook');
    expect(copy.buttonLabel).toBe('重置');
  });

  it('returns standard delete confirm text when isDefault is false', () => {
    const copy = getDeleteModalCopy(false, 'My Notebook');
    expect(copy.confirmText).toContain('My Notebook');
    expect(copy.confirmText).not.toContain('.working');
  });

  it('returns reset semantics confirm text when isDefault is true', () => {
    const copy = getDeleteModalCopy(true, 'My Notebook');
    expect(copy.confirmText).toContain('My Notebook');
    expect(copy.confirmText).toContain('.working');
  });

  it('delete label does NOT appear when isDefault is true', () => {
    const copy = getDeleteModalCopy(true, 'My Notebook');
    expect(copy.buttonLabel).not.toBe('删除');
  });

  it('reset label does NOT appear when isDefault is false', () => {
    const copy = getDeleteModalCopy(false, 'My Notebook');
    expect(copy.buttonLabel).not.toBe('重置');
  });

  it('modal title contains the notebook name for default notebook', () => {
    const copy = getDeleteModalCopy(true, 'Default NB');
    expect(copy.title).toContain('Default NB');
  });
});
