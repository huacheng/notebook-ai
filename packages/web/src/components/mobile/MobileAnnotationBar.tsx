import { useState, useRef } from 'react';
import { useStore } from '../../store';

interface MobileAnnotationBarProps {
  filePath: string;
}

/**
 * Mobile annotation bar for FileViewer.
 * Sends annotations to the active notebook.
 */
export function MobileAnnotationBar({ filePath }: MobileAnnotationBarProps) {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const submitPrompt = useStore((s) => s.submitPrompt);

  const handleSubmit = () => {
    const trimmed = input.trim();
    if (!trimmed) return;

    // Format annotation as a prompt with file context
    const annotation = `[Annotation on ${filePath}]\n\n${trimmed}`;
    submitPrompt(annotation);
    setInput('');

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);

    const textarea = e.target;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
  };

  return (
    <div className="mobile-annotation-bar">
      <div className="mobile-input-container">
        <textarea
          ref={textareaRef}
          className="mobile-input-textarea"
          placeholder="Add annotation..."
          value={input}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          rows={1}
        />
        <button
          className="mobile-input-submit"
          onClick={handleSubmit}
          disabled={!input.trim()}
          aria-label="Send annotation"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
            <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
