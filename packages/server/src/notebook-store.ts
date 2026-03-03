import { readFile, writeFile, readdir } from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import {
  NotebookSchema,
  type Notebook,
} from '@notebook-ai/shared';

export class NotebookStore {
  /**
   * Validates and writes a notebook to disk as JSON.
   */
  async save(filePath: string, notebook: Notebook): Promise<void> {
    const validated = NotebookSchema.parse({
      ...notebook,
      metadata: {
        ...notebook.metadata,
        updated: new Date().toISOString(),
      },
    });

    try {
      await writeFile(filePath, JSON.stringify(validated, null, 2) + '\n', 'utf8');
    } catch (err) {
      throw new Error(`Failed to save notebook to "${filePath}": ${String(err)}`);
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
