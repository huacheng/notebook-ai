import './AutoStatusBar.css';
import type { CheckScore } from '../store/autoStatusSlice';

export const PHASES = ['target', 'plan', 'exec', 'merge'] as const;
export const PHASE_MAP: Record<string, typeof PHASES[number]> = {
  target: 'target',
  planning: 'plan',
  execution: 'exec',
  finalization: 'merge',
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
    <div className="auto-phase-bar">
      {PHASES.map((p, i) => {
        const isComplete = i < currentPhaseIndex;
        const isCurrent = i === currentPhaseIndex;
        const className = [
          'auto-phase-step',
          isComplete ? 'auto-phase-complete' : '',
          isCurrent ? 'auto-phase-current' : '',
        ].filter(Boolean).join(' ');

        return (
          <span key={p}>
            {i > 0 && <span className="auto-phase-arrow">&rarr;</span>}
            <span className={className}>
              {isComplete && <span className="auto-phase-check">&#x2713;</span>}
              {p}
              {isCurrent && phaseProgress != null && (
                <span className="auto-phase-progress">
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
    <div className="auto-score-panel">
      <button className="auto-score-toggle" onClick={onToggle}>
        {checkScore.overall.toFixed(2)}
        <span className="auto-score-caret">{expanded ? '\u25B2' : '\u25BC'}</span>
      </button>
      {expanded && (
        <div className="auto-score-details">
          {Object.entries(D_LABELS).map(([key, label]) => {
            const score = checkScore[key as keyof CheckScore];
            return (
              <div key={key} className="auto-score-row">
                <span className="auto-score-label">{label}</span>
                <div className="auto-score-bar-bg">
                  <div
                    className="auto-score-bar-fill"
                    style={{ width: `${score * 100}%` }}
                  />
                </div>
                <span className="auto-score-value">{score.toFixed(2)}</span>
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
    <span className="auto-stage-indicator">
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
    <span className="auto-iteration-badge" title="Current iteration">
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
    <span className="auto-retry-badge" title="Retry count at current checkpoint">
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
    <div className="auto-multistage">
      {Array.from({ length: stage.total }, (_, i) => {
        const stageNum = i + 1;
        const isCurrent = stageNum === stage.current;
        const isComplete = stageNum < stage.current;
        const statusLabel = isComplete ? 'complete' : isCurrent ? (phase ?? 'pending') : 'pending';
        const statusClass = isComplete ? 'auto-ms-complete' : isCurrent ? 'auto-ms-current' : 'auto-ms-pending';

        return (
          <div key={stageNum} className={`auto-ms-card ${statusClass}`}>
            <div className="auto-ms-header">
              <span className="auto-ms-title">Stage {stageNum}/{stage.total}</span>
              <span className="auto-ms-status">{statusLabel}</span>
              {isComplete && checkScore && (
                <span className="auto-ms-score">{checkScore.overall.toFixed(2)}</span>
              )}
            </div>
            <div className="auto-ms-phases">
              {PHASES.map((p, pi) => {
                let cls = 'auto-ms-phase';
                if (isCurrent) {
                  if (pi < currentPhaseIndex) cls += ' auto-ms-phase-done';
                  else if (pi === currentPhaseIndex) cls += ' auto-ms-phase-active';
                } else if (isComplete) {
                  cls += ' auto-ms-phase-done';
                }
                return (
                  <span key={p}>
                    {pi > 0 && <span className="auto-ms-arrow">&rarr;</span>}
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

interface AutoStopButtonProps {
  onStop: () => void;
  disabled?: boolean;
}

export function AutoStopButton({ onStop, disabled }: AutoStopButtonProps) {
  return (
    <button
      className="auto-stop-btn"
      onClick={onStop}
      disabled={disabled}
      title="Stop auto mode"
    >
      Stop
    </button>
  );
}
