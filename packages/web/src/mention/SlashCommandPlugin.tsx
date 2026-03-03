import type { MentionPlugin, Command } from './types';
import { useStore } from '../store';
import { createT } from '../i18n';
import { getHistory } from './HistoryPlugin';

// Extended command type for internal use
type CommandItem = Command & { _isHistory?: boolean };

// History list item type
type HistoryListItem = Command & { _historyText: string; _historyTime: number };

// Union type for all items this plugin can return
type SlashItem = CommandItem | HistoryListItem;

function isHistoryItem(item: SlashItem): item is HistoryListItem {
  return '_historyText' in item;
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

export const SlashCommandPlugin: MentionPlugin<SlashItem> = {
  trigger: '/',

  fetchItems: async (query: string) => {
    const { commands, commandsLoaded, setCommands, authToken, language } = useStore.getState();
    const t = createT(language);

    let cmds = commands;
    if (!commandsLoaded) {
      try {
        const headers: Record<string, string> = {};
        if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
        const res = await fetch('/api/commands', { headers });
        if (res.ok) {
          const data = await res.json();
          cmds = data.commands;
          setCommands(cmds);
        }
      } catch {
        // Use empty list on error
      }
    }

    const q = query.toLowerCase();

    // Filter commands and add history command
    const filtered: SlashItem[] = cmds
      .filter(c => {
        const label = t(`cmd.${c.name}`);
        return c.name.toLowerCase().includes(q) || label.toLowerCase().includes(q);
      })
      .map(c => ({ ...c } as CommandItem));

    // Add history command if it matches
    const historyCount = getHistory().length;
    if ('history'.includes(q) || q.includes('hist')) {
      filtered.push({
        name: 'history',
        label: `${historyCount} items →`,
        _isHistory: true,
      });
    }

    return filtered;
  },

  renderItem: (item: SlashItem, selected: boolean) => {
    if (isHistoryItem(item)) {
      // Render history list item
      return (
        <div className={`mention-cmd ${selected ? 'selected' : ''}`}>
          <span className="mention-cmd-name mention-history-text">{item._historyText}</span>
          <span className="mention-cmd-label">{formatRelativeTime(item._historyTime)}</span>
        </div>
      );
    }

    const { language } = useStore.getState();
    const t = createT(language);
    const label = (item as CommandItem)._isHistory ? item.label : t(`cmd.${item.name}`);
    return (
      <div className={`mention-cmd ${selected ? 'selected' : ''}`}>
        <span className="mention-cmd-name">/{item.name}</span>
        <span className="mention-cmd-label">{label}</span>
      </div>
    );
  },

  onSelect: (item: SlashItem) => {
    if (isHistoryItem(item)) {
      return item._historyText;
    }
    return `/${item.name} `;
  },

  isNavigable: (item: SlashItem) => {
    return (item as CommandItem)._isHistory === true;
  },

  onNavigate: async (): Promise<SlashItem[]> => {
    const history = getHistory();
    if (history.length === 0) {
      return [{
        name: '',
        label: '(no history yet)',
        _historyText: '',
        _historyTime: 0,
      }];
    }
    return history.map(h => ({
      name: '',
      label: '',
      _historyText: h.text,
      _historyTime: h.timestamp,
    }));
  },
};
