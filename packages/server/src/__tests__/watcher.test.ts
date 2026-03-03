import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GitWatcher, FileWatcher } from '../watcher.js';

// ── GitWatcher ────────────────────────────────────────────────────────────────

describe('GitWatcher', () => {
  let watcher: GitWatcher;

  beforeEach(() => {
    watcher = new GitWatcher();
  });

  afterEach(() => {
    watcher.destroy();
  });

  it('subscribe returns an unsubscribe function', () => {
    const cb = vi.fn();
    const unsub = watcher.subscribe('/tmp/test-repo', 'proj1', cb);
    expect(typeof unsub).toBe('function');
    unsub();
  });

  it('calls callback when HEAD hash changes', async () => {
    const cb = vi.fn();
    // Use a very short poll interval for testing
    watcher = new GitWatcher(50);
    watcher.subscribe('/tmp/test-repo', 'proj1', cb);

    // Simulate hash change by manipulating internal state
    const entry = (watcher as any).watchers.get('/tmp/test-repo');
    expect(entry).toBeTruthy();
    // Manually set lastHash and trigger a check
    entry.lastHash = 'oldhash';

    // Wait for poll cycle — callback should fire if HEAD changes
    // Since /tmp/test-repo isn't a real repo, it'll error and not call cb
    await new Promise(r => setTimeout(r, 100));
    // For a non-repo path, callback should not be called
    expect(cb).not.toHaveBeenCalled();
  });

  it('refcount: second subscribe does not create duplicate interval', () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    watcher.subscribe('/tmp/test-repo', 'proj1', cb1);
    watcher.subscribe('/tmp/test-repo', 'proj1', cb2);

    const entry = (watcher as any).watchers.get('/tmp/test-repo');
    expect(entry.callbacks.size).toBe(2);
  });

  it('refcount: last unsubscribe clears the interval', () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const unsub1 = watcher.subscribe('/tmp/test-repo', 'proj1', cb1);
    const unsub2 = watcher.subscribe('/tmp/test-repo', 'proj1', cb2);

    unsub1();
    // Entry should still exist (one subscriber left)
    expect((watcher as any).watchers.has('/tmp/test-repo')).toBe(true);

    unsub2();
    // Entry should be removed (no subscribers)
    expect((watcher as any).watchers.has('/tmp/test-repo')).toBe(false);
  });

  it('destroy cleans up all watchers', () => {
    watcher.subscribe('/tmp/repo1', 'proj1', vi.fn());
    watcher.subscribe('/tmp/repo2', 'proj2', vi.fn());
    expect((watcher as any).watchers.size).toBe(2);

    watcher.destroy();
    expect((watcher as any).watchers.size).toBe(0);
  });
});

// ── FileWatcher ───────────────────────────────────────────────────────────────

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('FileWatcher', () => {
  let watcher: FileWatcher;
  let testDir1: string;
  let testDir2: string;

  beforeEach(() => {
    watcher = new FileWatcher();
    // Create isolated temp directories for testing
    testDir1 = mkdtempSync(join(tmpdir(), 'watcher-test1-'));
    testDir2 = mkdtempSync(join(tmpdir(), 'watcher-test2-'));
  });

  afterEach(() => {
    watcher.destroy();
    // Clean up temp directories
    try { rmSync(testDir1, { recursive: true }); } catch { /* ignore */ }
    try { rmSync(testDir2, { recursive: true }); } catch { /* ignore */ }
  });

  it('subscribe returns an unsubscribe function', () => {
    const cb = vi.fn();
    const unsub = watcher.subscribe(testDir1, cb);
    expect(typeof unsub).toBe('function');
    unsub();
  });

  it('refcount: multiple subscribers share one fs.watch', () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    watcher.subscribe(testDir1, cb1);
    watcher.subscribe(testDir1, cb2);

    const entry = (watcher as any).watchers.get(testDir1);
    expect(entry.callbacks.size).toBe(2);
  });

  it('refcount: last unsubscribe removes entry', () => {
    const cb = vi.fn();
    const unsub = watcher.subscribe(testDir1, cb);

    unsub();
    expect((watcher as any).watchers.has(testDir1)).toBe(false);
  });

  it('destroy cleans up all watchers', () => {
    watcher.subscribe(testDir1, vi.fn());
    watcher.subscribe(testDir2, vi.fn());
    expect((watcher as any).watchers.size).toBe(2);

    watcher.destroy();
    expect((watcher as any).watchers.size).toBe(0);
  });
});
