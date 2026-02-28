import { describe, it, expect } from 'vitest';
import { formatTime, formatTokens } from '../utils/runningStatus';

describe('formatTime', () => {
  it('formats seconds below 60', () => {
    expect(formatTime(0)).toBe('0s');
    expect(formatTime(5)).toBe('5s');
    expect(formatTime(32)).toBe('32s');
    expect(formatTime(59)).toBe('59s');
  });

  it('formats minutes + seconds at 60 and above', () => {
    expect(formatTime(60)).toBe('1m 0s');
    expect(formatTime(75)).toBe('1m 15s');
    expect(formatTime(135)).toBe('2m 15s');
    expect(formatTime(600)).toBe('10m 0s');
  });
});

describe('formatTokens', () => {
  it('returns plain number below 1000', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(423)).toBe('423');
    expect(formatTokens(999)).toBe('999');
  });

  it('formats as Xk or X.Yk at 1000 and above', () => {
    expect(formatTokens(1000)).toBe('1.0k');
    expect(formatTokens(1200)).toBe('1.2k');
    expect(formatTokens(2500)).toBe('2.5k');
    expect(formatTokens(10000)).toBe('10.0k');
  });
});
