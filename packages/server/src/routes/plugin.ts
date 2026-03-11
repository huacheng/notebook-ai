import { Router, type IRouter } from 'express';
import { readFile, readdir, writeFile, unlink } from 'fs/promises';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import os from 'os';

const execFile = promisify(execFileCb);

// ── Validation helpers (D2-5) ───────────────────────────────────────────────

/** Plugin key must be name@marketplace — safe chars only, max 200 chars. */
const PLUGIN_KEY_RE = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+$/;

export function validatePluginKey(key: string): boolean {
  return key.length > 0 && key.length <= 200 && PLUGIN_KEY_RE.test(key);
}

/** Marketplace name: alphanumeric + hyphens + underscores + dots, max 100 chars. */
const MP_NAME_RE = /^[a-zA-Z0-9._-]+$/;

export function validateMarketplaceName(name: string): boolean {
  return name.length > 0 && name.length <= 100 && MP_NAME_RE.test(name);
}

/** Marketplace source: URL or git SSH path, no shell metacharacters, max 500 chars. */
const SHELL_META_RE = /[;`$(){}|<>&!]/;

export function validateMarketplaceSource(source: string): boolean {
  return source.length > 0 && source.length <= 500 && !SHELL_META_RE.test(source);
}

function pluginsDir(): string {
  return path.join(os.homedir(), '.claude', 'plugins');
}

async function readJson<T = unknown>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function execClaude(args: string[]): Promise<{ stdout: string; stderr: string }> {
  const env = { ...process.env };
  delete env['CLAUDECODE'];
  return execFile('claude', args, { timeout: 60_000, env });
}

/**
 * Compare semver versions. Returns positive if a > b, negative if a < b, 0 if equal.
 */
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

/**
 * Fix installed_plugins.json after `claude plugin update` to point to the latest cached version.
 * Workaround for Claude CLI bug that downloads new version but doesn't update version/installPath.
 */
export async function fixInstalledPluginVersion(pluginKey: string, baseOverride?: string): Promise<void> {
  const [pluginName, marketplace] = pluginKey.split('@');
  if (!pluginName || !marketplace) return;

  const base = baseOverride ?? pluginsDir();
  const cacheDir = path.join(base, 'cache', marketplace, pluginName);
  const installedPath = path.join(base, 'installed_plugins.json');

  // Read cached versions
  let versions: string[];
  try {
    versions = await readdir(cacheDir);
  } catch {
    return; // No cache directory
  }

  // Find latest version by reading plugin.json from each
  let latestVersion: string | null = null;
  for (const ver of versions) {
    const pluginJson = await readJson<{ version?: string }>(
      path.join(cacheDir, ver, 'plugin.json'),
    );
    if (pluginJson?.version) {
      if (!latestVersion || compareSemver(pluginJson.version, latestVersion) > 0) {
        latestVersion = pluginJson.version;
      }
    }
  }

  if (!latestVersion) return;

  // Remove .orphaned_at marker from latest version (Claude CLI bug workaround)
  const orphanedPath = path.join(cacheDir, latestVersion, '.orphaned_at');
  try {
    await unlink(orphanedPath);
  } catch {
    // Ignore if marker doesn't exist
  }

  // Read and update installed_plugins.json
  const installedRaw = await readJson<{ version?: number; plugins?: Record<string, unknown[]> }>(
    installedPath,
  );
  if (!installedRaw || installedRaw.version !== 2 || !installedRaw.plugins) return;

  const entries = installedRaw.plugins[pluginKey] as { version?: string; installPath?: string }[] | undefined;
  if (!entries || entries.length === 0) return;

  const entry = entries[0];
  if (entry.version === latestVersion) return; // Already correct

  // Update version and installPath
  entry.version = latestVersion;
  entry.installPath = path.join(cacheDir, latestVersion);

  await writeFile(installedPath, JSON.stringify(installedRaw, null, 2));
}

/**
 * Git-based fallback for plugin update.
 * When `claude plugin update` succeeds but doesn't download the new version,
 * this clones the marketplace repo, reads the latest plugin version from
 * .claude-plugin/marketplace.json, and copies the plugin source to the cache.
 */
export async function gitFallbackUpdate(pluginKey: string, baseOverride?: string): Promise<boolean> {
  const [pluginName, marketplace] = pluginKey.split('@');
  if (!pluginName || !marketplace) return false;

  const base = baseOverride ?? pluginsDir();

  // Read marketplace source URL from known_marketplaces.json
  const knownPath = path.join(base, 'known_marketplaces.json');
  const known = await readJson<Record<string, { source?: string | { source?: string; url?: string; repo?: string } }>>(knownPath);
  const sourceEntry = known?.[marketplace]?.source;
  if (!sourceEntry) return false;

  // source can be a plain URL string or { source: "git", url: "..." } or { source: "github", repo: "owner/name" }
  let repoUrl: string;
  if (typeof sourceEntry === 'string') {
    repoUrl = sourceEntry;
  } else if (sourceEntry.url) {
    repoUrl = sourceEntry.url;
  } else if (sourceEntry.repo) {
    repoUrl = `https://github.com/${sourceEntry.repo}.git`;
  } else {
    return false;
  }
  const tmpClone = path.join(os.tmpdir(), `plugin-update-${marketplace}-${Date.now()}`);

  try {
    // Shallow clone for speed
    await execFile('git', ['clone', '--depth', '1', repoUrl, tmpClone], { timeout: 30_000 });

    // Read marketplace.json to find plugin version and source path
    const mpJson = await readJson<{ plugins?: { name: string; version?: string; source?: string }[] }>(
      path.join(tmpClone, '.claude-plugin', 'marketplace.json'),
    );
    const pluginMeta = mpJson?.plugins?.find(p => p.name === pluginName);
    if (!pluginMeta?.version || !pluginMeta?.source) return false;

    const remoteVersion = pluginMeta.version;

    // Check if this version already exists in cache
    const cacheDir = path.join(base, 'cache', marketplace, pluginName);
    const targetDir = path.join(cacheDir, remoteVersion);
    const existingPlugin = await readJson<{ version?: string }>(path.join(targetDir, 'plugin.json'));
    if (existingPlugin?.version === remoteVersion) return false; // Already have it

    // Copy plugin source to cache
    const sourcePath = path.join(tmpClone, pluginMeta.source);
    await execFile('mkdir', ['-p', targetDir]);
    // Use cp -r to copy all files
    await execFile('cp', ['-r', `${sourcePath}/.`, targetDir], { timeout: 10_000 });

    // Now fix installed_plugins.json to point to new version
    await fixInstalledPluginVersion(pluginKey, baseOverride);

    // Sync local marketplace directory so GET /status shows updated version
    const mpDir = path.join(base, 'marketplaces', marketplace, '.claude-plugin');
    try {
      await execFile('mkdir', ['-p', mpDir]);
      await execFile('cp', ['-r', `${path.join(tmpClone, '.claude-plugin')}/.`, mpDir], { timeout: 10_000 });
    } catch {
      // Non-fatal: plugin is updated even if marketplace metadata sync fails
    }

    return true;
  } catch {
    return false;
  } finally {
    // Cleanup temp clone
    await execFile('rm', ['-rf', tmpClone]).catch(() => {});
  }
}

export function createPluginRouter(): IRouter {
  const router = Router();

  // GET /status — read three local JSON files, merge and return
  router.get('/status', async (_req, res) => {
    const base = pluginsDir();

    // 1. Read known_marketplaces.json → marketplaces[]
    const knownRaw = await readJson<Record<string, { source: unknown; lastUpdated?: string }>>(
      path.join(base, 'known_marketplaces.json'),
    );
    const known = knownRaw ?? {};
    const marketplaces = Object.entries(known).map(([name, val]) => ({
      name,
      source: val.source,
      lastUpdated: val.lastUpdated,
    }));

    // 2. For each marketplace, read marketplace.json → extract plugins[]
    const plugins: { name: string; marketplace: string; key: string; description?: string; version?: string; category?: string }[] = [];
    for (const mp of marketplaces) {
      const mpJson = await readJson<{ plugins?: { name: string; description?: string; version?: string; category?: string }[] }>(
        path.join(base, 'marketplaces', mp.name, '.claude-plugin', 'marketplace.json'),
      );
      if (mpJson?.plugins) {
        for (const p of mpJson.plugins) {
          plugins.push({
            name: p.name,
            marketplace: mp.name,
            key: `${p.name}@${mp.name}`,
            description: p.description,
            version: p.version,
            category: p.category,
          });
        }
      }
    }

    // 3. Read installed_plugins.json → flatten v2 format
    const installedRaw = await readJson<Record<string, unknown>>(
      path.join(base, 'installed_plugins.json'),
    );
    let installed: Record<string, { version?: string; installedAt?: string }> = {};
    if (installedRaw) {
      if ((installedRaw as any).version === 2 && (installedRaw as any).plugins) {
        const v2plugins = (installedRaw as any).plugins as Record<string, { version?: string; installedAt?: string }[]>;
        for (const [key, entries] of Object.entries(v2plugins)) {
          if (Array.isArray(entries) && entries.length > 0) {
            const e = entries[0];
            installed[key] = { version: e.version, installedAt: e.installedAt };
          }
        }
      } else {
        // Legacy format: direct key → { version }
        const { version: _v, plugins: _p, ...rest } = installedRaw as any;
        // If it's truly legacy (no version field), use as-is
        if (_v === undefined) {
          installed = installedRaw as any;
        } else {
          installed = rest;
        }
      }
    }

    res.json({ marketplaces, plugins, installed });
  });

  // POST /install — install plugin via claude CLI
  router.post('/install', async (req, res) => {
    const pluginKey = req.body?.plugin;
    if (!pluginKey || typeof pluginKey !== 'string') {
      return res.status(400).json({ error: 'Missing required field: plugin' });
    }
    if (!validatePluginKey(pluginKey)) {
      return res.status(400).json({ error: 'Invalid plugin key format. Expected: name@marketplace' });
    }
    try {
      await execClaude(['plugin', 'install', pluginKey]);
      res.json({ ok: true });
    } catch (err: unknown) {
      res.status(500).json({ ok: false, error: 'Install failed.' });
    }
  });

  // POST /uninstall — uninstall plugin via claude CLI
  router.post('/uninstall', async (req, res) => {
    const pluginKey = req.body?.plugin;
    if (!pluginKey || typeof pluginKey !== 'string') {
      return res.status(400).json({ error: 'Missing required field: plugin' });
    }
    if (!validatePluginKey(pluginKey)) {
      return res.status(400).json({ error: 'Invalid plugin key format. Expected: name@marketplace' });
    }
    try {
      await execClaude(['plugin', 'uninstall', pluginKey]);
      res.json({ ok: true });
    } catch (err: unknown) {
      res.status(500).json({ ok: false, error: 'Uninstall failed.' });
    }
  });

  // POST /marketplace/add — add marketplace via claude CLI
  router.post('/marketplace/add', async (req, res) => {
    const source = req.body?.source;
    if (!source || typeof source !== 'string') {
      return res.status(400).json({ error: 'Missing required field: source' });
    }
    if (!validateMarketplaceSource(source)) {
      return res.status(400).json({ error: 'Invalid marketplace source format.' });
    }
    try {
      await execClaude(['plugin', 'marketplace', 'add', source]);
      res.json({ ok: true });
    } catch (err: unknown) {
      res.status(500).json({ ok: false, error: 'Add marketplace failed.' });
    }
  });

  // POST /marketplace/update — update marketplace(s) via claude CLI
  router.post('/marketplace/update', async (req, res) => {
    const name = req.body?.name;
    if (name && typeof name === 'string' && !validateMarketplaceName(name)) {
      return res.status(400).json({ error: 'Invalid marketplace name format.' });
    }
    try {
      const args = ['plugin', 'marketplace', 'update'];
      if (name && typeof name === 'string') args.push(name);
      await execClaude(args);
      res.json({ ok: true });
    } catch (err: unknown) {
      res.status(500).json({ ok: false, error: 'Update marketplace failed.' });
    }
  });

  // POST /marketplace/remove — remove marketplace via claude CLI
  router.post('/marketplace/remove', async (req, res) => {
    const name = req.body?.name;
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'Missing required field: name' });
    }
    if (!validateMarketplaceName(name)) {
      return res.status(400).json({ error: 'Invalid marketplace name format.' });
    }
    try {
      await execClaude(['plugin', 'marketplace', 'remove', name]);
      res.json({ ok: true });
    } catch (err: unknown) {
      res.status(500).json({ ok: false, error: 'Remove marketplace failed.' });
    }
  });

  // POST /update — update a single plugin via claude CLI
  router.post('/update', async (req, res) => {
    const pluginKey = req.body?.plugin;
    if (!pluginKey || typeof pluginKey !== 'string') {
      return res.status(400).json({ error: 'Missing required field: plugin' });
    }
    if (!validatePluginKey(pluginKey)) {
      return res.status(400).json({ error: 'Invalid plugin key format. Expected: name@marketplace' });
    }

    const steps: string[] = [];
    let cliOk = false;

    // Step 1: Try CLI update
    try {
      const { stdout, stderr } = await execClaude(['plugin', 'update', pluginKey]);
      cliOk = true;
      steps.push(`CLI update succeeded${stdout ? ': ' + stdout.trim().slice(0, 200) : ''}`);
      if (stderr) steps.push(`CLI stderr: ${stderr.trim().slice(0, 200)}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      steps.push(`CLI update failed: ${msg.slice(0, 300)}`);
    }

    // Step 2: Fix installed version pointer
    try {
      await fixInstalledPluginVersion(pluginKey);
      steps.push('fixInstalledPluginVersion completed');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      steps.push(`fixInstalledPluginVersion failed: ${msg.slice(0, 300)}`);
    }

    // Step 3: Git fallback if needed
    try {
      const didFallback = await gitFallbackUpdate(pluginKey);
      if (didFallback) {
        cliOk = true;
        steps.push('Git fallback update succeeded');
      } else {
        steps.push('Git fallback skipped (already up-to-date or not needed)');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      steps.push(`Git fallback failed: ${msg.slice(0, 300)}`);
    }

    // Step 4: Show final cached versions (after git fallback)
    try {
      const [pName, mpName] = pluginKey.split('@');
      const base = pluginsDir();
      const cacheDir = path.join(base, 'cache', mpName ?? '', pName ?? '');
      const { readdir: rd } = await import('fs/promises');
      const cached = await rd(cacheDir).catch(() => [] as string[]);
      // Sort by semver to show latest
      cached.sort((a, b) => compareSemver(a, b));
      const latest = cached.length > 0 ? cached[cached.length - 1] : 'none';
      steps.push(`Cached versions: [${cached.join(', ')}] (latest: ${latest})`);
    } catch { /* ignore */ }

    console.log(`[plugin] Update ${pluginKey}: ${steps.join(' | ')}`);
    res.json({ ok: cliOk, steps });
  });

  return router;
}
