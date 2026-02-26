/**
 * runDeleteFlow — Red/Green regression tests
 *
 * These tests verify the extracted pure logic of ConfirmDeleteModal.handleConfirm.
 * The old bug: success path called onCancel (or nothing) instead of onDone,
 * causing the ProjectList to either not refresh or to trigger cancel-cleanup.
 *
 * Key invariant: onDone fires ONLY on success. onDone is never called on error.
 */

import { describe, it, expect, vi } from 'vitest';
import { runDeleteFlow, type DeletePhase } from '../components/deleteFlow';

function createSpies() {
  const phases: DeletePhase[] = [];
  return {
    phases,
    setPhase: (p: DeletePhase) => phases.push(p),
    setErrorMsg: vi.fn(),
    onDone: vi.fn(),
  };
}

describe('runDeleteFlow', () => {
  it('calls onDone exactly once after successful delete', async () => {
    const spies = createSpies();

    await runDeleteFlow(async () => {}, {
      setPhase: spies.setPhase,
      setErrorMsg: spies.setErrorMsg,
      onDone: spies.onDone,
    });

    expect(spies.onDone).toHaveBeenCalledTimes(1);
  });

  it('transitions through deleting → done on success', async () => {
    const spies = createSpies();

    await runDeleteFlow(async () => {}, {
      setPhase: spies.setPhase,
      setErrorMsg: spies.setErrorMsg,
      onDone: spies.onDone,
    });

    expect(spies.phases).toEqual(['deleting', 'done']);
  });

  it('does NOT call onDone when onConfirm throws', async () => {
    const spies = createSpies();

    await runDeleteFlow(
      async () => { throw new Error('server error'); },
      {
        setPhase: spies.setPhase,
        setErrorMsg: spies.setErrorMsg,
        onDone: spies.onDone,
      },
    );

    expect(spies.onDone).not.toHaveBeenCalled();
  });

  it('transitions through deleting → error on failure', async () => {
    const spies = createSpies();

    await runDeleteFlow(
      async () => { throw new Error('server error'); },
      {
        setPhase: spies.setPhase,
        setErrorMsg: spies.setErrorMsg,
        onDone: spies.onDone,
      },
    );

    expect(spies.phases).toEqual(['deleting', 'error']);
  });

  it('sets error message from thrown error', async () => {
    const spies = createSpies();

    await runDeleteFlow(
      async () => { throw new Error('not found'); },
      {
        setPhase: spies.setPhase,
        setErrorMsg: spies.setErrorMsg,
        onDone: spies.onDone,
      },
    );

    expect(spies.setErrorMsg).toHaveBeenCalledWith('not found');
  });

  it('sets fallback error message when error has no message', async () => {
    const spies = createSpies();

    await runDeleteFlow(
      async () => { throw {}; },
      {
        setPhase: spies.setPhase,
        setErrorMsg: spies.setErrorMsg,
        onDone: spies.onDone,
      },
    );

    expect(spies.setErrorMsg).toHaveBeenCalledWith('Delete failed');
  });

  it('works when onDone is undefined (backward compat)', async () => {
    const spies = createSpies();

    // Should not throw when onDone is omitted
    await expect(
      runDeleteFlow(async () => {}, {
        setPhase: spies.setPhase,
        setErrorMsg: spies.setErrorMsg,
        // onDone intentionally omitted
      }),
    ).resolves.toBeUndefined();

    expect(spies.phases).toEqual(['deleting', 'done']);
  });
});
