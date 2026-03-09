import { Router, type IRouter, type Request, type Response } from 'express';
import { existsSync, unlinkSync } from 'fs';
import path from 'path';
import type { NotebookDb } from '../db.js';
import { TaskAutoDaemon, type StallRecoveryAction } from '../task-ai/task-auto-daemon.js';

// Active daemons keyed by session_name
const daemons = new Map<string, TaskAutoDaemon>();

/**
 * Wire daemon events to send recovery prompts through the agent session.
 * Called when creating or recovering a daemon.
 */
export function wireDaemonToSession(
  daemon: TaskAutoDaemon,
  sessionManager: { getSession: (id: string) => { agentProcess: { sendPrompt: (msg: string) => void; isAlive: () => boolean } } | undefined },
): void {
  const sendToAgent = (message: string) => {
    const session = sessionManager.getSession(daemon.sessionId);
    if (!session?.agentProcess?.isAlive()) return;
    session.agentProcess.sendPrompt(message);
  };

  daemon.on('compaction-recovery', (signal: { type: string; message: string }) => {
    sendToAgent(signal.message);
  });

  daemon.on('stall-recovery', (action: StallRecoveryAction) => {
    if (action.message) {
      sendToAgent(action.message);
    }
  });

}

// Stored reference for wiring daemons to sessions
let _sessionManager: Parameters<typeof wireDaemonToSession>[1] | null = null;

export function setSessionManager(sm: Parameters<typeof wireDaemonToSession>[1]): void {
  _sessionManager = sm;
}

export function createTaskAutoRouter(db: NotebookDb): IRouter {
  const router = Router();

  /**
   * POST /api/sessions/:id/task-auto
   * Start auto mode for a session.
   * Body: { taskDir: string, maxIterations?: number, timeoutMinutes?: number }
   */
  router.post('/:id/task-auto', (req: Request, res: Response) => {
    const sessionId = req.params.id as string;
    const { taskDir, maxIterations = 20, timeoutMinutes = 30 } = req.body as {
      taskDir?: string;
      maxIterations?: number;
      timeoutMinutes?: number;
    };

    if (!taskDir || typeof taskDir !== 'string') {
      res.status(400).json({ error: '"taskDir" is required.' });
      return;
    }

    // Check no existing auto for this session
    const existing = db.getAuto(sessionId);
    if (existing) {
      res.status(409).json({ error: 'Auto mode already running for this session.' });
      return;
    }

    // Check no existing auto for this task_dir
    const byDir = db.getAutoByTaskDir(taskDir);
    if (byDir) {
      res.status(409).json({
        error: 'Auto mode already running for this task directory.',
        session_name: byDir.session_name,
      });
      return;
    }

    try {
      db.startAuto(sessionId, taskDir, maxIterations, timeoutMinutes);
    } catch (err) {
      res.status(500).json({ error: 'Failed to start auto mode.' });
      return;
    }

    // Start daemon
    const daemon = new TaskAutoDaemon({
      sessionId,
      taskDir,
      maxIterations,
      timeoutMinutes,
    });

    daemon.on('complete', (_reason: string) => {
      daemons.delete(sessionId);
      try { db.stopAuto(sessionId); } catch { /* best effort */ }
    });

    if (_sessionManager) {
      wireDaemonToSession(daemon, _sessionManager);
    }

    daemon.start();
    daemons.set(sessionId, daemon);

    res.status(201).json({ status: 'started', sessionId, taskDir, maxIterations, timeoutMinutes });
  });

  /**
   * DELETE /api/sessions/:id/task-auto
   * Stop auto mode — writes .auto-stop for graceful termination.
   */
  router.delete('/:id/task-auto', (req: Request, res: Response) => {
    const sessionId = req.params.id as string;

    const daemon = daemons.get(sessionId);
    if (daemon) {
      daemon.stop();
      daemons.delete(sessionId);
    }

    try { db.stopAuto(sessionId); } catch { /* row may not exist */ }

    res.status(200).json({ status: 'stopped' });
  });

  /**
   * GET /api/sessions/:id/task-auto
   * Get auto mode status for a session.
   */
  router.get('/:id/task-auto', (req: Request, res: Response) => {
    const sessionId = req.params.id as string;
    const row = db.getAuto(sessionId);

    if (!row) {
      res.status(404).json({ error: 'No auto mode running for this session.' });
      return;
    }

    const daemon = daemons.get(sessionId);
    res.json({
      ...row,
      daemon_active: !!daemon && daemon.status === 'running',
    });
  });

  /**
   * GET /api/task-auto/lookup?taskDir=<path>
   * Look up which session is running auto for a given task directory.
   */
  router.get('/lookup', (req: Request, res: Response) => {
    const taskDir = (typeof req.query.taskDir === 'string') ? req.query.taskDir : undefined;
    if (!taskDir) {
      res.status(400).json({ error: '"taskDir" query parameter is required.' });
      return;
    }

    const row = db.getAutoByTaskDir(taskDir);
    if (!row) {
      res.status(404).json({ error: 'No auto mode running for this task directory.' });
      return;
    }

    res.json({ session_name: row.session_name, status: row.status });
  });

  return router;
}

/** Get a daemon by session ID (for stream integration) */
export function getDaemon(sessionId: string): TaskAutoDaemon | undefined {
  return daemons.get(sessionId);
}

/** Stop all active daemons (for server shutdown) */
export function stopAllDaemons(): void {
  for (const daemon of daemons.values()) {
    daemon.stop();
  }
  daemons.clear();
}

/**
 * Recover active auto daemons on server restart.
 * Re-creates daemon monitors for any task_auto rows with status='running'.
 * Cleans up stale .auto-stop files from pre-crash state.
 */
export function recoverDaemons(db: NotebookDb): number {
  const rows = db.getAllRunningAuto();
  let recovered = 0;

  for (const row of rows) {
    // Skip if daemon already exists
    if (daemons.has(row.session_name)) continue;

    // Check if task_dir still exists
    if (!existsSync(row.task_dir)) {
      // Task dir gone — clean up stale DB row
      try { db.stopAuto(row.session_name); } catch { /* best effort */ }
      continue;
    }

    // Delete stale .auto-stop if exists (from pre-crash state)
    const stopPath = path.join(row.task_dir, '.auto-stop');
    if (existsSync(stopPath)) {
      try { unlinkSync(stopPath); } catch { /* best effort */ }
    }

    // Re-create daemon
    const daemon = new TaskAutoDaemon({
      sessionId: row.session_name,
      taskDir: row.task_dir,
      maxIterations: row.max_iterations,
      timeoutMinutes: row.timeout_minutes,
    });

    daemon.on('complete', (_reason: string) => {
      daemons.delete(row.session_name);
      try { db.stopAuto(row.session_name); } catch { /* best effort */ }
    });

    if (_sessionManager) {
      wireDaemonToSession(daemon, _sessionManager);
    }

    daemon.start();
    daemons.set(row.session_name, daemon);
    recovered++;
  }

  return recovered;
}
