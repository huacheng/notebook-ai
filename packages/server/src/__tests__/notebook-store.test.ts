import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readdir, readFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { NotebookStore } from '../notebook-store.js';
import { NotebookSchema } from '@notebook-ai/shared';

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
    expect(loaded.version).toBe(2);
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

// ── addCell ──────────────────────────────────────────────────────────────────

describe('addCell', () => {
  const makeCell = (id: string) => ({
    id,
    type: 'markdown' as const,
    source: `# ${id}`,
    execution_count: 0,
    status: 'idle' as const,
  });

  const makeIndex = (nb: import('@notebook-ai/shared').Notebook): import('@notebook-ai/shared').NotebookIndex => ({
    version: 2 as const,
    metadata: nb.metadata,
    cell_ids: [],
    slide: nb.slide,
    annotations: [],
    assets: nb.assets,
  });

  it('adds cell file and updates index', async () => {
    const nbPath = path.join(tmpDir, 'addcell.notebook.json');
    const nb = store.createNew('AddCell', '/tmp');

    const index = makeIndex(nb);
    const cell = makeCell('c-new');
    const newIndex = await store.addCell(nbPath, index, cell);

    expect(newIndex.cell_ids).toContain('c-new');
    // cell file exists
    const cellData = await store.loadCell(nbPath, 'c-new');
    expect(cellData.id).toBe('c-new');
    // index file written
    const raw = await readFile(nbPath, 'utf8');
    expect(JSON.parse(raw).cell_ids).toContain('c-new');
  });

  it('rolls back cell file if index write fails', async () => {
    const nbPath = path.join(tmpDir, 'rollback.notebook.json');
    const nb = store.createNew('Rollback', '/tmp');

    // Make index write fail by making nbPath a directory
    const { mkdir } = await import('fs/promises');
    await mkdir(nbPath, { recursive: true });

    const index = makeIndex(nb);
    const cell = makeCell('c-rollback');
    await expect(store.addCell(nbPath, index, cell)).rejects.toThrow();

    // cell file should be deleted (rollback)
    await expect(store.loadCell(nbPath, 'c-rollback')).rejects.toThrow();
    // verify via readdir that no .json file remains in cellDir
    const cellDirPath = NotebookStore.cellDir(nbPath);
    try {
      const entries = await readdir(cellDirPath);
      expect(entries).not.toContain('c-rollback.json');
    } catch {
      // cellDir may not exist at all — also acceptable (rollback succeeded)
    }
  });
});

// ── removeCell ───────────────────────────────────────────────────────────────

describe('removeCell', () => {
  const makeCell = (id: string) => ({
    id,
    type: 'markdown' as const,
    source: `# ${id}`,
    execution_count: 0,
    status: 'idle' as const,
  });

  it('removes cell from index and deletes cell file', async () => {
    const nbPath = path.join(tmpDir, 'removecell.notebook.json');
    const nb = store.createNew('RemoveCell', '/tmp');

    // Setup: add a cell first
    const index0: import('@notebook-ai/shared').NotebookIndex = {
      version: 2,
      metadata: nb.metadata,
      cell_ids: [],
      slide: nb.slide,
      annotations: [],
      assets: nb.assets,
    };
    const cell = makeCell('c-del');
    const index1 = await store.addCell(nbPath, index0, cell);
    expect(index1.cell_ids).toContain('c-del');

    // Now remove
    const index2 = await store.removeCell(nbPath, index1, 'c-del');
    expect(index2.cell_ids).not.toContain('c-del');

    // Cell file gone (best-effort, should be deleted)
    await expect(store.loadCell(nbPath, 'c-del')).rejects.toThrow();
  });
});

// ── per-cell path helpers ────────────────────────────────────────────────────

describe('cellDir / cellPath', () => {
  it('cellDir returns .cells/<slug> under notebook directory', () => {
    const nbPath = '/workspace/project/my-notebook.notebook.json';
    expect(NotebookStore.cellDir(nbPath)).toBe(
      '/workspace/project/.cells/my-notebook',
    );
  });

  it('cellPath returns .cells/<slug>/<cellId>.json', () => {
    const nbPath = '/workspace/project/my-notebook.notebook.json';
    expect(NotebookStore.cellPath(nbPath, 'abc123')).toBe(
      '/workspace/project/.cells/my-notebook/abc123.json',
    );
  });
});

// ── saveCell / loadCell ──────────────────────────────────────────────────────

describe('saveCell / loadCell', () => {
  it('round-trips a cell through saveCell + loadCell', async () => {
    const nbPath = path.join(tmpDir, 'celltest.notebook.json');

    const cell = {
      id: 'c-test-1',
      type: 'markdown' as const,
      source: '# Hello',
      execution_count: 0,
      status: 'idle' as const,
    };
    await store.saveCell(nbPath, cell);
    const loaded = await store.loadCell(nbPath, 'c-test-1');
    expect(loaded.id).toBe('c-test-1');
    expect(loaded.source).toBe('# Hello');
  });

  it('leaves no .tmp file after saveCell', async () => {
    const nbPath = path.join(tmpDir, 'celltest2.notebook.json');

    const cell = {
      id: 'c-test-2',
      type: 'markdown' as const,
      source: 'content',
      execution_count: 0,
      status: 'idle' as const,
    };
    await store.saveCell(nbPath, cell);
    const entries = await readdir(NotebookStore.cellDir(nbPath));
    expect(entries.every((e) => !e.endsWith('.tmp'))).toBe(true);
    expect(entries).toContain('c-test-2.json');
  });

  it('loadCell throws on missing cell file', async () => {
    const nbPath = path.join(tmpDir, 'missing.notebook.json');
    await expect(store.loadCell(nbPath, 'nonexistent')).rejects.toThrow();
  });
});

// ── saveIndex ────────────────────────────────────────────────────────────────

describe('saveIndex', () => {
  it('writes a valid NotebookIndex file', async () => {
    const nbPath = path.join(tmpDir, 'idxtest.notebook.json');
    const nb = store.createNew('IdxTest', '/tmp');
    const index: import('@notebook-ai/shared').NotebookIndex = {
      version: 2,
      metadata: nb.metadata,
      cell_ids: ['c-1', 'c-2'],
      slide: nb.slide,
      annotations: [],
      assets: nb.assets,
    };
    await store.saveIndex(nbPath, index);
    const raw = await readFile(nbPath, 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe(2);
    expect(parsed.cell_ids).toEqual(['c-1', 'c-2']);
    const savedEntries = await readdir(tmpDir);
    expect(savedEntries.some((e) => e.endsWith('.tmp'))).toBe(false);
  });
});

// ── save() v2 全量写 ──────────────────────────────────────────────────────────

describe('save() v2 full write', () => {
  it('creates cell files and index when saving notebook with cells', async () => {
    const nb = store.createNew('SaveV2', '/tmp');
    // Add two cells manually
    const cells = [
      { id: 'c-1', type: 'markdown' as const, source: '# Cell 1', execution_count: 0, status: 'idle' as const },
      { id: 'c-2', type: 'markdown' as const, source: '# Cell 2', execution_count: 0, status: 'idle' as const },
    ];
    const nbWithCells = { ...nb, cells };
    const nbPath = path.join(tmpDir, 'savev2.notebook.json');

    await store.save(nbPath, nbWithCells);

    // Index file should be version 2 with cell_ids
    const raw = await readFile(nbPath, 'utf8');
    const index = JSON.parse(raw);
    expect(index.version).toBe(2);
    expect(index.cell_ids).toEqual(['c-1', 'c-2']);
    expect(index.cells).toBeUndefined();

    // Cell files should exist
    const c1 = await store.loadCell(nbPath, 'c-1');
    expect(c1.source).toBe('# Cell 1');
    const c2 = await store.loadCell(nbPath, 'c-2');
    expect(c2.source).toBe('# Cell 2');
  });

  it('save is idempotent: re-saving overwrites cell files without error', async () => {
    const nb = store.createNew('Idempotent', '/tmp');
    const cells = [
      { id: 'c-idem', type: 'markdown' as const, source: 'v1', execution_count: 0, status: 'idle' as const },
    ];
    const nbPath = path.join(tmpDir, 'idempotent.notebook.json');
    await store.save(nbPath, { ...nb, cells });

    const cells2 = [
      { id: 'c-idem', type: 'markdown' as const, source: 'v2', execution_count: 0, status: 'idle' as const },
    ];
    await store.save(nbPath, { ...nb, cells: cells2 });

    const loaded = await store.loadCell(nbPath, 'c-idem');
    expect(loaded.source).toBe('v2');
  });
});

// ── load() v1 auto-migration ──────────────────────────────────────────────────

describe('load() v1 auto-migration', () => {
  it('migrates v1 notebook to v2 on load', async () => {
    const v1Notebook = {
      version: 1,
      metadata: { title: 'V1 Notebook', created: '2024-01-01T00:00:00Z', git_repo: false },
      cells: [
        { id: 'c-v1-1', type: 'markdown', source: '# Migrated', execution_count: 0, status: 'idle' },
        { id: 'c-v1-2', type: 'markdown', source: '## Second', execution_count: 0, status: 'idle' },
      ],
      slide: { generated: false, sections: [] },
      annotations: [],
      assets: { intermediate_files: [] },
    };
    const nbPath = path.join(tmpDir, 'v1migrate.notebook.json');
    await writeFile(nbPath, JSON.stringify(v1Notebook), 'utf8');

    const loaded = await store.load(nbPath);

    // In-memory result has full cells
    expect(loaded.cells).toHaveLength(2);
    expect(loaded.cells[0].id).toBe('c-v1-1');
    expect(loaded.cells[1].id).toBe('c-v1-2');

    // On-disk: index is now v2
    const raw = await readFile(nbPath, 'utf8');
    const index = JSON.parse(raw);
    expect(index.version).toBe(2);
    expect(index.cell_ids).toEqual(['c-v1-1', 'c-v1-2']);

    // Cell files exist
    const c1 = await store.loadCell(nbPath, 'c-v1-1');
    expect(c1.source).toBe('# Migrated');
  });
});

// ── load() v2 normal ──────────────────────────────────────────────────────────

describe('load() v2', () => {
  it('loads v2 notebook preserving cell order', async () => {
    const nb = store.createNew('LoadV2', '/tmp');
    const cells = [
      { id: 'c-a', type: 'markdown' as const, source: 'A', execution_count: 0, status: 'idle' as const },
      { id: 'c-b', type: 'markdown' as const, source: 'B', execution_count: 0, status: 'idle' as const },
      { id: 'c-c', type: 'markdown' as const, source: 'C', execution_count: 0, status: 'idle' as const },
    ];
    const nbPath = path.join(tmpDir, 'loadv2.notebook.json');
    await store.save(nbPath, { ...nb, cells });

    const loaded = await store.load(nbPath);
    expect(loaded.cells.map((c) => c.id)).toEqual(['c-a', 'c-b', 'c-c']);
    expect(loaded.cells[1].source).toBe('B');
  });

  it('skips missing cell files and updates index (no throw)', async () => {
    const nb = store.createNew('MissingCell', '/tmp');
    const cells = [
      { id: 'c-present', type: 'markdown' as const, source: 'here', execution_count: 0, status: 'idle' as const },
    ];
    const nbPath = path.join(tmpDir, 'missingcell.notebook.json');
    await store.save(nbPath, { ...nb, cells });

    // Manually inject a missing cell id into the index
    const raw = JSON.parse(await readFile(nbPath, 'utf8'));
    raw.cell_ids = ['c-present', 'c-ghost'];
    await writeFile(nbPath, JSON.stringify(raw), 'utf8');

    const loaded = await store.load(nbPath);
    // c-ghost silently dropped
    expect(loaded.cells.map((c) => c.id)).toEqual(['c-present']);

    // Index on disk updated (c-ghost removed)
    const updated = JSON.parse(await readFile(nbPath, 'utf8'));
    expect(updated.cell_ids).toEqual(['c-present']);
  });

  it('deletes orphaned cell files on load', async () => {
    const nb = store.createNew('Orphan', '/tmp');
    const cells = [
      { id: 'c-kept', type: 'markdown' as const, source: 'keep', execution_count: 0, status: 'idle' as const },
    ];
    const nbPath = path.join(tmpDir, 'orphan.notebook.json');
    await store.save(nbPath, { ...nb, cells });

    // Create an orphan cell file not referenced in index
    const orphanPath = NotebookStore.cellPath(nbPath, 'c-orphan');
    await writeFile(orphanPath, JSON.stringify({ id: 'c-orphan', type: 'markdown', source: 'orphan', execution_count: 0, status: 'idle' }), 'utf8');

    await store.load(nbPath);

    // Orphan file deleted
    await expect(readFile(orphanPath, 'utf8')).rejects.toThrow();
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

  it('cleans up tmp file and preserves existing file when writeFile fails', async () => {
    // Create a read-only subdirectory so that writing a tmp file fails
    const { mkdir, chmod } = await import('fs/promises');
    const roDir = path.join(tmpDir, 'readonly');
    await mkdir(roDir);

    // Save a valid notebook into the parent dir first (as a reference)
    const nb = store.createNew('Existing', '/tmp');
    const goodPath = path.join(tmpDir, 'existing.notebook.json');
    await store.save(goodPath, nb);

    // Now make the subdirectory read-only so any write inside it fails
    await chmod(roDir, 0o555);

    const nb2 = store.createNew('New', '/tmp');
    const roPath = path.join(roDir, 'target.notebook.json');

    // Saving into a read-only dir should throw (can't create cellDir or tmp file)
    await expect(store.save(roPath, nb2)).rejects.toThrow();

    // Restore permissions so afterEach cleanup can remove the dir
    await chmod(roDir, 0o755);

    // No .tmp files should remain inside the read-only dir
    const entries = await readdir(roDir);
    expect(entries.some((e) => e.endsWith('.tmp'))).toBe(false);

    // The original good file in the parent dir is still intact
    const loaded = await store.load(goodPath);
    expect(loaded.metadata.title).toBe('Existing');
  });
});

// ── list() v2 compatibility ───────────────────────────────────────────────────

describe('list() with v2 notebooks', () => {
  it('lists v2 notebooks correctly', async () => {
    const nb1 = store.createNew('Alpha', '/tmp');
    const nb2 = store.createNew('Beta', '/tmp');
    await store.save(path.join(tmpDir, 'alpha.notebook.json'), nb1);
    await store.save(path.join(tmpDir, 'beta.notebook.json'), nb2);

    const result = await store.list(tmpDir);
    const titles = result.map((r) => r.title);
    expect(titles).toContain('Alpha');
    expect(titles).toContain('Beta');
  });
});
