import { describe, it, expect } from 'vitest';
import { computeBreadcrumb, computeNavigateUp } from '../utils/worktreePath';

describe('computeBreadcrumb', () => {
  it('hides .worktrees/ prefix from display path', () => {
    const result = computeBreadcrumb('.worktrees/task-foo', '.');
    expect(result.displayPath).toBe('task-foo');
    expect(result.pathParts).toEqual(['task-foo']);
  });

  it('hides .worktrees/ in nested subpath', () => {
    const result = computeBreadcrumb('.worktrees/task-foo/sub', '.');
    expect(result.displayPath).toBe('task-foo/sub');
    expect(result.pathParts).toEqual(['task-foo', 'sub']);
  });

  it('maps crumb click back to real .worktrees/ path', () => {
    const result = computeBreadcrumb('.worktrees/task-foo/sub', '.');
    // Clicking "task-foo" breadcrumb (index 0)
    expect(result.crumbPaths[0]).toBe('.worktrees/task-foo');
    // Clicking "sub" breadcrumb (index 1)
    expect(result.crumbPaths[1]).toBe('.worktrees/task-foo/sub');
  });

  it('passes through normal paths unchanged', () => {
    const result = computeBreadcrumb('some/dir', '.');
    expect(result.displayPath).toBe('some/dir');
    expect(result.pathParts).toEqual(['some', 'dir']);
    expect(result.crumbPaths).toEqual(['some', 'some/dir']);
  });

  it('returns root for top-level', () => {
    const result = computeBreadcrumb('.', '.');
    expect(result.displayPath).toBe('.');
    expect(result.pathParts).toEqual([]);
  });

  it('strips initialPath prefix', () => {
    const result = computeBreadcrumb('.deliverables/reports', '.deliverables');
    expect(result.displayPath).toBe('reports');
    expect(result.pathParts).toEqual(['reports']);
  });
});

describe('computeNavigateUp', () => {
  it('skips .worktrees/ and jumps to root', () => {
    // From .worktrees/task-foo, up should go to root
    expect(computeNavigateUp('.worktrees/task-foo', '.')).toBe('.');
  });

  it('navigates from deep worktree subdir to worktree root', () => {
    // From .worktrees/task-foo/sub, up goes to .worktrees/task-foo
    expect(computeNavigateUp('.worktrees/task-foo/sub', '.')).toBe('.worktrees/task-foo');
  });

  it('does not navigate up from root', () => {
    expect(computeNavigateUp('.', '.')).toBe('.');
  });

  it('navigates normal dirs normally', () => {
    expect(computeNavigateUp('some/dir', '.')).toBe('some');
  });

  it('returns initialPath when at top', () => {
    expect(computeNavigateUp('only', '.')).toBe('.');
  });
});
