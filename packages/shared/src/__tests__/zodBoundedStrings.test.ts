import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const src = readFileSync(
  path.resolve(__dirname, '../types.ts'),
  'utf-8',
);

/**
 * P1-5: Unbounded z.string() fields that carry large payloads (base64 images,
 * file content, annotation HTML) must have .max() constraints.
 */
describe('Zod schema bounded strings (P1-5)', () => {
  // PromptImageSchema.data — base64 image, cap at 20 MB base64 (~15 MB raw)
  it('PromptImageSchema.data should have .max() constraint', () => {
    const schemaStart = src.indexOf('PromptImageSchema = z.object');
    const schemaEnd = src.indexOf('});', schemaStart);
    const block = src.slice(schemaStart, schemaEnd);
    expect(block).toContain('data: z.string().max(');
  });

  // FileSaveSchema.content — file save content, cap at 10 MB
  it('FileSaveSchema.content should have .max() constraint', () => {
    const schemaStart = src.indexOf('FileSaveSchema = z.object');
    const schemaEnd = src.indexOf('});', schemaStart);
    const block = src.slice(schemaStart, schemaEnd);
    expect(block).toContain('content: z.string().max(');
  });

  // AnnotationSyncSchema.content — annotation HTML, cap at 1 MB
  it('AnnotationSyncSchema.content should have .max() constraint', () => {
    const schemaStart = src.indexOf('AnnotationSyncSchema = z.object');
    const schemaEnd = src.indexOf('});', schemaStart);
    const block = src.slice(schemaStart, schemaEnd);
    expect(block).toContain('content: z.string().max(');
  });

  // UpdateCellSourceSchema.source — cell source code, cap at 1 MB
  it('UpdateCellSourceSchema.source should have .max() constraint', () => {
    const schemaStart = src.indexOf('UpdateCellSourceSchema = z.object');
    const schemaEnd = src.indexOf('});', schemaStart);
    const block = src.slice(schemaStart, schemaEnd);
    expect(block).toContain('source: z.string().max(');
  });
});
