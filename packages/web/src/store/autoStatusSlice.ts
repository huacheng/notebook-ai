import type { StateCreator } from 'zustand';
import type { NotebookStore } from './types';

export interface CheckScore {
  overall: number;
  d1_correctness: number;
  d2_security: number;
  d3_reliability: number;
  d4_performance: number;
  d5_architecture: number;
  d6_maintainability: number;
}

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

export interface AutoStatusMessage {
  type: 'auto_status';
  session_id: string;
  phase: string | null;
  phase_progress: number | null;
  step: string | null;
  next: string | null;
  stage: { current: number; total: number } | null;
  check_score: CheckScore | null;
  retry_count: number;
  iteration: number;
}

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
  | 'autoStatus' | 'setAutoStatus'
>> = (set) => ({
  autoStatus: { ...initialAutoStatus },
  setAutoStatus: (msg: AutoStatusMessage) => {
    set((state) => ({
      autoStatus: applyAutoStatus(state.autoStatus, msg),
    }));
  },
});
