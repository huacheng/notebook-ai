import { Router, type IRouter } from 'express';
import { exec as execCb } from 'child_process';
import { readFile } from 'fs/promises';
import { promisify } from 'util';
import path from 'path';
import os from 'os';

const exec = promisify(execCb);

function pluginsDir(): string {
  return path.join(os.homedir(), '.claude', 'plugins');
}

async function readJson<T = unknown>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, 'utf-8')) as T;
  } catch {
    return null;
  }
}

function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0);
  const pb = b.split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

interface PreflightAlert {
  id: string;
  severity: 'warn' | 'info';
  message: string;
  action?: string;
}

const MOONVIEW_REPO = 'https://github.com/huacheng/moonview.git';

/**
 * Get latest tag from remote git repo (e.g. v0.9.12 → 0.9.12).
 * Uses git ls-remote which works for both public and SSH-accessible private repos.
 */
async function getRemoteLatestTag(repoUrl: string): Promise<string | null> {
  try {
    const { stdout } = await exec(`git ls-remote --tags --sort=-v:refname "${repoUrl}" "v*" 2>/dev/null | head -1`, { timeout: 10_000 });
    // Format: <sha>\trefs/tags/v0.9.12
    const match = stdout.match(/refs\/tags\/v(.+)/);
    return match ? match[1].replace(/\^{}$/, '') : null;
  } catch {
    return null;
  }
}

/**
 * Check task-ai plugin: not installed → warn, outdated vs remote tag → info update prompt.
 */
async function checkTaskAiPlugin(): Promise<PreflightAlert | null> {
  const base = pluginsDir();
  const pluginKey = 'task-ai@moonview';

  // 1. Read installed version from installed_plugins.json
  const installed = await readJson<{ version?: number; plugins?: Record<string, Array<{ version?: string }>> }>(
    path.join(base, 'installed_plugins.json'),
  );
  const entries = installed?.plugins?.[pluginKey];
  const localVersion = entries?.[0]?.version;

  if (!localVersion) {
    return { id: 'plugin-task-ai', severity: 'warn', message: 'task-ai plugin is not installed.' };
  }

  // 2. Get latest version from remote marketplace tags
  const remoteVersion = await getRemoteLatestTag(MOONVIEW_REPO);

  // 3. Fallback: read local marketplace.json cache
  let marketplaceVersion: string | null = null;
  if (!remoteVersion) {
    for (const mpPath of [
      path.join(base, 'marketplaces', 'moonview', '.claude-plugin', 'marketplace.json'),
      path.join(base, 'marketplaces', 'moonview', 'marketplace.json'),
    ]) {
      const mp = await readJson<{ plugins?: Array<{ name?: string; version?: string }> }>(mpPath);
      const entry = mp?.plugins?.find((p) => p.name === 'task-ai');
      if (entry?.version) { marketplaceVersion = entry.version; break; }
    }
  }

  // 4. Compare: remote > local → suggest update
  const latest = remoteVersion ?? marketplaceVersion;
  if (latest && compareSemver(latest, localVersion) > 0) {
    return {
      id: 'plugin-task-ai-update',
      severity: 'info',
      message: `task-ai plugin update available: ${localVersion} → ${latest}`,
      action: '/api/plugin/update',
    };
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
        'bash "$MAINTAIN_SH" --install-cron',
        { timeout: 10_000, env: { ...process.env, NB_WORKSPACES_ROOT: workspacesRoot, MAINTAIN_SH: maintainSh } },
      );
      res.json({ ok: true, output: (stdout + stderr).trim() });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  return router;
}
