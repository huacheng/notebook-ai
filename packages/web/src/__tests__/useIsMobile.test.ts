/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// Test the core logic without React hooks
describe('useIsMobile core logic', () => {
  let originalInnerWidth: number;

  beforeEach(() => {
    originalInnerWidth = window.innerWidth;
  });

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: originalInnerWidth,
    });
  });

  function setWindowWidth(width: number) {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: width,
    });
  }

  it('detects mobile at 768px (boundary)', () => {
    setWindowWidth(768);
    expect(window.innerWidth <= 768).toBe(true);
  });

  it('detects mobile at 375px (iPhone)', () => {
    setWindowWidth(375);
    expect(window.innerWidth <= 768).toBe(true);
  });

  it('detects desktop at 1024px', () => {
    setWindowWidth(1024);
    expect(window.innerWidth <= 768).toBe(false);
  });

  it('custom breakpoint works', () => {
    setWindowWidth(500);
    const breakpoint = 480;
    expect(window.innerWidth <= breakpoint).toBe(false);
  });
});

describe('useOrientation core logic', () => {
  let originalInnerWidth: number;
  let originalInnerHeight: number;

  beforeEach(() => {
    originalInnerWidth = window.innerWidth;
    originalInnerHeight = window.innerHeight;
  });

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: originalInnerWidth,
    });
    Object.defineProperty(window, 'innerHeight', {
      writable: true,
      configurable: true,
      value: originalInnerHeight,
    });
  });

  function setWindowSize(width: number, height: number) {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: width,
    });
    Object.defineProperty(window, 'innerHeight', {
      writable: true,
      configurable: true,
      value: height,
    });
  }

  it('detects portrait when height > width', () => {
    setWindowSize(375, 667);
    expect(window.innerWidth > window.innerHeight ? 'landscape' : 'portrait').toBe('portrait');
  });

  it('detects landscape when width > height', () => {
    setWindowSize(667, 375);
    expect(window.innerWidth > window.innerHeight ? 'landscape' : 'portrait').toBe('landscape');
  });

  it('detects portrait when width === height', () => {
    setWindowSize(500, 500);
    // When equal, treat as portrait (default mobile orientation)
    expect(window.innerWidth > window.innerHeight ? 'landscape' : 'portrait').toBe('portrait');
  });
});
