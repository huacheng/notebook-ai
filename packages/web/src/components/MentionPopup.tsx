import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
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

  // Position popup above the input bar
  // Find the input bar to anchor the popup
  const inputBar = document.querySelector('.notebook-input-bar');
  const inputBarRect = inputBar?.getBoundingClientRect();

  // Calculate position: above the input bar, aligned with caret x position
  const style: React.CSSProperties = inputBarRect
    ? {
        left: Math.max(8, Math.min(position.x || 24, window.innerWidth - 420)),
        bottom: window.innerHeight - inputBarRect.top + 8,
      }
    : {
        // Fallback: position at left edge, above bottom
        left: 24,
        bottom: 160,
      };

  // Use portal to render outside of notebook-input-bar's backdrop-filter context
  // (backdrop-filter creates a new containing block, breaking position: fixed)
  return createPortal(
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
    </div>,
    document.body
  );
}
