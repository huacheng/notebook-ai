import { useState, useRef, type KeyboardEvent } from 'react';
import type { AskQuestion } from '../utils/interactiveOptions';
import { formatAnswer } from '../utils/interactiveOptions';

interface InteractiveOptionsProps {
  questions: AskQuestion[];
  onSelect: (answer: string) => void;
}

export function InteractiveOptions({ questions, onSelect }: InteractiveOptionsProps) {
  const [selections, setSelections] = useState<string[][]>(() => questions.map(() => []));
  const [answered, setAnswered] = useState(false);
  const [otherTexts, setOtherTexts] = useState<string[]>(() => questions.map(() => ''));
  const [declineReason, setDeclineReason] = useState('');
  const otherRefs = useRef<(HTMLInputElement | null)[]>([]);

  const isSingleQuestion = questions.length === 1;
  const isSingleSelect = isSingleQuestion && !questions[0].multiSelect;

  const isDeclineActive = selections.some((s) => s.includes('__decline__'));
  const isOtherActive = (qIdx: number) => selections[qIdx]?.includes('__other__');

  function selectOther(qIdx: number) {
    if (answered) return;
    setSelections((prev) => {
      const next = [...prev];
      const q = questions[qIdx];
      if (q.multiSelect) {
        const s = new Set(next[qIdx]);
        s.delete('__decline__');
        if (!s.has('__other__')) s.add('__other__');
        next[qIdx] = [...s];
      } else {
        next[qIdx] = ['__other__'];
      }
      // Clear decline from all questions
      return next.map((s) => s.filter((v) => v !== '__decline__'));
    });
  }

  function selectDecline() {
    if (answered) return;
    // Decline clears all selections and sets __decline__ on first question
    setSelections(questions.map((_, i) => (i === 0 ? ['__decline__'] : [])));
  }

  function toggleOption(qIdx: number, label: string) {
    if (answered) return;
    setSelections((prev) => {
      const next = [...prev];
      const q = questions[qIdx];
      if (q.multiSelect) {
        const s = new Set(next[qIdx]);
        s.delete('__decline__');
        if (s.has(label)) s.delete(label); else s.add(label);
        next[qIdx] = [...s];
      } else {
        next[qIdx] = [label];
      }
      // Clear decline from all questions
      return next.map((s) => s.filter((v) => v !== '__decline__'));
    });
  }

  function doSubmit(sel?: string[][]) {
    const s = sel ?? selections;
    // Guard: if Other is active, text must be non-empty
    for (let i = 0; i < questions.length; i++) {
      if (s[i]?.includes('__other__') && !otherTexts[i]?.trim()) return;
    }
    setAnswered(true);
    onSelect(formatAnswer(questions, s, { otherTexts, declineReason }));
  }

  function handleClick(qIdx: number, label: string) {
    if (answered) return;
    if (isSingleSelect) {
      const sel = questions.map(() => [] as string[]);
      sel[qIdx] = [label];
      setSelections(sel);
      setAnswered(true);
      onSelect(formatAnswer(questions, sel));
    } else {
      toggleOption(qIdx, label);
    }
  }

  function handleCtrlEnter(e: KeyboardEvent) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      doSubmit();
    }
  }

  // Can submit: at least one selection exists (and Other text filled if Other selected)
  const canSubmit =
    !answered &&
    (isDeclineActive ||
      selections.some((s, i) =>
        s.length > 0 &&
        (!s.includes('__other__') || otherTexts[i]?.trim()),
      ));

  return (
    <div className={`interactive-options${answered ? ' interactive-options--answered' : ''}`}>
      {questions.map((q, qIdx) => (
        <div key={qIdx} className="interactive-options-block">
          <div className="interactive-options-header">{q.header}</div>
          <div className="interactive-options-question">{q.question}</div>
          <div className="interactive-options-grid">
            {q.options.map((opt) => {
              const selected = selections[qIdx]?.includes(opt.label);
              return (
                <button
                  key={opt.label}
                  className={`interactive-option-card${selected ? ' interactive-option-card--selected' : ''}`}
                  onClick={() => handleClick(qIdx, opt.label)}
                  disabled={answered}
                >
                  {q.multiSelect && (
                    <span className="interactive-option-check">
                      {selected ? '☑' : '☐'}
                    </span>
                  )}
                  <span className="interactive-option-label">{opt.label}</span>
                  {opt.description && (
                    <span className="interactive-option-desc">{opt.description}</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Other input row */}
          {!answered && (
            <div className={`interactive-other-row${isOtherActive(qIdx) ? ' interactive-other-row--active' : ''}`}>
              <span className="interactive-other-label">Other:</span>
              <input
                ref={(el) => { otherRefs.current[qIdx] = el; }}
                className="interactive-other-input"
                type="text"
                placeholder="Type a custom answer..."
                value={otherTexts[qIdx] ?? ''}
                onChange={(e) => {
                  const v = e.target.value;
                  setOtherTexts((prev) => { const n = [...prev]; n[qIdx] = v; return n; });
                }}
                onFocus={() => selectOther(qIdx)}
                onKeyDown={handleCtrlEnter}
                disabled={answered}
              />
            </div>
          )}
        </div>
      ))}

      {/* Decline row */}
      {!answered && (
        <div className={`interactive-decline-row${isDeclineActive ? ' interactive-decline-row--active' : ''}`}>
          <span className="interactive-decline-label">Decline:</span>
          <input
            className="interactive-decline-input"
            type="text"
            placeholder="Reason (optional)..."
            value={declineReason}
            onChange={(e) => setDeclineReason(e.target.value)}
            onFocus={() => selectDecline()}
            onKeyDown={handleCtrlEnter}
            disabled={answered}
          />
        </div>
      )}

      {/* Submit button */}
      {!isSingleSelect && !answered && (
        <button
          className="interactive-options-confirm"
          onClick={() => doSubmit()}
          disabled={!canSubmit}
        >
          Submit (Ctrl+Enter)
        </button>
      )}

      {answered && (
        <div className="interactive-options-status">Submitted</div>
      )}
    </div>
  );
}
