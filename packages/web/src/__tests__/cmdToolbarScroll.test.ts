import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

/**
 * Test that command toolbar supports horizontal scroll via mouse wheel.
 * When the toolbar is narrowed and has overflow, vertical wheel events
 * should be converted to horizontal scroll.
 */
describe('Command toolbar horizontal scroll', () => {
  const getInputBarSrc = () =>
    readFileSync(path.resolve(__dirname, '../components/shared/InputBar.tsx'), 'utf-8');

  it('should have a ref for cmd-btns element', () => {
    const src = getInputBarSrc();
    expect(src).toMatch(/cmdBtnsRef\s*=\s*useRef/);
  });

  it('should attach ref to nb-cmd-btns div', () => {
    const src = getInputBarSrc();
    expect(src).toMatch(/className="nb-cmd-btns"[^>]*ref=\{cmdBtnsRef\}/);
  });

  it('should have wheel event handler', () => {
    const src = getInputBarSrc();
    expect(src).toMatch(/handleCmdWheel/);
    expect(src).toMatch(/onWheel=\{handleCmdWheel\}/);
  });

  it('should convert deltaY to horizontal scroll', () => {
    const src = getInputBarSrc();
    // Handler should check for horizontal overflow and scroll horizontally
    expect(src).toMatch(/el\.scrollWidth\s*>\s*el\.clientWidth/);
    expect(src).toMatch(/el\.scrollLeft\s*\+=.*deltaY/);
  });

  it('should prevent default when scrolling horizontally', () => {
    const src = getInputBarSrc();
    expect(src).toMatch(/e\.preventDefault\(\)/);
  });
});
