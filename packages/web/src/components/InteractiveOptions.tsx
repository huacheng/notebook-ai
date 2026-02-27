import { useState } from 'react';
import type { AskQuestion } from '../utils/interactiveOptions';
import { formatAnswer } from '../utils/interactiveOptions';

interface InteractiveOptionsProps {
  questions: AskQuestion[];
  onSelect: (answer: string) => void;
}

export function InteractiveOptions({ questions, onSelect }: InteractiveOptionsProps) {
  // Track selections per question index
  const [selections, setSelections] = useState<string[][]>(() => questions.map(() => []));
  const [answered, setAnswered] = useState(false);

  const isSingleQuestion = questions.length === 1;
  const isSingleSelect = isSingleQuestion && !questions[0].multiSelect;

  function toggleOption(qIdx: number, label: string) {
    if (answered) return;
    setSelections((prev) => {
      const next = [...prev];
      const q = questions[qIdx];
      if (q.multiSelect) {
        const s = new Set(next[qIdx]);
        if (s.has(label)) s.delete(label); else s.add(label);
        next[qIdx] = [...s];
      } else {
        next[qIdx] = [label];
      }
      return next;
    });
  }

  function submit(sel?: string[][]) {
    const s = sel ?? selections;
    setAnswered(true);
    onSelect(formatAnswer(questions, s));
  }

  // Single-select single-question: click immediately submits
  function handleClick(qIdx: number, label: string) {
    if (answered) return;
    if (isSingleSelect) {
      const sel = questions.map(() => [] as string[]);
      sel[qIdx] = [label];
      setSelections(sel);
      submit(sel);
    } else {
      toggleOption(qIdx, label);
    }
  }

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
        </div>
      ))}

      {/* Confirm button for multiSelect or multi-question */}
      {!isSingleSelect && !answered && (
        <button
          className="interactive-options-confirm"
          onClick={() => submit()}
          disabled={selections.every((s) => s.length === 0)}
        >
          确认选择
        </button>
      )}

      {answered && (
        <div className="interactive-options-status">已提交选择</div>
      )}
    </div>
  );
}
