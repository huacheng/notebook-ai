import type { MentionPlugin, CellRef } from './types';
import { useStore } from '../store';

export const CellRefPlugin: MentionPlugin<CellRef> = {
  trigger: '#',

  fetchItems: async (query: string) => {
    const { notebook } = useStore.getState();
    if (!notebook) return [];

    const cells: CellRef[] = notebook.cells.map((c, i) => ({
      index: i,
      id: c.id,
      preview: (c.source ?? '').slice(0, 50).replace(/\n/g, ' '),
    }));

    const q = query.toLowerCase();
    return cells.filter(c =>
      `${c.index}`.includes(q) ||
      c.preview.toLowerCase().includes(q)
    );
  },

  renderItem: (cell: CellRef, selected: boolean) => (
    <div className={`mention-cell ${selected ? 'selected' : ''}`}>
      <span className="mention-cell-idx">#{cell.index}</span>
      <span className="mention-cell-preview">{cell.preview || '(empty)'}...</span>
    </div>
  ),

  onSelect: (cell: CellRef) => `#${cell.index} `,
};
