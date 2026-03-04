import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

/**
 * Tests for mobile restart overlay.
 *
 * Problem: Mobile notebook view didn't show a blocking overlay during restart,
 * unlike desktop which freezes the page.
 */
describe('Mobile restart overlay', () => {
  const getMobileNotebookViewSrc = () =>
    readFileSync(path.resolve(__dirname, '../components/mobile/MobileNotebookView.tsx'), 'utf-8');

  it('should have MobileRestartOverlay component', () => {
    const src = getMobileNotebookViewSrc();
    expect(src).toContain('MobileRestartOverlay');
  });

  it('should read restartPhase from store', () => {
    const src = getMobileNotebookViewSrc();
    expect(src).toMatch(/restartPhase.*useStore/s);
  });

  it('should render annotation-modal-overlay during restart', () => {
    const src = getMobileNotebookViewSrc();
    // RestartOverlay should use the modal overlay
    expect(src).toContain('annotation-modal-overlay');
  });

  it('should show spinner during restarting phase', () => {
    const src = getMobileNotebookViewSrc();
    // Should have restarting phase with spinner
    expect(src).toMatch(/restartPhase === 'restarting'[\s\S]*?nb-delete-spinner/);
  });

  it('should show success state during done phase', () => {
    const src = getMobileNotebookViewSrc();
    // Should have done phase with checkmark
    expect(src).toMatch(/restartPhase === 'done'[\s\S]*?10003/);
  });

  it('should show error state with retry button during error phase', () => {
    const src = getMobileNotebookViewSrc();
    // Should have error phase with retry
    expect(src).toMatch(/restartPhase === 'error'[\s\S]*?restartSession/);
  });

  it('should render MobileRestartOverlay in the component', () => {
    const src = getMobileNotebookViewSrc();
    // Should render the overlay component
    expect(src).toContain('<MobileRestartOverlay />');
  });
});
