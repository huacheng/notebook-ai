import './TimerStatusBar.css';
import type { CheckScore } from '../store/autoStatusSlice';

export const PHASES = ['target', 'plan', 'exec', 'merge'] as const;
export const PHASE_MAP: Record<string, typeof PHASES[number]> = {
  target: 'target',
  planning: 'plan',
  planned: 'plan',
  execution: 'exec',
  executing: 'exec',
  finalization: 'merge',
  merging: 'merge',
};

export function getPhaseIndex(phase: string | null): number {
  if (!phase) return -1;
  const mapped = PHASE_MAP[phase];
  if (!mapped) return -1;
  return PHASES.indexOf(mapped);
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
  phase: string | null;
  phaseProgress: number | null;
}

export function PhaseProgressBar({ phase, phaseProgress }: PhaseProgressBarProps) {
  if (!phase) return null;

  const currentPhaseIndex = getPhaseIndex(phase);

  return (
    <div className="timer-phase-bar">
      {PHASES.map((p, i) => {
        const isComplete = i < currentPhaseIndex;
        const isCurrent = i === currentPhaseIndex;
        const className = [
          'timer-phase-step',
          isComplete ? 'timer-phase-complete' : '',
          isCurrent ? 'timer-phase-current' : '',
        ].filter(Boolean).join(' ');

        return (
          <span key={p}>
            {i > 0 && <span className="timer-phase-arrow">&rarr;</span>}
            <span className={className}>
              {isComplete && <span className="timer-phase-check">&#x2713;</span>}
              {p}
              {isCurrent && phaseProgress != null && (
                <span className="timer-phase-progress">
                  {Math.round(phaseProgress * 100)}%
                </span>
              )}
            </span>
          </span>
        );
      })}
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
  phase: string | null;
  phaseProgress: number | null;
  checkScore: CheckScore | null;
}

export function MultiStageView({ stage, phase, phaseProgress, checkScore }: MultiStageViewProps) {
  const currentPhaseIndex = getPhaseIndex(phase);

  return (
    <div className="timer-multistage">
      {Array.from({ length: stage.total }, (_, i) => {
        const stageNum = i + 1;
        const isCurrent = stageNum === stage.current;
        const isComplete = stageNum < stage.current;
        const statusLabel = isComplete ? 'complete' : isCurrent ? (phase ?? 'pending') : 'pending';
        const statusClass = isComplete ? 'timer-ms-complete' : isCurrent ? 'timer-ms-current' : 'timer-ms-pending';

        return (
          <div key={stageNum} className={`timer-ms-card ${statusClass}`}>
            <div className="timer-ms-header">
              <span className="timer-ms-title">Stage {stageNum}/{stage.total}</span>
              <span className="timer-ms-status">{statusLabel}</span>
              {isComplete && checkScore && (
                <span className="timer-ms-score">{checkScore.overall.toFixed(2)}</span>
              )}
            </div>
            <div className="timer-ms-phases">
              {PHASES.map((p, pi) => {
                let cls = 'timer-ms-phase';
                if (isCurrent) {
                  if (pi < currentPhaseIndex) cls += ' timer-ms-phase-done';
                  else if (pi === currentPhaseIndex) cls += ' timer-ms-phase-active';
                } else if (isComplete) {
                  cls += ' timer-ms-phase-done';
                }
                return (
                  <span key={p}>
                    {pi > 0 && <span className="timer-ms-arrow">&rarr;</span>}
                    <span className={cls}>
                      {((isComplete) || (isCurrent && pi < currentPhaseIndex)) && '\u2713'}
                      {isCurrent && pi === currentPhaseIndex && phaseProgress != null
                        ? `${p} ${Math.round(phaseProgress * 100)}%`
                        : p}
                    </span>
                  </span>
                );
              })}
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
