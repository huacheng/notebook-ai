import { Router, type IRouter } from 'express';
import { exec as execCb } from 'child_process';
import { readFile } from 'fs/promises';
import { promisify } from 'util';
import path from 'path';
import os from 'os';

const exec = promisify(execCb);

interface PreflightAlert {
  id: string;
  severity: 'warn' | 'info';
  message: string;
  action?: string; // API endpoint to resolve
}

async function checkTaskAiPlugin(): Promise<PreflightAlert | null> {
  try {
    const filePath = path.join(os.homedir(), '.claude', 'plugins', 'installed_plugins.json');
    const raw = await readFile(filePath, 'utf-8');
    const data = JSON.parse(raw) as Record<string, unknown>;
    const hasTaskAi = Object.keys(data).some((k) => k.startsWith('task-ai@'));
    if (!hasTaskAi) {
      return { id: 'plugin-task-ai', severity: 'warn', message: 'task-ai plugin is not installed.', action: '/api/plugin/install' };
    }
  } catch {
    return { id: 'plugin-task-ai', severity: 'warn', message: 'task-ai plugin is not installed.', action: '/api/plugin/install' };
  }
  return null;
}

async function checkCronScheduled(): Promise<PreflightAlert | null> {
  try {
    const { stdout } = await exec('crontab -l 2>/dev/null');
    if (stdout.includes('task-ai:scheduled')) {
      return null; // cron is configured
    }
  } catch {
    // crontab -l fails if no crontab exists
  }
  return { id: 'cron-task-ai', severity: 'info', message: 'task-ai scheduled maintenance cron is not configured.', action: '/api/system/install-cron' };
}

export function createSystemRouter(): IRouter {
  const router = Router();

  // GET /preflight — unified system health check
  router.get('/preflight', async (_req, res) => {
    const alerts: PreflightAlert[] = [];
    const [pluginAlert, cronAlert] = await Promise.all([
      checkTaskAiPlugin(),
      checkCronScheduled(),
    ]);
    if (pluginAlert) alerts.push(pluginAlert);
    if (cronAlert) alerts.push(cronAlert);
    res.json({ alerts });
  });

  // POST /install-cron — install task-ai scheduled maintenance cron
  router.post('/install-cron', async (_req, res) => {
    try {
      // Find the latest maintain.sh in plugin cache
      const pluginBase = path.join(os.homedir(), '.claude', 'plugins', 'cache', 'moonview', 'task-ai');
      const { stdout: lsOut } = await exec(`ls -d "${pluginBase}"/*/skills/library/scripts/maintain.sh 2>/dev/null | sort -V | tail -1`);
      const maintainSh = lsOut.trim();
      if (!maintainSh) {
        res.status(404).json({ error: 'maintain.sh not found. Is task-ai plugin installed?' });
        return;
      }

      const workspacesRoot = process.env['NB_WORKSPACES_ROOT'] ?? path.join(os.homedir(), 'nb-workspaces');
      const { stdout, stderr } = await exec(
        `NB_WORKSPACES_ROOT="${workspacesRoot}" bash "${maintainSh}" --install-cron`,
        { timeout: 10_000 },
      );
      res.json({ ok: true, output: (stdout + stderr).trim() });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  return router;
}
