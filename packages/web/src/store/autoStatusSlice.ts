import type { StateCreator } from 'zustand';
import type { NotebookStore } from './types';
import type { CheckScore, AutoStatusMessage as SharedAutoStatusMessage } from '@notebook-ai/shared';

export type { CheckScore } from '@notebook-ai/shared';
export type AutoStatusMessage = SharedAutoStatusMessage;

export interface AutoStatusState {
  phase: 'target' | 'planning' | 'execution' | 'finalization' | null;
  phaseProgress: number | null;
  step: string | null;
  next: string | null;
  stage: { current: number; total: number } | null;
  checkScore: CheckScore | null;
  retryCount: number;
  iteration: number;
}

export const initialAutoStatus: AutoStatusState = {
  phase: null,
  phaseProgress: null,
  step: null,
  next: null,
  stage: null,
  checkScore: null,
  retryCount: 0,
  iteration: 0,
};

export function applyAutoStatus(
  _state: AutoStatusState,
  msg: AutoStatusMessage,
): AutoStatusState {
  return {
    phase: msg.phase as AutoStatusState['phase'],
    phaseProgress: msg.phase_progress,
    step: msg.step,
    next: msg.next,
    stage: msg.stage,
    checkScore: msg.check_score,
    retryCount: msg.retry_count,
    iteration: msg.iteration,
  };
}

export const createAutoStatusSlice: StateCreator<NotebookStore, [], [], Pick<NotebookStore,
  | 'autoStatus' | 'autoStatuses' | 'setAutoStatus'
  | 'taskStatus' | 'taskStatuses'
  | 'autoMode' | 'autoIterationCount' | 'autoPaused' | 'autoPausedResumeAt'
>> = (set) => ({
  autoStatus: { ...initialAutoStatus },
  autoStatuses: {} as Record<string, AutoStatusState>,
  setAutoStatus: (msg: AutoStatusMessage) => {
    set((state) => ({
      autoStatus: applyAutoStatus(state.autoStatus, msg),
    }));
  },
  taskStatus: null,
  taskStatuses: {} as Record<string, Record<string, unknown> | null>,
  autoMode: false,
  autoIterationCount: 0,
  autoPaused: false,
  autoPausedResumeAt: 0,
});
