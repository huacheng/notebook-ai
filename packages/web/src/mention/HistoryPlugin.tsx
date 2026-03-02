import type { MentionPlugin } from './types';

const HISTORY_KEY = 'nb-prompt-history';
const MAX_HISTORY = 50;

export interface HistoryItem {
  text: string;
  timestamp: number;
}

/** Get command history from localStorage */
export function getHistory(): HistoryItem[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as HistoryItem[];
  } catch {
    return [];
  }
}

/** Save a command to history */
export function saveToHistory(text: string): void {
  if (!text.trim()) return;
  const history = getHistory();
  // Remove duplicate if exists
  const filtered = history.filter((h) => h.text !== text);
  // Add new entry at the beginning
  const newHistory: HistoryItem[] = [
    { text, timestamp: Date.now() },
    ...filtered,
  ].slice(0, MAX_HISTORY);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(newHistory));
  } catch {
    // Ignore localStorage errors
  }
}

/** Clear all history */
export function clearHistory(): void {
  localStorage.removeItem(HISTORY_KEY);
}

/**
 * HistoryPlugin - Shows command history when user types /history
 * Trigger: /history (matches when query starts with "history")
 */
export function createHistoryPlugin(): MentionPlugin<HistoryItem> {
  return {
    trigger: '/',
    fetchItems: async (query: string): Promise<HistoryItem[]> => {
      // Only activate for /history command
      if (!query.toLowerCase().startsWith('history')) {
        return [];
      }
      // Get history and filter by remaining query (after "history")
      const filterQuery = query.slice(7).toLowerCase().trim();
      const history = getHistory();
      if (!filterQuery) return history;
      return history.filter((h) => h.text.toLowerCase().includes(filterQuery));
    },
    renderItem: (item: HistoryItem, selected: boolean) => (
      <div className={`mention-history-item ${selected ? 'selected' : ''}`}>
        <span className="mention-history-text">{item.text}</span>
        <span className="mention-history-time">
          {formatRelativeTime(item.timestamp)}
        </span>
      </div>
    ),
    onSelect: (item: HistoryItem): string => item.text,
  };
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}
