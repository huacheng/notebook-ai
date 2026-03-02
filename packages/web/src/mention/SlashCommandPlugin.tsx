import type { MentionPlugin, Command } from './types';
import { useStore } from '../store';

export const SlashCommandPlugin: MentionPlugin<Command> = {
  trigger: '/',

  fetchItems: async (query: string) => {
    const { commands, commandsLoaded, setCommands, authToken } = useStore.getState();

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
    return cmds.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.label.toLowerCase().includes(q)
    );
  },

  renderItem: (cmd: Command, selected: boolean) => (
    <div className={`mention-cmd ${selected ? 'selected' : ''}`}>
      <span className="mention-cmd-name">/{cmd.name}</span>
      <span className="mention-cmd-label">{cmd.label}</span>
    </div>
  ),

  onSelect: (cmd: Command) => `/${cmd.name} `,
};
