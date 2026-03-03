import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

/**
 * Verify that the 'Slice' feature has been renamed to 'Slide'.
 * This is a regression test to ensure the naming is consistent.
 */
describe('Slice → Slide rename', () => {
  it('should have generateSlide function (not generateSlice)', () => {
    const filePath = path.resolve(__dirname, '../slide-generator.ts');
    expect(existsSync(filePath)).toBe(true);
    const src = readFileSync(filePath, 'utf-8');
    expect(src).toContain('export function generateSlide');
    expect(src).not.toContain('export function generateSlice');
  });

  it('should use SlideSchema in types (not SliceSchema)', async () => {
    const { SlideSchema, SlideSectionSchema } = await import('@notebook-ai/shared');
    expect(SlideSchema).toBeDefined();
    expect(SlideSectionSchema).toBeDefined();
  });

  it('notebooks route should import generateSlide', () => {
    const src = readFileSync(path.resolve(__dirname, '../routes/notebooks.ts'), 'utf-8');
    expect(src).toContain("import { generateSlide }");
    expect(src).not.toContain("import { generateSlice }");
  });
});
