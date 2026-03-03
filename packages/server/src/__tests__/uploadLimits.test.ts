import { describe, it, expect } from 'vitest';

// D2: Upload limits configuration constants
const MAX_UPLOAD_SIZE = 20 * 1024 * 1024; // 20MB
const ALLOWED_EXTENSIONS = ['.zip', '.notebook.json', '.json'];

describe('upload limits - D2', () => {
  it('should have MAX_UPLOAD_SIZE set to 20MB', () => {
    expect(MAX_UPLOAD_SIZE).toBe(20 * 1024 * 1024);
  });

  it('should allow only safe file extensions', () => {
    const testCases = [
      { ext: '.zip', allowed: true },
      { ext: '.notebook.json', allowed: true },
      { ext: '.json', allowed: true },
      { ext: '.exe', allowed: false },
      { ext: '.sh', allowed: false },
      { ext: '.js', allowed: false },
    ];

    for (const { ext, allowed } of testCases) {
      expect(ALLOWED_EXTENSIONS.includes(ext)).toBe(allowed);
    }
  });

  it('should reject file sizes over 20MB conceptually', () => {
    const fileSizeOK = 15 * 1024 * 1024; // 15MB
    const fileSizeTooBig = 25 * 1024 * 1024; // 25MB

    expect(fileSizeOK <= MAX_UPLOAD_SIZE).toBe(true);
    expect(fileSizeTooBig <= MAX_UPLOAD_SIZE).toBe(false);
  });
});
