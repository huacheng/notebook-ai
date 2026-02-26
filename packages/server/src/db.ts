import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import { mkdirSync } from 'fs';

// ── Types ────────────────────────────────────────────────────────────────────

export interface NotebookRow {
  id: string;
  user_id: string | null;
  title: string;
  slug: string;
  workspace_dir: string;
  notebook_path: string;
  project_id: string | null;
  agent: string;
  status: 'active' | 'archived';
  cell_count: number;
  created_at: string;
  updated_at: string;
}

export interface SessionRow {
  id: string;
  notebook_id: string;
  tmux_session: string;
  jsonl_path: string | null;
  cwd: string;
  status: 'active' | 'closed';
  created_at: string;
  closed_at: string | null;
}

export interface ProjectRow {
  id: string;
  title: string;
  slug: string;
  path: string;
  status: 'active' | 'archived';
  notebook_count: number;
  created_at: string;
  updated_at: string;
}

// ── Database ─────────────────────────────────────────────────────────────────

const DB_DIR = path.join(os.homedir(), '.notebook-ai');
const DB_PATH = path.join(DB_DIR, 'notebook.db');

export class NotebookDb {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const resolvedPath = dbPath ?? DB_PATH;
    mkdirSync(path.dirname(resolvedPath), { recursive: true });
    this.db = new Database(resolvedPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
  }

  // ── Migrations ───────────────────────────────────────────────────────────

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS notebooks (
        id            TEXT PRIMARY KEY,
        user_id       TEXT,
        title         TEXT NOT NULL,
        slug          TEXT NOT NULL,
        workspace_dir TEXT NOT NULL,
        notebook_path TEXT NOT NULL,
        status        TEXT DEFAULT 'active',
        cell_count    INTEGER DEFAULT 0,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id              TEXT PRIMARY KEY,
        notebook_id     TEXT NOT NULL REFERENCES notebooks(id),
        tmux_session    TEXT NOT NULL,
        jsonl_path      TEXT,
        cwd             TEXT NOT NULL,
        status          TEXT DEFAULT 'active',
        created_at      TEXT NOT NULL,
        closed_at       TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_notebooks_user_status
        ON notebooks(user_id, status);
      CREATE INDEX IF NOT EXISTS idx_notebooks_updated
        ON notebooks(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_sessions_notebook
        ON sessions(notebook_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_status
        ON sessions(status);

      CREATE TABLE IF NOT EXISTS file_annotations (
        session_id  TEXT NOT NULL,
        file_path   TEXT NOT NULL,
        content     TEXT NOT NULL DEFAULT '{}',
        updated_at  INTEGER NOT NULL,
        PRIMARY KEY (session_id, file_path)
      );
      CREATE INDEX IF NOT EXISTS idx_fa_updated_at ON file_annotations(updated_at);

      CREATE TABLE IF NOT EXISTS projects (
        id              TEXT PRIMARY KEY,
        title           TEXT NOT NULL,
        slug            TEXT NOT NULL,
        path            TEXT NOT NULL UNIQUE,
        status          TEXT DEFAULT 'active',
        notebook_count  INTEGER DEFAULT 0,
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
      CREATE INDEX IF NOT EXISTS idx_projects_updated ON projects(updated_at DESC);
    `);

    // Migration: add project_id to notebooks
    try {
      this.db.exec(`ALTER TABLE notebooks ADD COLUMN project_id TEXT REFERENCES projects(id)`);
    } catch { /* column already exists */ }

    // Migration: add agent to notebooks
    try {
      this.db.exec(`ALTER TABLE notebooks ADD COLUMN agent TEXT DEFAULT 'claude'`);
    } catch { /* column already exists */ }
  }

  // ── Notebook CRUD ────────────────────────────────────────────────────────

  createNotebook(notebook: Omit<NotebookRow, 'cell_count' | 'project_id' | 'agent'> & { project_id?: string | null; agent?: string }): NotebookRow {
    const row = { ...notebook, project_id: notebook.project_id ?? null, agent: notebook.agent ?? 'claude' };
    const stmt = this.db.prepare(`
      INSERT INTO notebooks (id, user_id, title, slug, workspace_dir, notebook_path, project_id, agent, status, cell_count, created_at, updated_at)
      VALUES (@id, @user_id, @title, @slug, @workspace_dir, @notebook_path, @project_id, @agent, @status, 0, @created_at, @updated_at)
    `);
    stmt.run(row);
    return this.getNotebook(notebook.id)!;
  }

  getNotebook(id: string): NotebookRow | undefined {
    return this.db.prepare('SELECT * FROM notebooks WHERE id = ?').get(id) as NotebookRow | undefined;
  }

  listNotebooks(userId?: string | null): NotebookRow[] {
    if (userId) {
      return this.db.prepare(
        'SELECT * FROM notebooks WHERE user_id = ? AND status = ? ORDER BY created_at DESC'
      ).all(userId, 'active') as NotebookRow[];
    }
    return this.db.prepare(
      'SELECT * FROM notebooks WHERE status = ? ORDER BY created_at DESC'
    ).all('active') as NotebookRow[];
  }

  updateNotebook(id: string, updates: Partial<Pick<NotebookRow, 'title' | 'slug' | 'notebook_path' | 'status' | 'cell_count' | 'updated_at'>>): NotebookRow | undefined {
    const ALLOWED = new Set(['title', 'slug', 'notebook_path', 'status', 'cell_count', 'updated_at']);
    const fields: string[] = [];
    const values: Record<string, unknown> = { id };

    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined && ALLOWED.has(key)) {
        fields.push(`${key} = @${key}`);
        values[key] = value;
      }
    }
    if (fields.length === 0) return this.getNotebook(id);

    // Always update updated_at
    if (!updates.updated_at) {
      fields.push('updated_at = @updated_at');
      values['updated_at'] = new Date().toISOString();
    }

    this.db.prepare(`UPDATE notebooks SET ${fields.join(', ')} WHERE id = @id`).run(values);
    return this.getNotebook(id);
  }

  getNotebookByPath(notebookPath: string): NotebookRow | undefined {
    return this.db.prepare('SELECT * FROM notebooks WHERE notebook_path = ? AND status = ?').get(notebookPath, 'active') as NotebookRow | undefined;
  }

  deleteNotebook(id: string): void {
    // Hard-delete: remove sessions first (no ON DELETE CASCADE), then the notebook.
    this.db.prepare('DELETE FROM sessions WHERE notebook_id = ?').run(id);
    this.db.prepare('DELETE FROM notebooks WHERE id = ?').run(id);
  }

  // ── Session CRUD ─────────────────────────────────────────────────────────

  createSessionRecord(session: Omit<SessionRow, 'closed_at'>): SessionRow {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO sessions (id, notebook_id, tmux_session, jsonl_path, cwd, status, created_at)
      VALUES (@id, @notebook_id, @tmux_session, @jsonl_path, @cwd, @status, @created_at)
    `);
    stmt.run(session);
    return this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(session.id) as SessionRow;
  }

  getActiveSession(notebookId: string): SessionRow | undefined {
    return this.db.prepare(
      'SELECT * FROM sessions WHERE notebook_id = ? AND status = ? ORDER BY created_at DESC LIMIT 1'
    ).get(notebookId, 'active') as SessionRow | undefined;
  }

  closeSessionRecord(id: string): void {
    this.db.prepare(
      'UPDATE sessions SET status = ?, closed_at = ? WHERE id = ?'
    ).run('closed', new Date().toISOString(), id);
  }

  // ── Project CRUD ─────────────────────────────────────────────────────────

  createProject(project: Omit<ProjectRow, 'notebook_count'>): ProjectRow {
    this.db.prepare(`INSERT INTO projects (id, title, slug, path, status, notebook_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?)`).run(
      project.id, project.title, project.slug, project.path,
      project.status, project.created_at, project.updated_at
    );
    return { ...project, notebook_count: 0 };
  }

  listProjects(): ProjectRow[] {
    return this.db.prepare(`
      SELECT p.*, COALESCE(nb_cnt, 0) AS notebook_count
      FROM projects p
      LEFT JOIN (SELECT project_id, COUNT(*) AS nb_cnt FROM notebooks WHERE status = 'active' GROUP BY project_id) n
        ON n.project_id = p.id
      WHERE p.status = 'active'
      ORDER BY p.updated_at DESC
    `).all() as ProjectRow[];
  }

  getProject(id: string): ProjectRow | undefined {
    return this.db.prepare(`
      SELECT p.*, COALESCE(nb_cnt, 0) AS notebook_count
      FROM projects p
      LEFT JOIN (SELECT project_id, COUNT(*) AS nb_cnt FROM notebooks WHERE status = 'active' GROUP BY project_id) n
        ON n.project_id = p.id
      WHERE p.id = ?
    `).get(id) as ProjectRow | undefined;
  }

  updateProject(id: string, updates: Partial<Pick<ProjectRow, 'title' | 'status' | 'notebook_count'>>): ProjectRow | undefined {
    const ALLOWED = new Set(['title', 'status', 'notebook_count']);
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const [k, v] of Object.entries(updates)) {
      if (!ALLOWED.has(k)) continue;
      fields.push(`${k} = ?`);
      values.push(v);
    }
    fields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);
    this.db.prepare(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return this.getProject(id);
  }

  deleteProject(id: string): void {
    // Cascade: remove associated notebooks (and their sessions) first
    const notebooks = this.db.prepare(
      `SELECT id FROM notebooks WHERE project_id = ?`
    ).all(id) as { id: string }[];
    for (const nb of notebooks) {
      this.deleteNotebook(nb.id);
    }
    this.db.prepare(`DELETE FROM projects WHERE id = ?`).run(id);
  }

  listProjectNotebooks(projectId: string): { id: string; workspace_dir: string }[] {
    return this.db.prepare(
      `SELECT id, workspace_dir FROM notebooks WHERE project_id = ?`
    ).all(projectId) as { id: string; workspace_dir: string }[];
  }

  // ── File Annotations ─────────────────────────────────────────────────────

  upsertFileAnnotations(sessionId: string, filePath: string, content: string, updatedAt: number): void {
    this.db.prepare(`
      INSERT INTO file_annotations (session_id, file_path, content, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(session_id, file_path) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at
    `).run(sessionId, filePath, content, updatedAt);
  }

  getFileAnnotations(sessionId: string, filePath: string): { content: string; updated_at: number } | null {
    const row = this.db.prepare(
      'SELECT content, updated_at FROM file_annotations WHERE session_id = ? AND file_path = ?'
    ).get(sessionId, filePath) as { content: string; updated_at: number } | undefined;
    return row ?? null;
  }

  cleanupOldFileAnnotations(maxAgeDays = 7): void {
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    this.db.prepare('DELETE FROM file_annotations WHERE updated_at < ?').run(cutoff);
  }

  // ── Utility ──────────────────────────────────────────────────────────────

  close(): void {
    this.db.close();
  }
}
