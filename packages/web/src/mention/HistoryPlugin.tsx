import type { MentionPlugin } from './types';

const HISTORY_KEY = 'nb-prompt-history';
const MAX_HISTORY = 50;

export interface HistoryItem {
  text: string;
  timestamp: number;
}

// Entry point vs actual history item
type HistoryEntry =
  | { type: 'entry'; count: number }
  | { type: 'item'; text: string; timestamp: number }
  | { type: 'empty' };

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
 * Tab to enter history list, select to insert
 */
export function createHistoryPlugin(): MentionPlugin<HistoryEntry> {
  return {
    trigger: '/',
    fetchItems: async (query: string): Promise<HistoryEntry[]> => {
      // Only activate for exact /history command
      if (query.toLowerCase() !== 'history') {
        return [];
      }
      const history = getHistory();
      // Show entry point
      return [{ type: 'entry', count: history.length }];
    },
    renderItem: (item: HistoryEntry, selected: boolean) => {
      if (item.type === 'entry') {
        return (
          <div className={`mention-cmd ${selected ? 'selected' : ''}`}>
            <span className="mention-cmd-name">/history</span>
            <span className="mention-cmd-label">{item.count} items →</span>
          </div>
        );
      }
      if (item.type === 'empty') {
        return (
          <div className={`mention-cmd ${selected ? 'selected' : ''}`}>
            <span className="mention-cmd-label">(no history yet)</span>
          </div>
        );
      }
      return (
        <div className={`mention-cmd ${selected ? 'selected' : ''}`}>
          <span className="mention-cmd-name mention-history-text">{item.text}</span>
          <span className="mention-cmd-label">{formatRelativeTime(item.timestamp)}</span>
        </div>
      );
    },
    onSelect: (item: HistoryEntry): string => {
      if (item.type === 'item') {
        return item.text;
      }
      // Entry or empty - don't insert anything
      return '/history';
    },
    isNavigable: (item: HistoryEntry): boolean => {
      return item.type === 'entry';
    },
    onNavigate: async (): Promise<HistoryEntry[]> => {
      const history = getHistory();
      if (history.length === 0) {
        return [{ type: 'empty' }];
      }
      return history.map((h) => ({
        type: 'item' as const,
        text: h.text,
        timestamp: h.timestamp,
      }));
    },
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
