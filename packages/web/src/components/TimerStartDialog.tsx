import { useState } from 'react';
import './TimerStartDialog.css';

export const DEFAULT_MAX_ITERATIONS = 20;
export const DEFAULT_TIMEOUT_MINUTES = 30;
export const DEFAULT_INTERVAL_SECONDS = 300; // 5 minutes

interface TimerStartDialogProps {
  onStart: (opts: { maxIterations: number; timeoutMinutes: number; intervalSeconds: number }) => void;
  onCancel: () => void;
}

export function TimerStartDialog({ onStart, onCancel }: TimerStartDialogProps) {
  const [maxIterations, setMaxIterations] = useState(DEFAULT_MAX_ITERATIONS);
  const [timeoutMinutes, setTimeoutMinutes] = useState(DEFAULT_TIMEOUT_MINUTES);
  const [intervalSeconds, setIntervalSeconds] = useState(DEFAULT_INTERVAL_SECONDS);

  return (
    <div className="timer-start-overlay" onClick={onCancel}>
      <div className="timer-start-dialog" onClick={(e) => e.stopPropagation()}>
        <h3 className="timer-start-title">Start Timer Mode</h3>

        <label className="timer-start-field">
          <span className="timer-start-label">Interval (seconds)</span>
          <input
            type="number"
            className="timer-start-input"
            value={intervalSeconds}
            min={10}
            max={1800}
            onChange={(e) => setIntervalSeconds(Number(e.target.value) || DEFAULT_INTERVAL_SECONDS)}
          />
        </label>

        <label className="timer-start-field">
          <span className="timer-start-label">Max Iterations</span>
          <input
            type="number"
            className="timer-start-input"
            value={maxIterations}
            min={1}
            max={100}
            onChange={(e) => setMaxIterations(Number(e.target.value) || DEFAULT_MAX_ITERATIONS)}
          />
        </label>

        <label className="timer-start-field">
          <span className="timer-start-label">Timeout (minutes)</span>
          <input
            type="number"
            className="timer-start-input"
            value={timeoutMinutes}
            min={1}
            max={180}
            onChange={(e) => setTimeoutMinutes(Number(e.target.value) || DEFAULT_TIMEOUT_MINUTES)}
          />
        </label>

        <div className="timer-start-actions">
          <button className="timer-start-cancel" onClick={onCancel}>Cancel</button>
          <button
            className="timer-start-confirm"
            onClick={() => onStart({ maxIterations, timeoutMinutes, intervalSeconds })}
          >
            Start
          </button>
        </div>
      </div>
    </div>
  );
}
