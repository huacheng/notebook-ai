/**
 * Ensures project creation creates .deliverables/ without hardcoded 'app' subdir.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const projectsSrc = () =>
  fs.readFileSync(path.resolve(__dirname, '../routes/projects.ts'), 'utf-8');

describe('Project .deliverables directory creation', () => {
  it('should create .deliverables without hardcoded app subdir', () => {
    const src = projectsSrc();
    // Should NOT have .deliverables/app in mkdir calls
    expect(src).not.toMatch(/mkdir\([^)]*['"]\.deliverables['"],\s*['"]app['"]/);
    // Should still create .deliverables
    expect(src).toMatch(/mkdir\([^)]*['"]\.deliverables['"]/);
  });
});
