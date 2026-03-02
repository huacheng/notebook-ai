import { useState, useCallback, useRef } from 'react';
import type { MentionPlugin, MentionState } from '../mention/types';

const INITIAL_STATE: MentionState = {
  open: false,
  plugin: null,
  query: '',
  items: [],
  selectedIndex: 0,
  triggerPos: -1,
  path: [],
};

export function useMention<T>(plugins: MentionPlugin<T>[]) {
  const [state, setState] = useState<MentionState<T>>(INITIAL_STATE as MentionState<T>);
  const fetchingRef = useRef(false);

  const close = useCallback(() => {
    setState(INITIAL_STATE as MentionState<T>);
  }, []);

  const handleChange = useCallback(async (
    value: string,
    cursorPos: number,
  ) => {
    // Find if any trigger character precedes cursor
    for (const plugin of plugins) {
      const triggerIdx = value.lastIndexOf(plugin.trigger, cursorPos - 1);
      if (triggerIdx === -1) continue;

      // Check if trigger is at start or after whitespace
      if (triggerIdx > 0 && !/\s/.test(value[triggerIdx - 1])) continue;

      // Check no whitespace between trigger and cursor
      const query = value.slice(triggerIdx + 1, cursorPos);
      if (/\s/.test(query)) continue;

      // Trigger detected - fetch items
      if (!fetchingRef.current) {
        fetchingRef.current = true;
        try {
          const items = await plugin.fetchItems(query);
          setState({
            open: true,
            plugin: plugin as MentionPlugin<unknown> as MentionPlugin<T>,
            query,
            items: items as T[],
            selectedIndex: 0,
            triggerPos: triggerIdx,
            path: [],
          });
        } finally {
          fetchingRef.current = false;
        }
      }
      return;
    }

    // No trigger found - close if open
    if (state.open) close();
  }, [plugins, state.open, close]);

  const handleKeyDown = useCallback((
    e: React.KeyboardEvent<HTMLTextAreaElement>,
    getText: () => string,
    setText: (v: string) => void,
  ): boolean => {
    if (!state.open || !state.plugin) return false;

    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault();
        setState(s => ({
          ...s,
          selectedIndex: Math.max(0, s.selectedIndex - 1),
        }));
        return true;

      case 'ArrowDown':
        e.preventDefault();
        setState(s => ({
          ...s,
          selectedIndex: Math.min(s.items.length - 1, s.selectedIndex + 1),
        }));
        return true;

      case 'Tab':
      case 'Enter':
        e.preventDefault();
        const item = state.items[state.selectedIndex];
        if (!item) return true;

        if (state.plugin.isNavigable?.(item)) {
          // Navigate into directory
          fetchingRef.current = true;
          state.plugin.onNavigate?.(item).then(children => {
            setState(s => ({
              ...s,
              items: children as T[],
              selectedIndex: 0,
              path: [...s.path, item],
              query: '',
            }));
            fetchingRef.current = false;
          });
        } else {
          // Select item - replace trigger+query with result
          const text = getText();
          const insertText = state.plugin.onSelect(item);
          const before = text.slice(0, state.triggerPos);
          const after = text.slice(state.triggerPos + 1 + state.query.length);
          setText(before + insertText + after);
          close();
        }
        return true;

      case 'Backspace':
        if (state.query === '' && state.path.length > 0) {
          e.preventDefault();
          // Navigate back up
          const newPath = state.path.slice(0, -1);
          const parent = newPath[newPath.length - 1];
          if (parent && state.plugin.onNavigate) {
            state.plugin.onNavigate(parent).then(items => {
              setState(s => ({
                ...s,
                items: items as T[],
                selectedIndex: 0,
                path: newPath,
              }));
            });
          } else {
            state.plugin.fetchItems('').then(items => {
              setState(s => ({
                ...s,
                items: items as T[],
                selectedIndex: 0,
                path: [],
              }));
            });
          }
          return true;
        }
        return false;

      case 'Escape':
        e.preventDefault();
        close();
        return true;

      default:
        return false;
    }
  }, [state, close]);

  const selectItem = useCallback((index: number, getText: () => string, setText: (v: string) => void) => {
    if (!state.plugin) return;
    const item = state.items[index];
    if (!item) return;

    if (state.plugin.isNavigable?.(item)) {
      state.plugin.onNavigate?.(item).then(children => {
        setState(s => ({
          ...s,
          items: children as T[],
          selectedIndex: 0,
          path: [...s.path, item],
          query: '',
        }));
      });
    } else {
      const text = getText();
      const insertText = state.plugin.onSelect(item);
      const before = text.slice(0, state.triggerPos);
      const after = text.slice(state.triggerPos + 1 + state.query.length);
      setText(before + insertText + after);
      close();
    }
  }, [state, close]);

  return {
    state,
    handleChange,
    handleKeyDown,
    selectItem,
    close,
  };
}
