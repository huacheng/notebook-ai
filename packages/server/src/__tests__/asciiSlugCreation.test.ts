import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Verify that notebook/project creation uses ASCII-only slugs (generateSlug)
 * instead of title-derived slugs (titleToSlug) for filesystem paths.
 */

const notebooksRouteSrc = fs.readFileSync(
  path.join(__dirname, '../routes/notebooks.ts'), 'utf-8'
);

const projectsRouteSrc = fs.readFileSync(
  path.join(__dirname, '../routes/projects.ts'), 'utf-8'
);

describe('ASCII slug creation', () => {
  it('standalone notebook creation should use generateSlug', () => {
    // The POST /create handler should call generateSlug('nb') not titleToSlug
    const createBlock = notebooksRouteSrc.match(
      /router\.post\('\/create'[\s\S]*?res\.status\(201\)/
    );
    expect(createBlock).toBeTruthy();
    const block = createBlock![0];
    expect(block).toContain("generateSlug('nb')");
    expect(block).not.toMatch(/titleToSlug\(title/);
  });

  it('project creation should use generateSlug', () => {
    // The POST / handler should call generateSlug('proj') not titleToSlug
    const createBlock = projectsRouteSrc.match(
      /router\.post\('\/'[\s\S]*?res\.json\(project\)/
    );
    expect(createBlock).toBeTruthy();
    const block = createBlock![0];
    expect(block).toContain("generateSlug('proj')");
    expect(block).not.toMatch(/titleToSlug\(title/);
  });

  it('project notebook creation should use generateSlug', () => {
    // POST /:projectId/notebooks should call generateSlug('nb')
    const createBlock = projectsRouteSrc.match(
      /router\.post\('\/:projectId\/notebooks'[\s\S]*?res\.json\(\{[\s\S]*?notebookId/
    );
    expect(createBlock).toBeTruthy();
    const block = createBlock![0];
    expect(block).toContain("generateSlug('nb')");
    expect(block).not.toMatch(/titleToSlug\(title/);
  });
});
