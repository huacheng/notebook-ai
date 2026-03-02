import { useEffect, useRef } from 'react';
import type { MentionPlugin, MentionState } from '../mention/types';

interface Props<T> {
  state: MentionState<T>;
  position: { x: number; y: number };
  onSelect: (index: number) => void;
}

export function MentionPopup<T>({ state, position, onSelect }: Props<T>) {
  const listRef = useRef<HTMLDivElement>(null);

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.children[state.selectedIndex] as HTMLElement;
    el?.scrollIntoView({ block: 'nearest' });
  }, [state.selectedIndex]);

  if (!state.open || !state.plugin) return null;

  const plugin = state.plugin as MentionPlugin<T>;

  return (
    <div
      className="mention-popup"
      style={{
        left: position.x,
        bottom: `calc(100vh - ${position.y}px + 8px)`,
      }}
      ref={listRef}
    >
      {state.path.length > 0 && (
        <div className="mention-path">
          {state.path.map((p, i) => (
            <span key={i}>/{(p as { name?: string }).name ?? '?'}</span>
          ))}
        </div>
      )}
      {state.items.length === 0 ? (
        <div className="mention-empty">No matches</div>
      ) : (
        state.items.map((item, i) => (
          <div
            key={i}
            className={`mention-item ${i === state.selectedIndex ? 'selected' : ''}`}
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(i);
            }}
            onMouseEnter={() => {
              // Update selection on hover for mouse users
            }}
          >
            {plugin.renderItem(item, i === state.selectedIndex)}
          </div>
        ))
      )}
    </div>
  );
}
