import { describe, it, expect } from 'vitest';
import { splitTabGroups } from '../utils/splitTabGroups';

describe('splitTabGroups', () => {
  const notebookTabs = [
    { id: 'nb1', title: 'Notebook A' },
    { id: 'nb2', title: 'Notebook B' },
  ];
  const fileTabs = [
    { id: 'f1', title: 'readme.md' },
    { id: 'f2', title: 'index.ts' },
  ];
  const gitTab = { id: '__git__', title: 'Git(project)' };

  it('returns left=fileTabs, right=notebookTabs+gitTab in split mode', () => {
    const result = splitTabGroups({
      inSplitView: true,
      notebookTabs,
      fileTabs,
      gitTab,
    });
    expect(result).not.toBeNull();
    expect(result!.left.map(t => t.id)).toEqual(['f1', 'f2']);
    expect(result!.right.map(t => t.id)).toEqual(['nb1', 'nb2', '__git__']);
  });

  it('puts git tab always last in right group', () => {
    const result = splitTabGroups({
      inSplitView: true,
      notebookTabs: [{ id: 'nb1', title: 'A' }],
      fileTabs: [],
      gitTab,
    });
    expect(result).not.toBeNull();
    const rightIds = result!.right.map(t => t.id);
    expect(rightIds[rightIds.length - 1]).toBe('__git__');
  });

  it('returns null groups when not in split mode', () => {
    const result = splitTabGroups({
      inSplitView: false,
      notebookTabs,
      fileTabs,
      gitTab,
    });
    expect(result).toBeNull();
  });

  it('git tab should not have close action', () => {
    const result = splitTabGroups({
      inSplitView: true,
      notebookTabs,
      fileTabs,
      gitTab,
    });
    expect(result).not.toBeNull();
    const git = result!.right.find(t => t.id === '__git__');
    expect(git).toBeDefined();
    expect(git!.closable).toBe(false);
  });
});
