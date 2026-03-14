import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Verify that rename operations are DB-only (no filesystem renames).
 * ASCII slug architecture: slug never changes, only title updates.
 */

const notebooksRouteSrc = fs.readFileSync(
  path.join(__dirname, '../routes/notebooks.ts'), 'utf-8'
);

const projectsRouteSrc = fs.readFileSync(
  path.join(__dirname, '../routes/projects.ts'), 'utf-8'
);

describe('Rename is DB-only (no filesystem rename)', () => {
  it('standalone notebook PATCH should not call titleToSlug', () => {
    // Extract the PATCH /:notebookId handler
    const patchBlock = notebooksRouteSrc.match(
      /router\.patch\('\/:notebookId'[\s\S]*?(?=router\.(get|post|put|delete|patch)\(|$)/
    );
    expect(patchBlock).toBeTruthy();
    const block = patchBlock![0];
    // Should NOT derive a new slug from title
    expect(block).not.toMatch(/titleToSlug/);
    // Should NOT rename files on disk
    expect(block).not.toMatch(/await rename\(/);
  });

  it('project rename PATCH should not rename directory', () => {
    // Extract the PATCH /:projectId handler (project rename)
    const patchBlock = projectsRouteSrc.match(
      /\/\/ Rename project[\s\S]*?router\.patch\('\/:projectId'[\s\S]*?(?=\n  \/\/ List notebooks)/
    );
    expect(patchBlock).toBeTruthy();
    const block = patchBlock![0];
    // Should NOT call titleToSlug or fsRename
    expect(block).not.toMatch(/titleToSlug/);
    expect(block).not.toMatch(/fsRename/);
  });

  it('project notebook rename should not move worktree', () => {
    // Extract the PATCH /:projectId/notebooks/rename handler
    const patchBlock = projectsRouteSrc.match(
      /router\.patch\('\/:projectId\/notebooks\/rename'[\s\S]*?(?=\n  \/\/ Create notebook)/
    );
    expect(patchBlock).toBeTruthy();
    const block = patchBlock![0];
    // Should NOT call titleToSlug, moveWorktree, or renameBranch
    expect(block).not.toMatch(/titleToSlug/);
    expect(block).not.toMatch(/moveWorktree/);
    expect(block).not.toMatch(/renameBranch/);
  });
});
