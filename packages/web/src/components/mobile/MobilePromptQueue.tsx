import { useRef } from 'react';
import { useStore } from '../../store';
import { truncatePrompt } from '../../utils/promptQueue';

/**
 * MobilePromptQueue - displays queued prompts on mobile with swipe-to-delete.
 */
export function MobilePromptQueue() {
  const promptQueue = useStore((s) => s.promptQueue);
  const removeQueueItem = useStore((s) => s.removeQueueItem);

  // Track touch state for swipe gesture
  const touchStartX = useRef<number>(0);
  const touchItemId = useRef<string | null>(null);

  if (promptQueue.length === 0) return null;

  const handleTouchStart = (e: React.TouchEvent, id: string) => {
    touchStartX.current = e.touches[0].clientX;
    touchItemId.current = id;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!touchItemId.current) return;
    const deltaX = e.changedTouches[0].clientX - touchStartX.current;
    // Swipe left to delete (threshold: -80px)
    if (deltaX < -80) {
      removeQueueItem(touchItemId.current);
    }
    touchItemId.current = null;
  };

  return (
    <div className="mobile-prompt-queue">
      <div className="mobile-prompt-queue-header">
        <span className="mobile-prompt-queue-count">
          {promptQueue.length} queued
        </span>
        <span className="mobile-prompt-queue-hint">swipe left to delete</span>
      </div>
      <ul className="mobile-prompt-queue-list">
        {promptQueue.map((item, index) => (
          <li
            key={item.id}
            className="mobile-prompt-queue-item"
            onTouchStart={(e) => handleTouchStart(e, item.id)}
            onTouchEnd={handleTouchEnd}
          >
            <span className="mobile-prompt-queue-number">{index + 1}</span>
            <span className="mobile-prompt-queue-text">{truncatePrompt(item.source, 50)}</span>
            <button
              className="mobile-prompt-queue-delete"
              onClick={() => removeQueueItem(item.id)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
