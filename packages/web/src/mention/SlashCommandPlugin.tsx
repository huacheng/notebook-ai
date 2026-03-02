import type { MentionPlugin, Command } from './types';
import { useStore } from '../store';
import { createT } from '../i18n';

export const SlashCommandPlugin: MentionPlugin<Command> = {
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
    return cmds.filter(c => {
      const label = t(`cmd.${c.name}`);
      return c.name.toLowerCase().includes(q) || label.toLowerCase().includes(q);
    });
  },

  renderItem: (cmd: Command, selected: boolean) => {
    const { language } = useStore.getState();
    const t = createT(language);
    const label = t(`cmd.${cmd.name}`);
    return (
      <div className={`mention-cmd ${selected ? 'selected' : ''}`}>
        <span className="mention-cmd-name">/{cmd.name}</span>
        <span className="mention-cmd-label">{label}</span>
      </div>
    );
  },

  onSelect: (cmd: Command) => `/${cmd.name} `,
};
