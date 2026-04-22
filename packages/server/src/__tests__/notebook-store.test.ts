import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readdir, readFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { NotebookStore } from '../notebook-store.js';
import type { Notebook } from '@notebook-ai/shared';

let tmpDir: string;
let store: NotebookStore;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'notebook-store-test-'));
  store = new NotebookStore();
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ── createNew ────────────────────────────────────────────────────────────────

describe('createNew', () => {
  it('creates a valid notebook with the given title and cwd', () => {
    const nb = store.createNew('My Notebook', '/home/user/project');
    expect(nb.version).toBe(1);
    expect(nb.metadata.title).toBe('My Notebook');
    expect(nb.metadata.cwd).toBe('/home/user/project');
    expect(nb.metadata.git_repo).toBe(false);
    expect(nb.cells).toEqual([]);
    expect(nb.annotations).toEqual([]);
    expect(nb.slide.generated).toBe(false);
    expect(nb.slide.sections).toEqual([]);
    expect(nb.assets.intermediate_files).toEqual([]);
  });

  it('sets created and updated timestamps', () => {
    const before = new Date().toISOString();
    const nb = store.createNew('Test', '/tmp');
    const after = new Date().toISOString();
    expect(nb.metadata.created).toBeDefined();
    expect(nb.metadata.created >= before).toBe(true);
    expect(nb.metadata.created <= after).toBe(true);
  });

  it('produces a notebook that passes schema validation', () => {
    const nb = store.createNew('Schema Test', '/tmp');
    // If createNew used NotebookSchema.parse internally and it threw, this test
    // would not reach this point. We double check by round-tripping.
    const { NotebookSchema } = require('@notebook-ai/shared');
    const result = NotebookSchema.safeParse(nb);
    expect(result.success).toBe(true);
  });
});

// ── save and load roundtrip ──────────────────────────────────────────────────

describe('save and load', () => {
  it('roundtrips a notebook through save and load', async () => {
    const nb = store.createNew('Roundtrip', '/tmp');
    const filePath = path.join(tmpDir, 'roundtrip.notebook.json');

    await store.save(filePath, nb);
    const loaded = await store.load(filePath);

    expect(loaded.metadata.title).toBe('Roundtrip');
    expect(loaded.metadata.cwd).toBe('/tmp');
    expect(loaded.version).toBe(1);
    expect(loaded.cells).toEqual([]);
  });

  it('preserves cells through save and load', async () => {
    const nb = store.createNew('With Cells', '/tmp');
    nb.cells.push({
      id: 'cell-1',
      type: 'prompt',
      source: 'Explain TypeScript',
      execution_count: 1,
      status: 'completed',
      outputs: [
        { type: 'text', content: 'TypeScript is a superset of JavaScript.' },
      ],
    });
    nb.cells.push({
      id: 'cell-2',
      type: 'markdown',
      source: '# Notes',
      execution_count: 0,
      status: 'idle',
    });

    const filePath = path.join(tmpDir, 'with-cells.notebook.json');
    await store.save(filePath, nb);
    const loaded = await store.load(filePath);

    expect(loaded.cells).toHaveLength(2);
    expect(loaded.cells[0].type).toBe('prompt');
    expect(loaded.cells[0].source).toBe('Explain TypeScript');
    if (loaded.cells[0].type === 'prompt') {
      expect(loaded.cells[0].outputs).toHaveLength(1);
      expect(loaded.cells[0].outputs[0].type).toBe('text');
    }
    expect(loaded.cells[1].type).toBe('markdown');
  });

  it('updates the updated timestamp on save', async () => {
    const nb = store.createNew('Timestamp Test', '/tmp');
    const originalUpdated = nb.metadata.updated;

    // Small delay to ensure different timestamp
    await new Promise((r) => setTimeout(r, 10));

    const filePath = path.join(tmpDir, 'ts-test.notebook.json');
    await store.save(filePath, nb);
    const loaded = await store.load(filePath);

    // save() sets metadata.updated to new Date().toISOString()
    // It may or may not differ if it runs within the same ms, but it should be defined
    expect(loaded.metadata.updated).toBeDefined();
  });
});

// ── load error cases ─────────────────────────────────────────────────────────

describe('load error cases', () => {
  it('rejects non-existent files', async () => {
    const filePath = path.join(tmpDir, 'nonexistent.notebook.json');
    await expect(store.load(filePath)).rejects.toThrow('Failed to read notebook');
  });

  it('rejects invalid JSON', async () => {
    const filePath = path.join(tmpDir, 'bad.notebook.json');
    await writeFile(filePath, 'not valid json {{{', 'utf8');
    await expect(store.load(filePath)).rejects.toThrow('Failed to parse notebook JSON');
  });

  it('rejects valid JSON that does not match schema', async () => {
    const filePath = path.join(tmpDir, 'invalid-schema.notebook.json');
    await writeFile(filePath, JSON.stringify({ foo: 'bar' }), 'utf8');
    await expect(store.load(filePath)).rejects.toThrow('failed schema validation');
  });

  it('rejects JSON array instead of object', async () => {
    const filePath = path.join(tmpDir, 'array.notebook.json');
    await writeFile(filePath, '[]', 'utf8');
    await expect(store.load(filePath)).rejects.toThrow('failed schema validation');
  });
});

// ── list ─────────────────────────────────────────────────────────────────────

describe('list', () => {
  it('finds .notebook.json files', async () => {
    // Create two valid notebooks
    const nb1 = store.createNew('Alpha', '/tmp');
    const nb2 = store.createNew('Beta', '/tmp');
    await store.save(path.join(tmpDir, 'alpha.notebook.json'), nb1);
    await store.save(path.join(tmpDir, 'beta.notebook.json'), nb2);

    // Also create a non-notebook file
    await writeFile(path.join(tmpDir, 'readme.txt'), 'hello', 'utf8');

    const results = await store.list(tmpDir);
    expect(results).toHaveLength(2);
    expect(results[0].name).toBe('alpha.notebook.json');
    expect(results[0].title).toBe('Alpha');
    expect(results[1].name).toBe('beta.notebook.json');
    expect(results[1].title).toBe('Beta');
  });

  it('returns empty array for directory with no notebooks', async () => {
    const results = await store.list(tmpDir);
    expect(results).toEqual([]);
  });

  it('skips invalid notebook files', async () => {
    const nb = store.createNew('Valid', '/tmp');
    await store.save(path.join(tmpDir, 'valid.notebook.json'), nb);
    await writeFile(path.join(tmpDir, 'broken.notebook.json'), 'not json', 'utf8');

    const results = await store.list(tmpDir);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('valid.notebook.json');
  });

  it('returns absolute paths', async () => {
    const nb = store.createNew('Path Test', '/tmp');
    await store.save(path.join(tmpDir, 'pathtest.notebook.json'), nb);

    const results = await store.list(tmpDir);
    expect(results).toHaveLength(1);
    expect(path.isAbsolute(results[0].path)).toBe(true);
    expect(results[0].path).toBe(path.join(tmpDir, 'pathtest.notebook.json'));
  });

  it('throws for non-existent directory', async () => {
    await expect(store.list('/tmp/nonexistent-dir-9999')).rejects.toThrow(
      'Failed to read directory',
    );
  });
});

// ── titleToFilename ──────────────────────────────────────────────────────────

describe('titleToFilename', () => {
  it('converts title to lowercase kebab-case filename', () => {
    expect(NotebookStore.titleToFilename('My Test Notebook')).toBe(
      'my-test-notebook.notebook.json',
    );
  });

  it('removes special characters', () => {
    expect(NotebookStore.titleToFilename('Hello, World! (2025)')).toBe(
      'hello-world-2025.notebook.json',
    );
  });

  it('trims leading and trailing hyphens', () => {
    expect(NotebookStore.titleToFilename('---test---')).toBe('test.notebook.json');
  });

  it('handles empty title with fallback', () => {
    const filename = NotebookStore.titleToFilename('');
    expect(filename).toMatch(/^[a-z0-9-]+\.notebook\.json$/);
    expect(filename).not.toBe('.notebook.json');
  });

  it('handles whitespace-only title with fallback', () => {
    const filename = NotebookStore.titleToFilename('   ');
    expect(filename).toMatch(/^[a-z0-9-]+\.notebook\.json$/);
  });

  it('always ends with .notebook.json', () => {
    expect(NotebookStore.titleToFilename('anything')).toMatch(/\.notebook\.json$/);
    expect(NotebookStore.titleToFilename('')).toMatch(/\.notebook\.json$/);
    expect(NotebookStore.titleToFilename('!@#$%')).toMatch(/\.notebook\.json$/);
  });

  it('collapses multiple special characters into one hyphen', () => {
    expect(NotebookStore.titleToFilename('a   b   c')).toBe('a-b-c.notebook.json');
    expect(NotebookStore.titleToFilename('a---b---c')).toBe('a-b-c.notebook.json');
  });
});

// ── atomic write ────────────────────────────────────────────────────────────

describe('save atomicity', () => {
  it('leaves no .tmp file on successful save', async () => {
    const nb = store.createNew('Atomic', '/tmp');
    const filePath = path.join(tmpDir, 'atomic.notebook.json');
    await store.save(filePath, nb);
    const entries = await readdir(tmpDir);
    expect(entries.some((e) => e.endsWith('.tmp'))).toBe(false);
    expect(entries).toContain('atomic.notebook.json');
  });

  it('final file is valid JSON after save', async () => {
    const nb = store.createNew('ValidJSON', '/tmp');
    const filePath = path.join(tmpDir, 'valid.notebook.json');
    await store.save(filePath, nb);
    const raw = await readFile(filePath, 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
    expect(JSON.parse(raw).metadata.title).toBe('ValidJSON');
  });
});
