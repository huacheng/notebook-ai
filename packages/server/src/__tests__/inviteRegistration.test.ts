import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';

/**
 * TDD tests for invitation-code-based registration system.
 *
 * Requirements:
 * 1. Only users with valid invitation codes can register
 * 2. Invitation codes are single-use or limited-use
 * 3. Users table stores registered users with hashed passwords
 * 4. Registration endpoint validates invitation code before creating user
 */

// ── Part 1: Database Schema Tests ────────────────────────────────────────────

describe('Invitation Registration - Database Schema', () => {
  const dbPath = path.join(os.tmpdir(), `nb-invite-test-${Date.now()}.db`);
  let db: Database.Database;

  beforeAll(async () => {
    // Import and instantiate NotebookDb to trigger migrations
    const { NotebookDb } = await import('../db');
    const nbDb = new NotebookDb(dbPath);
    nbDb.close();
    db = new Database(dbPath);
  });

  afterAll(() => {
    db.close();
  });

  it('should have users table with required columns', () => {
    const columns = db.prepare(`PRAGMA table_info(users)`).all() as { name: string }[];
    const colNames = columns.map(c => c.name);

    expect(colNames).toContain('id');
    expect(colNames).toContain('username');
    expect(colNames).toContain('password_hash');
    expect(colNames).toContain('created_at');
    expect(colNames).toContain('status');
  });

  it('should have invite_codes table with required columns', () => {
    const columns = db.prepare(`PRAGMA table_info(invite_codes)`).all() as { name: string }[];
    const colNames = columns.map(c => c.name);

    expect(colNames).toContain('code');
    expect(colNames).toContain('max_uses');
    expect(colNames).toContain('used_count');
    expect(colNames).toContain('created_by');
    expect(colNames).toContain('created_at');
    expect(colNames).toContain('expires_at');
  });

  it('should enforce unique username constraint', () => {
    // Insert a test user
    db.prepare(`INSERT INTO users (id, username, password_hash, created_at, status) VALUES (?, ?, ?, ?, ?)`)
      .run('test-1', 'alice', 'hash1', new Date().toISOString(), 'active');

    // Attempt to insert duplicate username should fail
    expect(() => {
      db.prepare(`INSERT INTO users (id, username, password_hash, created_at, status) VALUES (?, ?, ?, ?, ?)`)
        .run('test-2', 'alice', 'hash2', new Date().toISOString(), 'active');
    }).toThrow();
  });

  it('should enforce unique invite_code constraint', () => {
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO invite_codes (code, max_uses, used_count, created_by, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run('INVITE123', 1, 0, 'admin', now);

    expect(() => {
      db.prepare(`INSERT INTO invite_codes (code, max_uses, used_count, created_by, created_at) VALUES (?, ?, ?, ?, ?)`)
        .run('INVITE123', 1, 0, 'admin', now);
    }).toThrow();
  });
});

// ── Part 2: Auth Module Tests ────────────────────────────────────────────────

describe('Invitation Registration - Auth Module', () => {
  const authPath = path.resolve(__dirname, '../auth.ts');
  let src: string;

  beforeAll(() => {
    src = readFileSync(authPath, 'utf-8');
  });

  it('should export handleRegister function', () => {
    // async function is also valid
    expect(src).toMatch(/export\s+(async\s+)?function\s+handleRegister/);
  });

  it('handleRegister should validate invitation code', () => {
    const start = src.indexOf('function handleRegister');
    const end = src.indexOf('\nfunction ', start + 1);
    const block = src.slice(start, end > 0 ? end : start + 2000);

    expect(block).toMatch(/invite.*code/i);
  });

  it('handleRegister should hash password before storing', () => {
    // Should call hashPassword function (defined separately using scrypt)
    expect(src).toMatch(/hashPassword\s*\(/);
    // And hashPassword should use scrypt
    expect(src).toMatch(/crypto\.scrypt/);
  });

  it('handleRegister should return 400 for invalid invitation code', () => {
    const start = src.indexOf('function handleRegister');
    const end = src.indexOf('\nfunction ', start + 1);
    const block = src.slice(start, end > 0 ? end : start + 2000);

    expect(block).toContain('400');
  });

  it('handleRegister should return 409 for duplicate username', () => {
    const start = src.indexOf('function handleRegister');
    const end = src.indexOf('\nfunction ', start + 1);
    const block = src.slice(start, end > 0 ? end : start + 2000);

    expect(block).toContain('409');
  });

  it('authMiddleware bypass list should include /api/auth/register', () => {
    const start = src.indexOf('function authMiddleware');
    const end = src.indexOf('\n}', start + 50);
    const block = src.slice(start, end > 0 ? end + 1 : start + 1500);

    expect(block).toContain('/api/auth/register');
  });
});

// ── Part 3: Route Registration Tests ─────────────────────────────────────────

describe('Invitation Registration - Route Setup', () => {
  const routePath = path.resolve(__dirname, '../routes/auth.ts');

  it('should register POST /api/auth/register route', () => {
    const src = readFileSync(routePath, 'utf-8');
    // Route is registered in routes/auth.ts as router.post('/register', ...)
    expect(src).toMatch(/router\.post\s*\(\s*['"`]\/register/);
    expect(src).toContain('handleRegister');
  });
});

// ── Part 4: Invite Code Validation Logic Tests ───────────────────────────────

describe('Invitation Registration - Invite Code Validation', () => {
  const authPath = path.resolve(__dirname, '../auth.ts');
  let src: string;

  beforeAll(() => {
    src = readFileSync(authPath, 'utf-8');
  });

  it('should check invite code exists in database', () => {
    expect(src).toMatch(/SELECT.*FROM\s+invite_codes/i);
  });

  it('should check invite code is not expired', () => {
    expect(src).toMatch(/expires_at|expired/i);
  });

  it('should check invite code usage count', () => {
    expect(src).toMatch(/used_count.*max_uses|max_uses.*used_count/i);
  });

  it('should increment used_count after successful registration', () => {
    expect(src).toMatch(/UPDATE\s+invite_codes.*used_count/i);
  });
});
