import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir } from 'fs/promises';
import { existsSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'auto-api-test-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('task_auto DB table', () => {
  it('creates task_auto table on migration', async () => {
    const { NotebookDb } = await import('../db.js');
    const db = new NotebookDb(path.join(tmpDir, 'test.db'));

    // Table should exist after constructor
    const row = (db as any).db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='task_auto'")
      .get();
    expect(row).toBeTruthy();
    expect(row.name).toBe('task_auto');
  });

  it('enforces unique session_name constraint', async () => {
    const { NotebookDb } = await import('../db.js');
    const db = new NotebookDb(path.join(tmpDir, 'test.db'));
    const rawDb = (db as any).db;

    rawDb.prepare(`
      INSERT INTO task_auto (session_name, task_dir, status, max_iterations, timeout_minutes, started_at, last_signal_at)
      VALUES ('s1', '/tmp/dir1', 'running', 20, 30, datetime('now'), datetime('now'))
    `).run();

    // Duplicate session_name should fail
    expect(() => {
      rawDb.prepare(`
        INSERT INTO task_auto (session_name, task_dir, status, max_iterations, timeout_minutes, started_at, last_signal_at)
        VALUES ('s1', '/tmp/dir2', 'running', 20, 30, datetime('now'), datetime('now'))
      `).run();
    }).toThrow();
  });

  it('enforces unique task_dir constraint', async () => {
    const { NotebookDb } = await import('../db.js');
    const db = new NotebookDb(path.join(tmpDir, 'test.db'));
    const rawDb = (db as any).db;

    rawDb.prepare(`
      INSERT INTO task_auto (session_name, task_dir, status, max_iterations, timeout_minutes, started_at, last_signal_at)
      VALUES ('s1', '/tmp/dir1', 'running', 20, 30, datetime('now'), datetime('now'))
    `).run();

    // Duplicate task_dir should fail
    expect(() => {
      rawDb.prepare(`
        INSERT INTO task_auto (session_name, task_dir, status, max_iterations, timeout_minutes, started_at, last_signal_at)
        VALUES ('s2', '/tmp/dir1', 'running', 20, 30, datetime('now'), datetime('now'))
      `).run();
    }).toThrow();
  });
});

describe('TaskAutoDb methods', () => {
  it('startAuto inserts a row and getAuto returns it', async () => {
    const { NotebookDb } = await import('../db.js');
    const db = new NotebookDb(path.join(tmpDir, 'test.db'));

    db.startAuto('session-1', '/work/nb/.working', 20, 30);

    const row = db.getAuto('session-1');
    expect(row).toBeTruthy();
    expect(row!.session_name).toBe('session-1');
    expect(row!.task_dir).toBe('/work/nb/.working');
    expect(row!.max_iterations).toBe(20);
    expect(row!.status).toBe('running');
  });

  it('stopAuto removes the row', async () => {
    const { NotebookDb } = await import('../db.js');
    const db = new NotebookDb(path.join(tmpDir, 'test.db'));

    db.startAuto('session-1', '/work/nb/.working', 20, 30);
    expect(db.getAuto('session-1')).toBeTruthy();

    db.stopAuto('session-1');
    expect(db.getAuto('session-1')).toBeUndefined();
  });

  it('getAutoByTaskDir finds by task directory', async () => {
    const { NotebookDb } = await import('../db.js');
    const db = new NotebookDb(path.join(tmpDir, 'test.db'));

    db.startAuto('session-1', '/work/nb/.working', 20, 30);

    const row = db.getAutoByTaskDir('/work/nb/.working');
    expect(row).toBeTruthy();
    expect(row!.session_name).toBe('session-1');
  });

  it('rejects starting auto when session already has one', async () => {
    const { NotebookDb } = await import('../db.js');
    const db = new NotebookDb(path.join(tmpDir, 'test.db'));

    db.startAuto('session-1', '/work/nb1/.working', 20, 30);

    expect(() => {
      db.startAuto('session-1', '/work/nb2/.working', 20, 30);
    }).toThrow();
  });
});

describe('task_auto restart_count column', () => {
  it('has restart_count column with default 0', async () => {
    const { NotebookDb } = await import('../db.js');
    const db = new NotebookDb(path.join(tmpDir, 'test.db'));

    db.startAuto('session-rc', '/work/rc/.working', 20, 30);
    const row = db.getAuto('session-rc');
    expect(row).toBeTruthy();
    expect(row!.restart_count).toBe(0);
  });
});

describe('recoverDaemons', () => {
  it('recovers daemons for running task_auto rows with existing task_dir', async () => {
    const { NotebookDb } = await import('../db.js');
    const { recoverDaemons, stopAllDaemons } = await import('../routes/task-auto.js');
    const db = new NotebookDb(path.join(tmpDir, 'test.db'));

    // Create task dirs
    const taskDir = path.join(tmpDir, 'task1');
    await mkdir(taskDir, { recursive: true });

    // Insert running auto row
    db.startAuto('session-1', taskDir, 20, 30);

    // Recover
    const recovered = recoverDaemons(db);
    expect(recovered).toBe(1);

    // Cleanup
    stopAllDaemons();
  });

  it('cleans up DB row when task_dir no longer exists', async () => {
    const { NotebookDb } = await import('../db.js');
    const { recoverDaemons, stopAllDaemons } = await import('../routes/task-auto.js');
    const db = new NotebookDb(path.join(tmpDir, 'test.db'));

    // Insert running auto row with non-existent dir
    db.startAuto('session-gone', '/nonexistent/path/gone', 20, 30);

    const recovered = recoverDaemons(db);
    expect(recovered).toBe(0);

    // DB row should be cleaned up
    expect(db.getAuto('session-gone')).toBeUndefined();

    stopAllDaemons();
  });

  it('removes stale .auto-stop file from task_dir before recovery', async () => {
    const { NotebookDb } = await import('../db.js');
    const { recoverDaemons, stopAllDaemons } = await import('../routes/task-auto.js');
    const db = new NotebookDb(path.join(tmpDir, 'test.db'));

    const taskDir = path.join(tmpDir, 'task-stale');
    await mkdir(taskDir, { recursive: true });

    // Write a stale .auto-stop file
    writeFileSync(path.join(taskDir, '.auto-stop'), '{"reason":"crash"}');
    expect(existsSync(path.join(taskDir, '.auto-stop'))).toBe(true);

    db.startAuto('session-stale', taskDir, 20, 30);

    recoverDaemons(db);

    // Stale .auto-stop should be removed
    expect(existsSync(path.join(taskDir, '.auto-stop'))).toBe(false);

    stopAllDaemons();
  });

  it('skips sessions that already have active daemons', async () => {
    const { NotebookDb } = await import('../db.js');
    const { recoverDaemons, stopAllDaemons } = await import('../routes/task-auto.js');
    const db = new NotebookDb(path.join(tmpDir, 'test.db'));

    const taskDir = path.join(tmpDir, 'task-dup');
    await mkdir(taskDir, { recursive: true });

    db.startAuto('session-dup', taskDir, 20, 30);

    // First recovery
    const first = recoverDaemons(db);
    expect(first).toBe(1);

    // Second recovery — should skip (daemon already exists)
    const second = recoverDaemons(db);
    expect(second).toBe(0);

    stopAllDaemons();
  });
});
