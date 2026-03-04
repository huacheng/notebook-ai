import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execFile = promisify(execFileCb);

// ── GitWatcher ────────────────────────────────────────────────────────────────
// Polls `git rev-parse HEAD` + branch list to detect new commits and branch changes.
// Reference-counted: first subscriber starts polling, last unsubscribe stops it.

type GitCallback = (projectId: string, latestHash: string) => void;

interface GitEntry {
  projectId: string;
  lastHash: string;
  lastBranches: string;
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
        lastBranches: '',
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
      // Check HEAD and branch list in parallel
      const [headResult, branchResult] = await Promise.all([
        execFile('git', ['rev-parse', 'HEAD'], { cwd: repoPath, timeout: 3000 }),
        execFile('git', ['branch', '-l', '--format=%(refname:short)'], { cwd: repoPath, timeout: 3000 }),
      ]);

      const hash = headResult.stdout.trim();
      const branches = branchResult.stdout.trim();
      if (!hash) return;

      if (entry.lastHash === '') {
        // First poll — just record the baseline
        entry.lastHash = hash;
        entry.lastBranches = branches;
        return;
      }

      const hashChanged = hash !== entry.lastHash;
      const branchesChanged = branches !== entry.lastBranches;

      if (hashChanged || branchesChanged) {
        entry.lastHash = hash;
        entry.lastBranches = branches;
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
  watcher: fs.FSWatcher | null;
  debounceTimer: ReturnType<typeof setTimeout> | null;
  // For lazy watching: parent watcher when target doesn't exist
  parentWatcher: fs.FSWatcher | null;
  parentPath: string | null;
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
      let fsWatcher: fs.FSWatcher | null = null;
      let parentWatcher: fs.FSWatcher | null = null;
      let parentPath: string | null = null;

      try {
        fsWatcher = fs.watch(dirPath, { recursive: true }, () => {
          this.handleChange(dirPath);
        });
      } catch {
        // Directory doesn't exist — find first existing parent and watch it
        let candidateParent = path.dirname(dirPath);
        while (candidateParent && candidateParent !== path.dirname(candidateParent)) {
          try {
            fs.statSync(candidateParent);
            // This parent exists — watch it with recursive to detect nested creation
            parentPath = candidateParent;
            parentWatcher = fs.watch(candidateParent, { recursive: true }, () => {
              this.checkAndUpgrade(dirPath);
            });
            break;
          } catch {
            candidateParent = path.dirname(candidateParent);
          }
        }
      }

      entry = {
        callbacks: new Set([cb]),
        watcher: fsWatcher,
        debounceTimer: null,
        parentWatcher,
        parentPath,
      };
      this.watchers.set(dirPath, entry);

      // Handle watcher errors (e.g. directory deleted)
      if (fsWatcher) {
        fsWatcher.on('error', () => {
          this.cleanup(dirPath);
        });
      }
      if (parentWatcher) {
        parentWatcher.on('error', () => {
          // Parent deleted — cleanup parent watcher only
          const e = this.watchers.get(dirPath);
          if (e?.parentWatcher) {
            try { e.parentWatcher.close(); } catch { /* ignore */ }
            e.parentWatcher = null;
            e.parentPath = null;
          }
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

  /**
   * Check if target directory now exists and upgrade from parent watcher to direct watcher
   */
  private checkAndUpgrade(dirPath: string): void {
    const entry = this.watchers.get(dirPath);
    if (!entry || entry.watcher) return; // Already watching or no entry

    // Check if target directory now exists
    try {
      const stat = fs.statSync(dirPath);
      if (!stat.isDirectory()) return;
    } catch {
      return; // Still doesn't exist
    }

    // Directory exists now — upgrade to direct watcher
    try {
      entry.watcher = fs.watch(dirPath, { recursive: true }, () => {
        this.handleChange(dirPath);
      });
      entry.watcher.on('error', () => {
        this.cleanup(dirPath);
      });

      // Cleanup parent watcher
      if (entry.parentWatcher) {
        try { entry.parentWatcher.close(); } catch { /* ignore */ }
        entry.parentWatcher = null;
        entry.parentPath = null;
      }

      // Trigger initial callback since directory was just created
      this.handleChange(dirPath);
    } catch {
      // Failed to start watching — keep parent watcher
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
    try { entry.parentWatcher?.close(); } catch { /* already closed */ }
    this.watchers.delete(dirPath);
  }
}
