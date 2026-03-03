import { describe, it, expect } from 'vitest';
import * as constants from '../constants.js';

describe('constants - D6', () => {
  it('should export CELL_PAGE_SIZE as positive number', () => {
    expect(typeof constants.CELL_PAGE_SIZE).toBe('number');
    expect(constants.CELL_PAGE_SIZE).toBeGreaterThan(0);
  });

  it('should export MAX_UPLOAD_SIZE as positive number', () => {
    expect(typeof constants.MAX_UPLOAD_SIZE).toBe('number');
    expect(constants.MAX_UPLOAD_SIZE).toBeGreaterThan(0);
    expect(constants.MAX_UPLOAD_SIZE).toBe(20 * 1024 * 1024); // 20MB
  });

  it('should export CELL_LOAD_TIMEOUT as positive number', () => {
    expect(typeof constants.CELL_LOAD_TIMEOUT).toBe('number');
    expect(constants.CELL_LOAD_TIMEOUT).toBeGreaterThan(0);
    expect(constants.CELL_LOAD_TIMEOUT).toBe(30_000); // 30s
  });

  it('should export EVENT_BUFFER_SIZE as positive number', () => {
    expect(typeof constants.EVENT_BUFFER_SIZE).toBe('number');
    expect(constants.EVENT_BUFFER_SIZE).toBeGreaterThan(0);
  });

  it('should export ALLOWED_UPLOAD_EXTENSIONS as array', () => {
    expect(Array.isArray(constants.ALLOWED_UPLOAD_EXTENSIONS)).toBe(true);
    expect(constants.ALLOWED_UPLOAD_EXTENSIONS).toContain('.zip');
    expect(constants.ALLOWED_UPLOAD_EXTENSIONS).toContain('.json');
  });
});
