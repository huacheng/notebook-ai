/**
 * InputBar append-to-running-cell behavior tests.
 * Validates that InputBar correctly routes prompts when cells are running/pending.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const inputBarSrc = () =>
  fs.readFileSync(path.resolve(__dirname, '../components/shared/InputBar.tsx'), 'utf-8');

describe('InputBar append behavior', () => {
  describe('Running cell detection consistency', () => {
    it('should use the same status set for isRunning and runningCell find', () => {
      const src = inputBarSrc();
      // isRunning checks for 'running' and/or 'pending'
      const isRunningMatch = src.match(/isRunning\s*=.*?\.some\(\s*\(?c\)?\s*=>\s*([\s\S]*?)\);/);
      expect(isRunningMatch).toBeTruthy();

      // runningCell should match the same statuses as isRunning
      const runningCellMatch = src.match(/runningCell\s*=.*?\.find\(\s*\(?c\)?\s*=>\s*([\s\S]*?)\);/);
      expect(runningCellMatch).toBeTruthy();

      // Both should reference 'running' status
      expect(isRunningMatch![1]).toContain('running');
      expect(runningCellMatch![1]).toContain('running');

      // If isRunning checks 'pending', runningCell must also check 'pending'
      if (isRunningMatch![1].includes('pending')) {
        expect(runningCellMatch![1]).toContain('pending');
      }
    });
  });

  describe('appendPrompt action exists in store type', () => {
    it('should have appendPrompt in NotebookStore', () => {
      const typesSrc = fs.readFileSync(
        path.resolve(__dirname, '../store/types.ts'), 'utf-8');
      expect(typesSrc).toContain('appendPrompt(');
    });
  });
});
