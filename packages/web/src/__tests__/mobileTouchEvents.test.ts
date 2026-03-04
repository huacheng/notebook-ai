import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

/**
 * Tests for mobile touch event handling in dropdown menus.
 *
 * Problem: On Edge mobile browser, tapping menu items (Rename/Delete) doesn't trigger actions.
 * Root cause hypothesis: document-level touchstart listener closes menu before click fires.
 */
describe('Mobile menu touch event handling', () => {
  const getProjectsListSrc = () =>
    readFileSync(path.resolve(__dirname, '../components/mobile/MobileProjectsList.tsx'), 'utf-8');

  const getNotebooksListSrc = () =>
    readFileSync(path.resolve(__dirname, '../components/mobile/MobileNotebooksList.tsx'), 'utf-8');

  describe('MobileProjectMenu', () => {
    it('should have onTouchEnd handler on menu buttons for immediate touch response', () => {
      const src = getProjectsListSrc();
      // Menu buttons need onTouchEnd to handle touch immediately without waiting for click
      expect(src).toMatch(/mobile-item-menu-item.*onTouchEnd/s);
    });

    it('should stop touch event propagation on menu container', () => {
      const src = getProjectsListSrc();
      // Menu container should stop touchstart propagation to prevent document handler from firing
      expect(src).toMatch(/mobile-item-menu.*onTouchStart.*stopPropagation/s);
    });

    it('should not close menu on touchstart inside menu', () => {
      const src = getProjectsListSrc();
      // Document handler should not listen to touchstart, or menu should block it
      // Either: no touchstart listener OR stopPropagation on menu's touchstart
      const hasTouchStartListener = src.includes("addEventListener('touchstart'");
      const hasStopPropagation = src.match(/mobile-item-menu.*onTouchStart/s);
      expect(hasTouchStartListener === false || hasStopPropagation).toBeTruthy();
    });
  });

  describe('MobileNotebookMenu', () => {
    it('should have onTouchEnd handler on menu buttons for immediate touch response', () => {
      const src = getNotebooksListSrc();
      expect(src).toMatch(/mobile-item-menu-item.*onTouchEnd/s);
    });

    it('should stop touch event propagation on menu container', () => {
      const src = getNotebooksListSrc();
      expect(src).toMatch(/mobile-item-menu.*onTouchStart.*stopPropagation/s);
    });
  });
});

/**
 * Tests for mobile actions sheet touch scrolling.
 *
 * Problem: MobileNotebookActions sheet content cannot be scrolled via touch.
 */
describe('Mobile actions sheet touch scrolling', () => {
  const getActionsSrc = () =>
    readFileSync(path.resolve(__dirname, '../components/mobile/MobileNotebookActions.tsx'), 'utf-8');

  const getStylesSrc = () =>
    readFileSync(path.resolve(__dirname, '../styles.css'), 'utf-8');

  it('should have touch scrolling CSS on mobile-actions-sheet', () => {
    const css = getStylesSrc();
    // Check for webkit touch scrolling
    expect(css).toMatch(/\.mobile-actions-sheet[^}]*-webkit-overflow-scrolling:\s*touch/s);
  });

  it('should have touch-action: pan-y to allow vertical scrolling', () => {
    const css = getStylesSrc();
    expect(css).toMatch(/\.mobile-actions-sheet[^}]*touch-action:\s*pan-y/s);
  });

  it('should have overscroll-behavior-y: contain to prevent scroll chaining', () => {
    const css = getStylesSrc();
    expect(css).toMatch(/\.mobile-actions-sheet[^}]*overscroll-behavior-y:\s*contain/s);
  });

  it('should stop touch propagation on sheet to prevent overlay interference', () => {
    const src = getActionsSrc();
    // Sheet should stop touchstart/touchmove to prevent overlay from capturing
    expect(src).toMatch(/mobile-actions-sheet.*onTouchStart.*stopPropagation/s);
  });

  it('should have max-height and overflow-y: auto on actions list', () => {
    const css = getStylesSrc();
    expect(css).toMatch(/\.mobile-actions-list[^}]*overflow-y:\s*auto/s);
    expect(css).toMatch(/\.mobile-actions-list[^}]*max-height/s);
  });
});

/**
 * Tests for modal positioning on mobile screens.
 */
describe('Mobile modal positioning', () => {
  const getStylesSrc = () =>
    readFileSync(path.resolve(__dirname, '../styles.css'), 'utf-8');

  it('should have responsive min-width for narrow mobile screens', () => {
    const css = getStylesSrc();
    // Modal should not have fixed min-width that exceeds mobile viewport
    // Should use min() or clamp() or media query
    const modalSection = css.match(/\.annotation-modal\s*\{[^}]+\}/s)?.[0] || '';
    const hasResponsiveWidth =
      modalSection.includes('min(') ||
      modalSection.includes('clamp(') ||
      modalSection.includes('90vw') ||
      !modalSection.includes('min-width: 380px');
    expect(hasResponsiveWidth).toBe(true);
  });
});
