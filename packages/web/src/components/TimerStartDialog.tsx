import { useState } from 'react';
import './TimerStartDialog.css';

export const DEFAULT_INTERVAL_SECONDS = 300; // 5 minutes

interface TimerStartDialogProps {
  onStart: (opts: { intervalSeconds: number }) => void;
  onCancel: () => void;
}

export function TimerStartDialog({ onStart, onCancel }: TimerStartDialogProps) {
  const [intervalMinutes, setIntervalMinutes] = useState(DEFAULT_INTERVAL_SECONDS / 60);

  return (
    <div className="timer-start-overlay" onClick={onCancel}>
      <div className="timer-start-dialog" onClick={(e) => e.stopPropagation()}>
        <h3 className="timer-start-title">Timer</h3>

        <label className="timer-start-field">
          <span className="timer-start-label">Interval (min)</span>
          <input
            type="number"
            className="timer-start-input"
            value={intervalMinutes}
            min={1}
            max={30}
            step={1}
            onChange={(e) => setIntervalMinutes(Number(e.target.value) || 5)}
          />
        </label>

        <div className="timer-start-actions">
          <button className="timer-start-cancel" onClick={onCancel}>Cancel</button>
          <button
            className="timer-start-confirm"
            onClick={() => onStart({ intervalSeconds: intervalMinutes * 60 })}
          >
            Start
          </button>
        </div>
      </div>
    </div>
  );
}
