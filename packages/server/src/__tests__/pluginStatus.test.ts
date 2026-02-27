/**
 * Plugin multi-marketplace status endpoint — TDD tests
 *
 * GET /api/plugin/status reads three local JSON files and returns merged data:
 *   - known_marketplaces.json → marketplaces[]
 *   - marketplaces/{name}/.claude-plugin/marketplace.json → plugins[]
 *   - installed_plugins.json → installed{}
 *
 * POST endpoints delegate to `claude` CLI.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { createPluginRouter } from '../routes/plugin.js';

let tmpHome: string;
let app: ReturnType<typeof express>;
let origHome: string | undefined;

beforeEach(async () => {
  tmpHome = await mkdtemp(path.join(os.tmpdir(), 'nb-test-plugin-'));
  origHome = process.env['HOME'];
  process.env['HOME'] = tmpHome;

  const router = createPluginRouter();
  app = express();
  app.use(express.json());
  app.use('/api/plugin', router);
});

afterEach(async () => {
  process.env['HOME'] = origHome;
  await rm(tmpHome, { recursive: true, force: true });
});

// ── helpers ────────────────────────────────────────────────────

async function writeJson(relPath: string, data: unknown) {
  const full = path.join(tmpHome, '.claude', 'plugins', relPath);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, JSON.stringify(data));
}

// ── GET /api/plugin/status ─────────────────────────────────────

describe('GET /api/plugin/status', () => {
  it('returns empty arrays when no files exist', async () => {
    const res = await request(app).get('/api/plugin/status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      marketplaces: [],
      plugins: [],
      installed: {},
    });
  });

  it('returns marketplaces from known_marketplaces.json', async () => {
    await writeJson('known_marketplaces.json', {
      moonview: {
        source: { source: 'git', url: 'https://github.com/huacheng/moonview.git' },
        lastUpdated: '2026-02-27T09:12:22.311Z',
      },
    });

    const res = await request(app).get('/api/plugin/status');
    expect(res.status).toBe(200);
    expect(res.body.marketplaces).toEqual([
      {
        name: 'moonview',
        source: { source: 'git', url: 'https://github.com/huacheng/moonview.git' },
        lastUpdated: '2026-02-27T09:12:22.311Z',
      },
    ]);
  });

  it('extracts plugins from marketplace.json inside each marketplace dir', async () => {
    await writeJson('known_marketplaces.json', {
      moonview: {
        source: { source: 'git', url: 'https://github.com/huacheng/moonview.git' },
        lastUpdated: '2026-02-27T00:00:00Z',
      },
    });
    await writeJson('marketplaces/moonview/.claude-plugin/marketplace.json', {
      name: 'moonview',
      plugins: [
        { name: 'task-ai', description: 'Task management', version: '0.9.0', category: 'productivity' },
      ],
    });

    const res = await request(app).get('/api/plugin/status');
    expect(res.body.plugins).toEqual([
      {
        name: 'task-ai',
        marketplace: 'moonview',
        key: 'task-ai@moonview',
        description: 'Task management',
        version: '0.9.0',
        category: 'productivity',
      },
    ]);
  });

  it('handles multiple marketplaces and plugins', async () => {
    await writeJson('known_marketplaces.json', {
      moonview: {
        source: { source: 'git', url: 'https://github.com/huacheng/moonview.git' },
        lastUpdated: '2026-01-01T00:00:00Z',
      },
      'claude-plugins-official': {
        source: { source: 'git', url: 'https://github.com/anthropics/claude-plugins-official.git' },
        lastUpdated: '2026-01-02T00:00:00Z',
      },
    });
    await writeJson('marketplaces/moonview/.claude-plugin/marketplace.json', {
      plugins: [{ name: 'task-ai', description: 'Tasks', version: '0.9.0' }],
    });
    await writeJson('marketplaces/claude-plugins-official/.claude-plugin/marketplace.json', {
      plugins: [
        { name: 'typescript-lsp', description: 'TS LSP', version: '1.0.0' },
        { name: 'superpowers', description: 'Skills', version: '4.3.1', category: 'productivity' },
      ],
    });

    const res = await request(app).get('/api/plugin/status');
    expect(res.body.marketplaces).toHaveLength(2);
    expect(res.body.plugins).toHaveLength(3);
    expect(res.body.plugins.map((p: any) => p.key)).toEqual([
      'task-ai@moonview',
      'typescript-lsp@claude-plugins-official',
      'superpowers@claude-plugins-official',
    ]);
  });

  it('flattens version-2 installed_plugins.json format', async () => {
    await writeJson('known_marketplaces.json', {});
    await writeJson('installed_plugins.json', {
      version: 2,
      plugins: {
        'task-ai@moonview': [
          { version: '0.9.0', installedAt: '2026-02-14T00:00:00Z' },
        ],
        'superpowers@claude-plugins-official': [
          { version: '4.3.1', installedAt: '2026-02-15T00:00:00Z' },
        ],
      },
    });

    const res = await request(app).get('/api/plugin/status');
    expect(res.body.installed).toEqual({
      'task-ai@moonview': { version: '0.9.0', installedAt: '2026-02-14T00:00:00Z' },
      'superpowers@claude-plugins-official': { version: '4.3.1', installedAt: '2026-02-15T00:00:00Z' },
    });
  });

  it('handles legacy (non-version-2) installed_plugins.json', async () => {
    await writeJson('known_marketplaces.json', {});
    await writeJson('installed_plugins.json', {
      'task-ai@moonview': { version: '0.8.0' },
    });

    const res = await request(app).get('/api/plugin/status');
    expect(res.body.installed).toEqual({
      'task-ai@moonview': { version: '0.8.0' },
    });
  });

  it('gracefully handles missing marketplace.json for a known marketplace', async () => {
    await writeJson('known_marketplaces.json', {
      moonview: {
        source: { source: 'git', url: 'https://github.com/huacheng/moonview.git' },
        lastUpdated: '2026-01-01T00:00:00Z',
      },
    });
    // No marketplaces/moonview/.claude-plugin/marketplace.json

    const res = await request(app).get('/api/plugin/status');
    expect(res.status).toBe(200);
    expect(res.body.marketplaces).toHaveLength(1);
    expect(res.body.plugins).toEqual([]);
  });
});

// ── POST endpoints (validate routing + body parsing) ──────────

describe('POST /api/plugin/install', () => {
  it('requires plugin key in body', async () => {
    const res = await request(app)
      .post('/api/plugin/install')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/plugin/i);
  });
});

describe('POST /api/plugin/uninstall', () => {
  it('requires plugin key in body', async () => {
    const res = await request(app)
      .post('/api/plugin/uninstall')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/plugin/i);
  });
});

describe('POST /api/plugin/marketplace/add', () => {
  it('requires source in body', async () => {
    const res = await request(app)
      .post('/api/plugin/marketplace/add')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/source/i);
  });
});

describe('POST /api/plugin/marketplace/remove', () => {
  it('requires name in body', async () => {
    const res = await request(app)
      .post('/api/plugin/marketplace/remove')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name/i);
  });
});

// ── POST /api/plugin/marketplace/update ───────────────────────

describe('POST /api/plugin/marketplace/update', () => {
  it('accepts empty body (update all marketplaces)', async () => {
    const res = await request(app)
      .post('/api/plugin/marketplace/update')
      .send({});
    // Should not return 400 — empty body means "update all"
    expect(res.status).not.toBe(400);
  });

  it('accepts body with name', async () => {
    const res = await request(app)
      .post('/api/plugin/marketplace/update')
      .send({ name: 'moonview' });
    // Should not return 400
    expect(res.status).not.toBe(400);
  });
});

// ── POST /api/plugin/update ──────────────────────────────────

describe('POST /api/plugin/update', () => {
  it('requires plugin field in body', async () => {
    const res = await request(app)
      .post('/api/plugin/update')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/plugin/i);
  });
});
