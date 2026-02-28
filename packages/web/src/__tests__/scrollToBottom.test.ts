import { describe, it, expect } from 'vitest';
import { shouldShowScrollBtn } from '../utils/scrollToBottom';

describe('shouldShowScrollBtn', () => {
  const THRESHOLD = 200;

  it('returns false when near the bottom (within threshold)', () => {
    // scrollHeight=1000, clientHeight=500, scrollTop=400 → distance=100 < 200
    expect(shouldShowScrollBtn(400, 1000, 500, THRESHOLD)).toBe(false);
  });

  it('returns false when exactly at the bottom', () => {
    // scrollHeight=1000, clientHeight=500, scrollTop=500 → distance=0
    expect(shouldShowScrollBtn(500, 1000, 500, THRESHOLD)).toBe(false);
  });

  it('returns true when scrolled up beyond threshold', () => {
    // scrollHeight=1000, clientHeight=500, scrollTop=100 → distance=400 > 200
    expect(shouldShowScrollBtn(100, 1000, 500, THRESHOLD)).toBe(true);
  });

  it('returns false when content fits in viewport (no scroll needed)', () => {
    // scrollHeight=500, clientHeight=500, scrollTop=0 → distance=0
    expect(shouldShowScrollBtn(0, 500, 500, THRESHOLD)).toBe(false);
  });

  it('uses default threshold of 200 when not specified', () => {
    // distance = 1000 - 0 - 500 = 500 > 200
    expect(shouldShowScrollBtn(0, 1000, 500)).toBe(true);
    // distance = 1000 - 700 - 500 = -200 (clamped) → false
    expect(shouldShowScrollBtn(700, 1000, 500)).toBe(false);
  });

  it('returns true at exactly threshold + 1', () => {
    // scrollHeight=1000, clientHeight=500, scrollTop=299 → distance=201 > 200
    expect(shouldShowScrollBtn(299, 1000, 500, THRESHOLD)).toBe(true);
  });

  it('returns false at exactly threshold', () => {
    // scrollHeight=1000, clientHeight=500, scrollTop=300 → distance=200, not > 200
    expect(shouldShowScrollBtn(300, 1000, 500, THRESHOLD)).toBe(false);
  });
});
