import { useStore } from '../store';

/**
 * PromptQueue - displays queued prompts waiting to be executed.
 * Supports delete and drag-to-reorder functionality.
 */
export function PromptQueue() {
  const promptQueue = useStore((s) => s.promptQueue);
  const removeQueueItem = useStore((s) => s.removeQueueItem);
  const reorderQueue = useStore((s) => s.reorderQueue);

  if (promptQueue.length === 0) return null;

  const truncate = (text: string, maxLen = 80) =>
    text.length > maxLen ? text.slice(0, maxLen) + '...' : text;

  const handleDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData('text/plain', id);
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const draggedId = e.dataTransfer.getData('text/plain');
    if (draggedId === targetId) return;

    const oldOrder = promptQueue.map((p) => p.id);
    const draggedIdx = oldOrder.indexOf(draggedId);
    const targetIdx = oldOrder.indexOf(targetId);
    if (draggedIdx === -1 || targetIdx === -1) return;

    const newOrder = [...oldOrder];
    newOrder.splice(draggedIdx, 1);
    newOrder.splice(targetIdx, 0, draggedId);
    reorderQueue(newOrder);
  };

  return (
    <div className="prompt-queue">
      <div className="prompt-queue-header">
        <span className="prompt-queue-count">{promptQueue.length} queued</span>
      </div>
      <ul className="prompt-queue-list">
        {promptQueue.map((item) => (
          <li
            key={item.id}
            className="prompt-queue-item"
            draggable
            onDragStart={(e) => handleDragStart(e, item.id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => handleDrop(e, item.id)}
          >
            <span className="prompt-queue-text">{truncate(item.source)}</span>
            <button
              className="prompt-queue-delete"
              onClick={() => removeQueueItem(item.id)}
              title="Remove from queue"
            >
              &times;
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
