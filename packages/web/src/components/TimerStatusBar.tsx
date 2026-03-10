import './TimerStatusBar.css';
import type { CheckScore } from '../store/autoStatusSlice';

export const PHASES = ['target', 'plan', 'exec', 'merge'] as const;

/**
 * Derive the current phase index directly from .status.json `status` field.
 * No mapping table — the status values map naturally to lifecycle positions.
 */
export function getPhaseIndex(status: string | null): number {
  if (!status) return -1;
  switch (status) {
    case 'draft':
      return 0; // at target phase
    case 'planning':
    case 're-planning':
      return 1; // plan phase
    case 'review':
      return 1; // plan complete, review is end of plan phase
    case 'executing':
    case 'evolving':
      return 2; // exec phase
    case 'merging':
    case 'satisfied':
      return 3; // merge phase
    case 'blocked':
    case 'cancelled':
      return -1; // no active phase
    default:
      return -1;
  }
}

/**
 * Check if a phase is fully completed based on the status.
 * A phase is complete when the status has moved past it.
 */
export function isPhaseComplete(phaseIdx: number, status: string | null): boolean {
  if (!status) return false;
  switch (status) {
    case 'draft':
      return false; // nothing complete
    case 'planning':
    case 're-planning':
      return phaseIdx < 1; // target complete
    case 'review':
      return phaseIdx <= 1; // target + plan complete
    case 'executing':
    case 'evolving':
      return phaseIdx < 2; // target + plan complete
    case 'merging':
      return phaseIdx < 3; // target + plan + exec complete
    case 'satisfied':
      return true; // all complete
    default:
      return false;
  }
}

export const D_LABELS: Record<string, string> = {
  d1_correctness: 'D1 Correctness',
  d2_security: 'D2 Security',
  d3_reliability: 'D3 Reliability',
  d4_performance: 'D4 Performance',
  d5_architecture: 'D5 Architecture',
  d6_maintainability: 'D6 Maintainability',
};

interface PhaseProgressBarProps {
  /** Raw status from .status.json */
  status: string | null;
  completedSteps: number;
  totalSteps: number;
}

export function PhaseProgressBar({ status, completedSteps, totalSteps }: PhaseProgressBarProps) {
  if (!status) return null;

  return (
    <div className="timer-phase-bar">
      <span className="timer-phase-current">{status}</span>
      {completedSteps > 0 && (
        <span className="timer-phase-steps">
          step {completedSteps}{totalSteps > 0 ? `/${totalSteps}` : ''}
        </span>
      )}
    </div>
  );
}

interface ScorePanelProps {
  checkScore: CheckScore | null;
  expanded: boolean;
  onToggle: () => void;
}

export function ScorePanel({ checkScore, expanded, onToggle }: ScorePanelProps) {
  if (!checkScore) return null;

  return (
    <div className="timer-score-panel">
      <button className="timer-score-toggle" onClick={onToggle}>
        {checkScore.overall.toFixed(2)}
        <span className="timer-score-caret">{expanded ? '\u25B2' : '\u25BC'}</span>
      </button>
      {expanded && (
        <div className="timer-score-details">
          {Object.entries(D_LABELS).map(([key, label]) => {
            const score = checkScore[key as keyof CheckScore];
            return (
              <div key={key} className="timer-score-row">
                <span className="timer-score-label">{label}</span>
                <div className="timer-score-bar-bg">
                  <div
                    className="timer-score-bar-fill"
                    style={{ width: `${score * 100}%` }}
                  />
                </div>
                <span className="timer-score-value">{score.toFixed(2)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface StageIndicatorProps {
  stage: { current: number; total: number } | null;
}

export function StageIndicator({ stage }: StageIndicatorProps) {
  if (!stage || stage.total <= 1) return null;

  return (
    <span className="timer-stage-indicator">
      Stage {stage.current}/{stage.total}
    </span>
  );
}

interface IterationBadgeProps {
  iteration: number;
}

export function IterationBadge({ iteration }: IterationBadgeProps) {
  if (iteration <= 0) return null;
  return (
    <span className="timer-iteration-badge" title="Current iteration">
      iter {iteration}
    </span>
  );
}

interface RetryBadgeProps {
  retryCount: number;
}

export function RetryBadge({ retryCount }: RetryBadgeProps) {
  if (retryCount <= 0) return null;
  return (
    <span className="timer-retry-badge" title="Retry count at current checkpoint">
      retry {retryCount}
    </span>
  );
}

interface MultiStageViewProps {
  stage: { current: number; total: number };
  status: string | null;
  checkScore: CheckScore | null;
}

export function MultiStageView({ stage, status, checkScore }: MultiStageViewProps) {
  return (
    <div className="timer-multistage">
      {Array.from({ length: stage.total }, (_, i) => {
        const stageNum = i + 1;
        const isCurrent = stageNum === stage.current;
        const isStageComplete = stageNum < stage.current;
        const statusLabel = isStageComplete ? 'complete' : isCurrent ? (status ?? 'pending') : 'pending';
        const statusClass = isStageComplete ? 'timer-ms-complete' : isCurrent ? 'timer-ms-current' : 'timer-ms-pending';

        return (
          <div key={stageNum} className={`timer-ms-card ${statusClass}`}>
            <div className="timer-ms-header">
              <span className="timer-ms-title">Stage {stageNum}/{stage.total}</span>
              <span className="timer-ms-status">{statusLabel}</span>
              {isStageComplete && checkScore && (
                <span className="timer-ms-score">{checkScore.overall.toFixed(2)}</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface TimerStopButtonProps {
  onStop: () => void;
  disabled?: boolean;
}

export function TimerStopButton({ onStop, disabled }: TimerStopButtonProps) {
  return (
    <button
      className="timer-stop-btn"
      onClick={onStop}
      disabled={disabled}
      title="Stop timer mode"
    >
      Stop
    </button>
  );
}
