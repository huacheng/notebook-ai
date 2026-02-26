/**
 * runCreateFlow — Red/Green regression tests
 *
 * Mirrors deleteFlow.test.ts structure. Verifies the extracted pure logic
 * for Project/Notebook creation overlay:
 *   idle → creating → done + onDone()
 *   idle → creating → error + errorMsg
 *
 * Key invariant: onDone fires ONLY on success. Never on error.
 */

import { describe, it, expect, vi } from 'vitest';
import { runCreateFlow, type CreatePhase } from '../components/createFlow';

function createSpies() {
  const phases: CreatePhase[] = [];
  return {
    phases,
    setPhase: (p: CreatePhase) => phases.push(p),
    setErrorMsg: vi.fn(),
    onDone: vi.fn(),
  };
}

describe('runCreateFlow', () => {
  it('calls onDone exactly once after successful create', async () => {
    const spies = createSpies();

    await runCreateFlow(async () => {}, {
      setPhase: spies.setPhase,
      setErrorMsg: spies.setErrorMsg,
      onDone: spies.onDone,
    });

    expect(spies.onDone).toHaveBeenCalledTimes(1);
  });

  it('transitions through creating → done on success', async () => {
    const spies = createSpies();

    await runCreateFlow(async () => {}, {
      setPhase: spies.setPhase,
      setErrorMsg: spies.setErrorMsg,
      onDone: spies.onDone,
    });

    expect(spies.phases).toEqual(['creating', 'done']);
  });

  it('does NOT call onDone when onCreate throws', async () => {
    const spies = createSpies();

    await runCreateFlow(
      async () => { throw new Error('duplicate name'); },
      {
        setPhase: spies.setPhase,
        setErrorMsg: spies.setErrorMsg,
        onDone: spies.onDone,
      },
    );

    expect(spies.onDone).not.toHaveBeenCalled();
  });

  it('transitions through creating → error on failure', async () => {
    const spies = createSpies();

    await runCreateFlow(
      async () => { throw new Error('duplicate name'); },
      {
        setPhase: spies.setPhase,
        setErrorMsg: spies.setErrorMsg,
        onDone: spies.onDone,
      },
    );

    expect(spies.phases).toEqual(['creating', 'error']);
  });

  it('sets error message from thrown error', async () => {
    const spies = createSpies();

    await runCreateFlow(
      async () => { throw new Error('project already exists'); },
      {
        setPhase: spies.setPhase,
        setErrorMsg: spies.setErrorMsg,
        onDone: spies.onDone,
      },
    );

    expect(spies.setErrorMsg).toHaveBeenCalledWith('project already exists');
  });

  it('sets fallback error message when error has no message', async () => {
    const spies = createSpies();

    await runCreateFlow(
      async () => { throw {}; },
      {
        setPhase: spies.setPhase,
        setErrorMsg: spies.setErrorMsg,
        onDone: spies.onDone,
      },
    );

    expect(spies.setErrorMsg).toHaveBeenCalledWith('Create failed');
  });

  it('works when onDone is undefined', async () => {
    const spies = createSpies();

    await expect(
      runCreateFlow(async () => {}, {
        setPhase: spies.setPhase,
        setErrorMsg: spies.setErrorMsg,
      }),
    ).resolves.toBeUndefined();

    expect(spies.phases).toEqual(['creating', 'done']);
  });
});
