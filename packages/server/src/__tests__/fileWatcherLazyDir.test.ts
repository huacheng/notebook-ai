import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { FileWatcher } from '../watcher';

/**
 * FileWatcher should detect when a non-existent directory is created
 * and start watching it automatically. This is important for:
 * - .deliverables directories that may not exist initially
 * - worktree directories created on-demand
 */
describe('FileWatcher lazy directory detection', () => {
  let tmpDir: string;
  let watcher: FileWatcher;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-lazy-'));
    watcher = new FileWatcher(50); // 50ms debounce for faster tests
  });

  afterEach(() => {
    watcher.destroy();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should fire callback when initially non-existent directory is created', async () => {
    const targetDir = path.join(tmpDir, '.deliverables');
    const callback = vi.fn();

    // Subscribe to a directory that doesn't exist yet
    watcher.subscribe(targetDir, callback);

    // Create the directory
    fs.mkdirSync(targetDir);

    // Create a file inside to trigger the watcher
    await new Promise(r => setTimeout(r, 100));
    fs.writeFileSync(path.join(targetDir, 'test.txt'), 'hello');

    // Wait for debounce
    await new Promise(r => setTimeout(r, 150));

    // The callback should have been called
    expect(callback).toHaveBeenCalled();
  });

  it('should fire callback when file is created inside newly-created directory', async () => {
    const targetDir = path.join(tmpDir, 'subdir', '.deliverables');
    const callback = vi.fn();

    // Subscribe to deeply nested directory that doesn't exist
    watcher.subscribe(targetDir, callback);

    // Create the directory structure
    fs.mkdirSync(targetDir, { recursive: true });

    // Create a file inside
    await new Promise(r => setTimeout(r, 100));
    fs.writeFileSync(path.join(targetDir, 'report.pdf'), 'data');

    // Wait for debounce
    await new Promise(r => setTimeout(r, 150));

    expect(callback).toHaveBeenCalled();
  });

  it('should not fire callback for unrelated directory creation', async () => {
    const targetDir = path.join(tmpDir, '.deliverables');
    const otherDir = path.join(tmpDir, '.other');
    const callback = vi.fn();

    // Subscribe to .deliverables
    watcher.subscribe(targetDir, callback);

    // Create a different directory
    fs.mkdirSync(otherDir);
    fs.writeFileSync(path.join(otherDir, 'test.txt'), 'hello');

    // Wait for debounce
    await new Promise(r => setTimeout(r, 150));

    // The callback should NOT have been called
    expect(callback).not.toHaveBeenCalled();
  });
});
