import { readFile, writeFile, rename, unlink, readdir, mkdir } from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import {
  NotebookSchema,
  NotebookIndexSchema,
  CellSchema,
  type Notebook,
  type NotebookIndex,
  type Cell,
} from '@notebook-ai/shared';

export class NotebookStore {
  // ── Path helpers ─────────────────────────────────────────────────────────

  static cellDir(notebookPath: string): string {
    return path.join(
      path.dirname(notebookPath),
      '.cells',
      path.basename(notebookPath, '.notebook.json'),
    );
  }

  static cellPath(notebookPath: string, cellId: string): string {
    return path.join(NotebookStore.cellDir(notebookPath), `${cellId}.json`);
  }

  // ── Per-cell atomic write ─────────────────────────────────────────────────

  async saveCell(notebookPath: string, cell: Cell): Promise<void> {
    const validated = CellSchema.parse(cell);
    const filePath = NotebookStore.cellPath(notebookPath, cell.id);
    await mkdir(path.dirname(filePath), { recursive: true });
    const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      await writeFile(tmpPath, JSON.stringify(validated, null, 2) + '\n', 'utf8');
    } catch (err) {
      try { await unlink(tmpPath); } catch { /* ignore */ }
      throw new Error(`Failed to write cell tmp "${tmpPath}": ${String(err)}`);
    }
    try {
      await rename(tmpPath, filePath);
    } catch (err) {
      try { await unlink(tmpPath); } catch { /* ignore */ }
      throw new Error(`Failed to rename cell tmp to "${filePath}": ${String(err)}`);
    }
  }

  async loadCell(notebookPath: string, cellId: string): Promise<Cell> {
    const filePath = NotebookStore.cellPath(notebookPath, cellId);
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf8');
    } catch (err) {
      throw new Error(`Failed to read cell "${cellId}" from "${filePath}": ${String(err)}`);
    }
    const result = CellSchema.safeParse(JSON.parse(raw));
    if (!result.success) {
      throw new Error(`Cell "${cellId}" failed schema validation: ${result.error.message}`);
    }
    return result.data;
  }

  async saveIndex(notebookPath: string, index: NotebookIndex): Promise<void> {
    const validated = NotebookIndexSchema.parse(index);
    const tmpPath = `${notebookPath}.${process.pid}.${Date.now()}.tmp`;
    try {
      await writeFile(tmpPath, JSON.stringify(validated, null, 2) + '\n', 'utf8');
    } catch (err) {
      try { await unlink(tmpPath); } catch { /* ignore */ }
      throw new Error(`Failed to write index tmp "${tmpPath}": ${String(err)}`);
    }
    try {
      await rename(tmpPath, notebookPath);
    } catch (err) {
      try { await unlink(tmpPath); } catch { /* ignore */ }
      throw new Error(`Failed to rename index tmp to "${notebookPath}": ${String(err)}`);
    }
  }

  async addCell(
    notebookPath: string,
    index: NotebookIndex,
    cell: Cell,
  ): Promise<NotebookIndex> {
    // Step ①: write cell file (atomic)
    await this.saveCell(notebookPath, cell);

    // Step ②: update index
    const newIndex: NotebookIndex = {
      ...index,
      cell_ids: [...index.cell_ids, cell.id],
    };
    try {
      await this.saveIndex(notebookPath, newIndex);
    } catch (err) {
      try { await unlink(NotebookStore.cellPath(notebookPath, cell.id)); } catch { /* ignore */ }
      throw new Error(`Failed to update index for addCell; rolled back cell file: ${String(err)}`);
    }
    return newIndex;
  }

  async removeCell(
    notebookPath: string,
    index: NotebookIndex,
    cellId: string,
  ): Promise<NotebookIndex> {
    // Step ①: update index (remove id) — if this fails, cell file is preserved
    const newIndex: NotebookIndex = {
      ...index,
      cell_ids: index.cell_ids.filter((id) => id !== cellId),
    };
    await this.saveIndex(notebookPath, newIndex);

    // Step ②: unlink cell file (best-effort)
    try {
      await unlink(NotebookStore.cellPath(notebookPath, cellId));
    } catch (err) {
      console.warn(`[NotebookStore] Failed to delete cell file for "${cellId}": ${String(err)}`);
    }
    return newIndex;
  }

  /**
   * Validates and writes a notebook to disk as JSON.
   * Uses atomic write-then-rename pattern to ensure data integrity.
   */
  async save(filePath: string, notebook: Notebook): Promise<void> {
    const validated = NotebookSchema.parse({
      ...notebook,
      metadata: {
        ...notebook.metadata,
        updated: new Date().toISOString(),
      },
    });

    const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      await writeFile(tmpPath, JSON.stringify(validated, null, 2) + '\n', 'utf8');
    } catch (err) {
      try { await unlink(tmpPath); } catch { /* ignore */ }
      throw new Error(`Failed to write notebook tmp file "${tmpPath}": ${String(err)}`);
    }
    try {
      await rename(tmpPath, filePath);
    } catch (err) {
      try { await unlink(tmpPath); } catch { /* ignore */ }
      throw new Error(`Failed to rename "${tmpPath}" to "${filePath}": ${String(err)}`);
    }
  }

  /**
   * Reads and validates a notebook from disk.
   */
  async load(filePath: string): Promise<Notebook> {
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf8');
    } catch (err) {
      throw new Error(`Failed to read notebook from "${filePath}": ${String(err)}`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(`Failed to parse notebook JSON at "${filePath}": ${String(err)}`);
    }

    const result = NotebookSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(
        `Notebook at "${filePath}" failed schema validation: ${result.error.message}`,
      );
    }

    return result.data;
  }

  /**
   * Lists all .notebook.json files in the given directory (non-recursive).
   * Returns name, absolute path, and title from metadata.
   */
  async list(
    directory: string,
  ): Promise<Array<{ name: string; path: string; title: string }>> {
    let entries: string[];
    try {
      entries = await readdir(directory);
    } catch (err) {
      throw new Error(`Failed to read directory "${directory}": ${String(err)}`);
    }

    const notebookFiles = entries.filter((e) => e.endsWith('.notebook.json'));

    const results: Array<{ name: string; path: string; title: string }> = [];

    await Promise.all(
      notebookFiles.map(async (filename) => {
        const fullPath = path.join(directory, filename);
        try {
          const nb = await this.load(fullPath);
          results.push({
            name: filename,
            path: fullPath,
            title: nb.metadata.title,
          });
        } catch {
          // Skip files that cannot be parsed.
        }
      }),
    );

    // Sort alphabetically by name for deterministic ordering.
    results.sort((a, b) => a.name.localeCompare(b.name));

    return results;
  }

  /**
   * Creates a new in-memory notebook with the given title and cwd.
   */
  createNew(title: string, cwd: string): Notebook {
    const now = new Date().toISOString();
    return NotebookSchema.parse({
      version: 1,
      metadata: {
        title,
        created: now,
        updated: now,
        cwd,
        git_repo: false,
      },
      cells: [],
      slide: { generated: false, sections: [] },
      annotations: [],
      assets: { intermediate_files: [] },
    });
  }

  /**
   * Derives a safe filename from a notebook title.
   * Falls back to a random UUID fragment if the title is empty after sanitisation.
   */
  static titleToFilename(title: string): string {
    const sanitised = title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    const base = sanitised.length > 0 ? sanitised : crypto.randomUUID().slice(0, 8);
    return `${base}.notebook.json`;
  }
}
