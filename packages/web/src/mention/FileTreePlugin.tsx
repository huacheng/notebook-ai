import type { MentionPlugin, FileEntry } from './types';
import { useStore } from '../store';

async function fetchFiles(sessionId: string, authToken: string | null, subPath: string): Promise<FileEntry[]> {
  const headers: Record<string, string> = {};
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
  const url = `/api/notebooks/${encodeURIComponent(sessionId)}/files?path=${encodeURIComponent(subPath)}`;
  const res = await fetch(url, { headers });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.files ?? []).map((f: { name: string; path: string; isDir: boolean }) => ({
    name: f.name,
    path: f.path,
    isDir: f.isDir,
  }));
}

export const FileTreePlugin: MentionPlugin<FileEntry> = {
  trigger: '@',

  fetchItems: async (query: string) => {
    const { sessionId, authToken } = useStore.getState();
    if (!sessionId) return [];
    const files = await fetchFiles(sessionId, authToken, '.');
    const q = query.toLowerCase();
    return files.filter(f => f.name.toLowerCase().includes(q));
  },

  renderItem: (entry: FileEntry, selected: boolean) => (
    <div className={`mention-file ${selected ? 'selected' : ''}`}>
      <span className="mention-file-icon">{entry.isDir ? '📁' : '📄'}</span>
      <span className="mention-file-name">{entry.name}</span>
    </div>
  ),

  onSelect: (entry: FileEntry) => `@${entry.path} `,

  isNavigable: (entry: FileEntry) => entry.isDir,

  onNavigate: async (dir: FileEntry) => {
    const { sessionId, authToken } = useStore.getState();
    if (!sessionId) return [];
    return fetchFiles(sessionId, authToken, dir.path);
  },
};
