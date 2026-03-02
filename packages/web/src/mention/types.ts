import type { ReactNode } from 'react';

export interface MentionPlugin<T = unknown> {
  /** Trigger character: '/', '@', '#' */
  trigger: string;
  /** Fetch items matching query */
  fetchItems: (query: string) => Promise<T[]>;
  /** Render a single item */
  renderItem: (item: T, selected: boolean) => ReactNode;
  /** Return text to insert when item selected */
  onSelect: (item: T) => string;
  /** Optional: can this item be navigated into (directory) */
  isNavigable?: (item: T) => boolean;
  /** Optional: fetch children when navigating into item */
  onNavigate?: (item: T) => Promise<T[]>;
}

export interface MentionState<T = unknown> {
  open: boolean;
  plugin: MentionPlugin<T> | null;
  query: string;
  items: T[];
  selectedIndex: number;
  triggerPos: number;
  path: T[];  // Navigation stack for tree mode
}

export interface Command {
  name: string;
  label: string;
}

export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
}

export interface CellRef {
  index: number;
  id: string;
  preview: string;
}
