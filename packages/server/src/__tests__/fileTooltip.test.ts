/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Task C: Tooltip 修复 — structural tests
 *
 * data-tooltip must be on .fp-entry (parent) not .fp-name (child),
 * because .fp-name has overflow:hidden which clips ::after pseudo-element.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const COMPONENT_PATH = resolve(__dirname, '../../../web/src/components/FileSection.tsx');
const CSS_PATH = resolve(__dirname, '../../../web/src/styles.css');

describe('FileSection tooltip placement', () => {
  it('data-tooltip is on fp-entry div, not on fp-name span (FileSection.tsx)', () => {
    const src = readFileSync(COMPONENT_PATH, 'utf-8');
    // fp-name should NOT have data-tooltip
    const fpNameTooltip = /className="fp-name"[^>]*data-tooltip/g;
    expect(src.match(fpNameTooltip)).toBeNull();

    // fp-entry (the parent div) should carry data-tooltip
    const fpEntryTooltip = /className="fp-entry[^"]*"[^>]*data-tooltip/g;
    expect(src.match(fpEntryTooltip)).not.toBeNull();
  });

  it('CSS tooltip selectors use .fp-entry[data-tooltip], not .fp-name[data-tooltip]', () => {
    const css = readFileSync(CSS_PATH, 'utf-8');
    // Should NOT contain .fp-name[data-tooltip]
    expect(css).not.toContain('.fp-name[data-tooltip]');
    // Should contain .fp-entry[data-tooltip]
    expect(css).toContain('.fp-entry[data-tooltip]');
  });
});
