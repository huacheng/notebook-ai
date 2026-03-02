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

  // Position popup above the textarea, aligned to cursor x-position
  // Use fixed positioning with bottom offset from input bar
  const style: React.CSSProperties = position.x > 0 && position.y > 0
    ? {
        left: Math.max(8, position.x),
        bottom: `calc(100vh - ${position.y}px + 4px)`,
      }
    : {
        // Fallback: position at left edge, above input bar
        left: 24,
        bottom: 120,
      };

  return (
    <div
      className="mention-popup"
      style={style}
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
