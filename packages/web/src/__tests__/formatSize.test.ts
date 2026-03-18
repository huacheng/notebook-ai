import { describe, it, expect } from 'vitest';
import { formatSize } from '../components/FileSection';

describe('formatSize', () => {
  it('formats bytes correctly', () => {
    expect(formatSize(0)).toBe('0 B');
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(1023)).toBe('1023 B');
  });

  it('formats kilobytes correctly', () => {
    expect(formatSize(1024)).toBe('1.0 KB');
    expect(formatSize(1536)).toBe('1.5 KB');
    expect(formatSize(1024 * 1023)).toBe('1023.0 KB');
  });

  it('formats megabytes correctly', () => {
    expect(formatSize(1024 * 1024)).toBe('1.0 MB');
    expect(formatSize(1024 * 1024 * 1.5)).toBe('1.5 MB');
  });

  it('formats gigabytes correctly', () => {
    expect(formatSize(1024 * 1024 * 1024)).toBe('1.0 GB');
    expect(formatSize(1024 * 1024 * 1024 * 2.5)).toBe('2.5 GB');
  });

  // R1: Edge cases for undefined/NaN/negative
  it('handles undefined gracefully', () => {
    expect(formatSize(undefined as unknown as number)).toBe('—');
  });

  it('handles NaN gracefully', () => {
    expect(formatSize(NaN)).toBe('—');
  });

  it('handles negative numbers gracefully', () => {
    expect(formatSize(-100)).toBe('—');
  });
});
