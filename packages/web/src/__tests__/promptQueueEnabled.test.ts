import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

/**
 * Tests for prompt queue functionality.
 *
 * Problem: When a prompt is running, InputBar disables input and returns early.
 * Expected: When running, InputBar should call queuePrompt() instead of returning.
 * This applies to BOTH desktop and mobile.
 */
describe('Prompt queue while running', () => {
  const getInputBarSrc = () =>
    readFileSync(path.resolve(__dirname, '../components/shared/InputBar.tsx'), 'utf-8');

  it('should import queuePrompt from store', () => {
    const src = getInputBarSrc();
    // InputBar needs to use queuePrompt action from store
    expect(src).toMatch(/queuePrompt.*=.*useStore/s);
  });

  it('should NOT have isRunning in disabled condition for textarea', () => {
    const src = getInputBarSrc();
    // The textarea should be enabled during running to allow queue input
    // Current problematic code: const disabled = isRunning || uploading || editMode;
    // Should NOT include isRunning
    const disabledLine = src.match(/const\s+disabled\s*=\s*[^;]+/);
    expect(disabledLine).toBeTruthy();
    // isRunning should NOT be in the disabled condition
    expect(disabledLine![0]).not.toContain('isRunning');
  });

  it('should call queuePrompt when running instead of returning early', () => {
    const src = getInputBarSrc();
    // handleRun should call queuePrompt when isRunning is true
    // Should have logic like: if (isRunning) { queuePrompt(...); return; }
    const handleRunMatch = src.match(/function\s+handleRun\s*\([^)]*\)\s*\{[\s\S]*?\n\s*\}/);
    expect(handleRunMatch).toBeTruthy();
    expect(handleRunMatch![0]).toContain('queuePrompt');
  });

  it('should have separate disabled condition for run button', () => {
    const src = getInputBarSrc();
    // Run button should show different icon when running (queue mode)
    // Should have disabled logic that still shows the button enabled for queue
    // The button disabled should be based on (!text && no images) not isRunning
    const runBtnMatch = src.match(/className="nb-run-btn"[\s\S]*?disabled=\{[^}]+\}/);
    expect(runBtnMatch).toBeTruthy();
    // Should allow running when isRunning (to queue)
    // disabled should be based on empty input, not isRunning
    expect(runBtnMatch![0]).not.toMatch(/disabled=\{[^}]*isRunning[^}]*\}/);
  });
});
