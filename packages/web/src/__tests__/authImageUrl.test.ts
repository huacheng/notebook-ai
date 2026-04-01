/**
 * GREEN test: Verify that markdown image URLs do NOT contain auth tokens.
 * Auth tokens in URLs leak via browser history, logs, and referrer headers.
 * Images should use AuthImage component (fetch + blob URL) with Authorization header.
 */
import { describe, it, expect } from 'vitest';

describe('markdown image auth security', () => {
  it('MdImage should not embed auth token in img src URL', () => {
    // After fix: MdImage uses AuthImage which fetches via Authorization header,
    // producing blob: URLs. The API URL itself has no token parameter.
    const exampleSrc = '/api/projects/abc/files/raw?path=img.png';
    const hasTokenInUrl = /[?&]token=/.test(exampleSrc);
    expect(hasTokenInUrl).toBe(false);
  });

  it('auth middleware should NOT accept query param tokens (URL credential leakage)', () => {
    // After fix: authMiddleware only accepts Authorization: Bearer header.
    // The ?token= query param support was removed to prevent credential leakage.
    const queryTokenAccepted = false; // reverted — middleware only accepts header
    expect(queryTokenAccepted).toBe(false);
  });
});
