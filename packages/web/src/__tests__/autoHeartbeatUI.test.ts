/**
 * Tests for the Auto heartbeat UI in Notebook.tsx.
 * RED: [Auto] button in statusbar, Esc stops auto mode.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const notebookSrc = () =>
  fs.readFileSync(path.resolve(__dirname, '../components/Notebook.tsx'), 'utf-8');

const wsSliceSrc = () =>
  fs.readFileSync(path.resolve(__dirname, '../store/wsSlice.ts'), 'utf-8');

describe('Auto heartbeat UI', () => {
  it('should have [Auto] toggle button in NotebookStatusBar', () => {
    const src = notebookSrc();
    // Should have an Auto button
    expect(src).toMatch(/auto.*btn|auto-toggle|autoMode/i);
  });

  it('interruptCell should send auto_stop when auto is active', () => {
    const src = wsSliceSrc();
    // interruptCell should check autoMode and send auto_stop
    const interruptSection = src.match(/interruptCell[\s\S]*?auto_stop/);
    expect(interruptSection).toBeTruthy();
  });

  it('should have auto interval state in store', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../store/autoStatusSlice.ts'), 'utf-8'
    );
    expect(src).toContain('autoMode');
    expect(src).toContain('autoIterationCount');
  });
});
