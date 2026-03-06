import { useState } from 'react';
import './AutoStartDialog.css';

export const DEFAULT_MAX_ITERATIONS = 20;
export const DEFAULT_TIMEOUT_MINUTES = 30;

interface AutoStartDialogProps {
  onStart: (opts: { maxIterations: number; timeoutMinutes: number }) => void;
  onCancel: () => void;
}

export function AutoStartDialog({ onStart, onCancel }: AutoStartDialogProps) {
  const [maxIterations, setMaxIterations] = useState(DEFAULT_MAX_ITERATIONS);
  const [timeoutMinutes, setTimeoutMinutes] = useState(DEFAULT_TIMEOUT_MINUTES);

  return (
    <div className="auto-start-overlay" onClick={onCancel}>
      <div className="auto-start-dialog" onClick={(e) => e.stopPropagation()}>
        <h3 className="auto-start-title">Start Auto Mode</h3>

        <label className="auto-start-field">
          <span className="auto-start-label">Max Iterations</span>
          <input
            type="number"
            className="auto-start-input"
            value={maxIterations}
            min={1}
            max={100}
            onChange={(e) => setMaxIterations(Number(e.target.value) || DEFAULT_MAX_ITERATIONS)}
          />
        </label>

        <label className="auto-start-field">
          <span className="auto-start-label">Timeout (minutes)</span>
          <input
            type="number"
            className="auto-start-input"
            value={timeoutMinutes}
            min={1}
            max={180}
            onChange={(e) => setTimeoutMinutes(Number(e.target.value) || DEFAULT_TIMEOUT_MINUTES)}
          />
        </label>

        <div className="auto-start-actions">
          <button className="auto-start-cancel" onClick={onCancel}>Cancel</button>
          <button
            className="auto-start-confirm"
            onClick={() => onStart({ maxIterations, timeoutMinutes })}
          >
            Start
          </button>
        </div>
      </div>
    </div>
  );
}
