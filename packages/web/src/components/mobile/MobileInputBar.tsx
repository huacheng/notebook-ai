import { useState, useRef } from 'react';
import { useStore } from '../../store';

/**
 * Mobile input bar for submitting prompts.
 * Fixed at the bottom of the screen.
 */
export function MobileInputBar() {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const submitPrompt = useStore((s) => s.submitPrompt);
  const activeNotebookTabId = useStore((s) => s.activeNotebookTabId);
  const openNotebooks = useStore((s) => s.openNotebooks);

  const activeTab = activeNotebookTabId ? openNotebooks[activeNotebookTabId] : null;
  const notebook = activeTab?.notebook;

  // Check if any cell is running
  const isRunning = notebook?.cells.some(
    (c) => c.status === 'running' || c.status === 'pending'
  );

  const handleSubmit = () => {
    const trimmed = input.trim();
    if (!trimmed || isRunning) return;

    submitPrompt(trimmed);
    setInput('');

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Submit on Enter (without Shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);

    // Auto-resize textarea
    const textarea = e.target;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
  };

  return (
    <div className="mobile-input-bar">
      <div className="mobile-input-container">
        <textarea
          ref={textareaRef}
          className="mobile-input-textarea"
          placeholder="Type a message..."
          value={input}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          rows={1}
          disabled={isRunning}
        />
        <button
          className="mobile-input-submit"
          onClick={handleSubmit}
          disabled={!input.trim() || isRunning}
          aria-label="Send message"
        >
          {isRunning ? (
            <span className="mobile-input-spinner" />
          ) : (
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
