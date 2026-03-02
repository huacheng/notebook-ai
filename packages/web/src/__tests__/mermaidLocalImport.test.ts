import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const src = readFileSync(
  path.resolve(__dirname, '../hooks/useMermaidRender.ts'),
  'utf-8',
);

/**
 * P1-6: Mermaid is loaded from external CDN without SRI verification.
 * A compromised CDN can inject arbitrary code.
 * Fix: vendor mermaid locally (npm dependency) or add SRI check.
 */
describe('Mermaid CDN SRI / local vendor (P1-6)', () => {
  it('should not load mermaid from external CDN without integrity check', () => {
    // Either: no CDN URL at all (local import) or has integrity/SRI check
    const hasCdnUrl = /cdn\.jsdelivr\.net|unpkg\.com/.test(src);
    const hasSriCheck = /integrity|sha256|sha384|sha512/.test(src);
    // Must either not use CDN or have SRI verification
    expect(!hasCdnUrl || hasSriCheck).toBe(true);
  });
});
