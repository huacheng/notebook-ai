import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';

const execFile = promisify(execFileCb);

// ── GitWatcher ────────────────────────────────────────────────────────────────
// Polls `git rev-parse HEAD` to detect new commits.
// Reference-counted: first subscriber starts polling, last unsubscribe stops it.

type GitCallback = (projectId: string, latestHash: string) => void;

interface GitEntry {
  projectId: string;
  lastHash: string;
  callbacks: Set<GitCallback>;
  timer: ReturnType<typeof setInterval>;
  debounceTimer: ReturnType<typeof setTimeout> | null;
}

export class GitWatcher {
  private watchers = new Map<string, GitEntry>();
  private pollMs: number;

  constructor(pollMs = 5000) {
    this.pollMs = pollMs;
  }

  subscribe(repoPath: string, projectId: string, cb: GitCallback): () => void {
    let entry = this.watchers.get(repoPath);
    if (entry) {
      entry.callbacks.add(cb);
    } else {
      entry = {
        projectId,
        lastHash: '',
        callbacks: new Set([cb]),
        timer: setInterval(() => this.poll(repoPath), this.pollMs),
        debounceTimer: null,
      };
      this.watchers.set(repoPath, entry);
      // Immediate first poll to capture baseline hash
      this.poll(repoPath);
    }

    let unsubscribed = false;
    return () => {
      if (unsubscribed) return;
      unsubscribed = true;
      const e = this.watchers.get(repoPath);
      if (!e) return;
      e.callbacks.delete(cb);
      if (e.callbacks.size === 0) {
        clearInterval(e.timer);
        if (e.debounceTimer) clearTimeout(e.debounceTimer);
        this.watchers.delete(repoPath);
      }
    };
  }

  destroy(): void {
    for (const [, entry] of this.watchers) {
      clearInterval(entry.timer);
      if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
    }
    this.watchers.clear();
  }

  private async poll(repoPath: string): Promise<void> {
    const entry = this.watchers.get(repoPath);
    if (!entry) return;

    try {
      const { stdout } = await execFile('git', ['rev-parse', 'HEAD'], {
        cwd: repoPath,
        timeout: 3000,
      });
      const hash = stdout.trim();
      if (!hash) return;

      if (entry.lastHash === '') {
        // First poll — just record the baseline
        entry.lastHash = hash;
        return;
      }

      if (hash !== entry.lastHash) {
        entry.lastHash = hash;
        // 200ms debounce to batch rapid changes (rebase, etc.)
        if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
        entry.debounceTimer = setTimeout(() => {
          entry.debounceTimer = null;
          for (const cb of entry.callbacks) {
            try { cb(entry.projectId, hash); } catch { /* ignore callback errors */ }
          }
        }, 200);
      }
    } catch {
      // Not a git repo or git not available — silently ignore
    }
  }
}

// ── FileWatcher ───────────────────────────────────────────────────────────────
// Uses fs.watch (inotify on Linux) for event-driven file change detection.
// 500ms debounce to batch rapid file operations (git checkout, etc.).

type FileCallback = (dirPath: string) => void;

interface FileEntry {
  callbacks: Set<FileCallback>;
  watcher: fs.FSWatcher;
  debounceTimer: ReturnType<typeof setTimeout> | null;
}

export class FileWatcher {
  private watchers = new Map<string, FileEntry>();
  private debounceMs: number;

  constructor(debounceMs = 500) {
    this.debounceMs = debounceMs;
  }

  subscribe(dirPath: string, cb: FileCallback): () => void {
    let entry = this.watchers.get(dirPath);
    if (entry) {
      entry.callbacks.add(cb);
    } else {
      let fsWatcher: fs.FSWatcher;
      try {
        fsWatcher = fs.watch(dirPath, { recursive: true }, () => {
          this.handleChange(dirPath);
        });
      } catch {
        // Directory doesn't exist or not watchable — create a stub entry
        // that will still allow subscribe/unsubscribe tracking
        fsWatcher = null as any;
      }

      entry = {
        callbacks: new Set([cb]),
        watcher: fsWatcher,
        debounceTimer: null,
      };
      this.watchers.set(dirPath, entry);

      // Handle watcher errors (e.g. directory deleted)
      if (fsWatcher) {
        fsWatcher.on('error', () => {
          this.cleanup(dirPath);
        });
      }
    }

    let unsubscribed = false;
    return () => {
      if (unsubscribed) return;
      unsubscribed = true;
      const e = this.watchers.get(dirPath);
      if (!e) return;
      e.callbacks.delete(cb);
      if (e.callbacks.size === 0) {
        this.cleanup(dirPath);
      }
    };
  }

  destroy(): void {
    for (const [dirPath] of this.watchers) {
      this.cleanup(dirPath);
    }
  }

  private handleChange(dirPath: string): void {
    const entry = this.watchers.get(dirPath);
    if (!entry) return;

    if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
    entry.debounceTimer = setTimeout(() => {
      entry.debounceTimer = null;
      for (const cb of entry.callbacks) {
        try { cb(dirPath); } catch { /* ignore callback errors */ }
      }
    }, this.debounceMs);
  }

  private cleanup(dirPath: string): void {
    const entry = this.watchers.get(dirPath);
    if (!entry) return;
    if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
    try { entry.watcher?.close(); } catch { /* already closed */ }
    this.watchers.delete(dirPath);
  }
}
