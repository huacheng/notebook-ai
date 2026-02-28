import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import path from 'path';
import os from 'os';
import express from 'express';
import type { Server } from 'http';
import { createGitRouter } from '../routes/git.js';

// ── Test helpers ─────────────────────────────────────────────────────────────

function git(cwd: string, ...args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

// Minimal mock db that resolves projectId → path
function mockDb(projectPath: string) {
  return {
    getProject(id: string) {
      if (id === 'test-proj') return { id, title: 'Test', path: projectPath, status: 'active' };
      return null;
    },
  } as any;
}

let tmpDir: string;
let app: ReturnType<typeof express>;
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  // Create temp git repo with two commits
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'git-light-'));
  git(tmpDir, 'init', '-b', 'main');
  git(tmpDir, 'config', 'user.email', 'test@test.com');
  git(tmpDir, 'config', 'user.name', 'Test');

  writeFileSync(path.join(tmpDir, 'file1.txt'), 'hello');
  git(tmpDir, 'add', '.');
  git(tmpDir, 'commit', '-m', 'first commit');

  writeFileSync(path.join(tmpDir, 'file2.txt'), 'world');
  git(tmpDir, 'add', '.');
  git(tmpDir, 'commit', '-m', 'second commit');

  // Set up Express app
  app = express();
  app.use('/api/projects', createGitRouter(mockDb(tmpDir)));
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const addr = server.address() as { port: number };
  baseUrl = `http://localhost:${addr.port}`;
});

afterAll(() => {
  server?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('git-log stats parameter', () => {
  it('default (no stats param) returns commits WITHOUT files', async () => {
    const res = await fetch(`${baseUrl}/api/projects/test-proj/git-log?page=1&limit=5`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.commits.length).toBe(2);
    // Without stats, files should be empty arrays
    for (const commit of data.commits) {
      expect(commit.files).toEqual([]);
    }
  });

  it('stats=true returns commits WITH file details', async () => {
    const res = await fetch(`${baseUrl}/api/projects/test-proj/git-log?page=1&limit=5&stats=true`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.commits.length).toBe(2);
    // The most recent commit should have file2.txt
    const latestCommit = data.commits[0];
    expect(latestCommit.files.length).toBeGreaterThan(0);
    expect(latestCommit.files[0].path).toBe('file2.txt');
  });
});

describe('git-commit-files endpoint', () => {
  it('returns files for a specific commit', async () => {
    // Get the latest commit hash first
    const logRes = await fetch(`${baseUrl}/api/projects/test-proj/git-log?page=1&limit=1`);
    const { commits } = await logRes.json();
    const hash = commits[0].hash;

    const res = await fetch(`${baseUrl}/api/projects/test-proj/git-commit-files?commit=${hash}`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.files).toBeInstanceOf(Array);
    expect(data.files.length).toBeGreaterThan(0);
    expect(data.files[0]).toHaveProperty('path');
    expect(data.files[0]).toHaveProperty('additions');
    expect(data.files[0]).toHaveProperty('deletions');
  });

  it('returns 400 for invalid commit hash', async () => {
    const res = await fetch(`${baseUrl}/api/projects/test-proj/git-commit-files?commit=invalid!`);
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown project', async () => {
    const res = await fetch(`${baseUrl}/api/projects/unknown/git-commit-files?commit=abc1234`);
    expect(res.status).toBe(404);
  });
});
