/**
 * runRenameFlow — Red/Green regression tests
 *
 * Mirrors deleteFlow.test.ts structure for consistency.
 * Key invariant: onDone fires ONLY on success, never on error or cancel.
 */

import { describe, it, expect, vi } from 'vitest';
import { runRenameFlow, type RenamePhase } from '../components/renameFlow';

function createSpies() {
  const phases: RenamePhase[] = [];
  return {
    phases,
    setPhase: (p: RenamePhase) => phases.push(p),
    setErrorMsg: vi.fn(),
    onDone: vi.fn(),
  };
}

describe('runRenameFlow', () => {
  it('calls onDone exactly once after successful rename', async () => {
    const spies = createSpies();

    await runRenameFlow(async () => {}, {
      setPhase: spies.setPhase,
      setErrorMsg: spies.setErrorMsg,
      onDone: spies.onDone,
    });

    expect(spies.onDone).toHaveBeenCalledTimes(1);
  });

  it('transitions through saving → done on success', async () => {
    const spies = createSpies();

    await runRenameFlow(async () => {}, {
      setPhase: spies.setPhase,
      setErrorMsg: spies.setErrorMsg,
      onDone: spies.onDone,
    });

    expect(spies.phases).toEqual(['saving', 'done']);
  });

  it('does NOT call onDone when onConfirm throws', async () => {
    const spies = createSpies();

    await runRenameFlow(
      async () => { throw new Error('server error'); },
      {
        setPhase: spies.setPhase,
        setErrorMsg: spies.setErrorMsg,
        onDone: spies.onDone,
      },
    );

    expect(spies.onDone).not.toHaveBeenCalled();
  });

  it('transitions through saving → error on failure', async () => {
    const spies = createSpies();

    await runRenameFlow(
      async () => { throw new Error('server error'); },
      {
        setPhase: spies.setPhase,
        setErrorMsg: spies.setErrorMsg,
        onDone: spies.onDone,
      },
    );

    expect(spies.phases).toEqual(['saving', 'error']);
  });

  it('sets error message from thrown error', async () => {
    const spies = createSpies();

    await runRenameFlow(
      async () => { throw new Error('duplicate name'); },
      {
        setPhase: spies.setPhase,
        setErrorMsg: spies.setErrorMsg,
        onDone: spies.onDone,
      },
    );

    expect(spies.setErrorMsg).toHaveBeenCalledWith('duplicate name');
  });

  it('sets fallback error message when error has no message', async () => {
    const spies = createSpies();

    await runRenameFlow(
      async () => { throw {}; },
      {
        setPhase: spies.setPhase,
        setErrorMsg: spies.setErrorMsg,
        onDone: spies.onDone,
      },
    );

    expect(spies.setErrorMsg).toHaveBeenCalledWith('Rename failed');
  });

  it('works when onDone is undefined (backward compat)', async () => {
    const spies = createSpies();

    await expect(
      runRenameFlow(async () => {}, {
        setPhase: spies.setPhase,
        setErrorMsg: spies.setErrorMsg,
      }),
    ).resolves.toBeUndefined();

    expect(spies.phases).toEqual(['saving', 'done']);
  });
});
