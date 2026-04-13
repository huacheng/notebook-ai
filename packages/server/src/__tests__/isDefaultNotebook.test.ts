import { describe, it, expect } from 'vitest';
import { isDefaultNotebook } from '../default-notebook.js';

describe('isDefaultNotebook', () => {
  it('returns true when notebook is directly under project root', () => {
    expect(isDefaultNotebook('/root/project/nb-abc.notebook.json', '/root/project')).toBe(true);
  });

  it('returns false when notebook is under .worktrees', () => {
    expect(isDefaultNotebook('/root/project/.worktrees/task-x/nb-abc.notebook.json', '/root/project')).toBe(false);
  });

  it('normalizes trailing slash on project path', () => {
    expect(isDefaultNotebook('/root/project/nb.notebook.json', '/root/project/')).toBe(true);
  });

  it('normalizes .. and relative path segments', () => {
    expect(isDefaultNotebook('/root/project/./nb.notebook.json', '/root/project')).toBe(true);
  });

  it('returns false when notebook path is outside project', () => {
    expect(isDefaultNotebook('/root/other/nb.notebook.json', '/root/project')).toBe(false);
  });
});
