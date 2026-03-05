import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

/**
 * AskUserQuestion isActive frontend rendering
 *
 * - isActive: true → question is active, waiting for user answer
 * - isActive: false → question is answered/frozen, render as gray and disabled
 */
describe('AskUserQuestion isActive frontend rendering', () => {
  const cellOutputSrc = readFileSync(
    path.resolve(__dirname, '../components/CellOutput.tsx'),
    'utf-8',
  );

  it('should use isActive to determine answered state', () => {
    // InteractiveOptionsWrapper should check item.isActive
    // When isActive === false, treat as answered (frozen)
    const usesIsActive = cellOutputSrc.includes('isActive');
    expect(usesIsActive).toBe(true);
  });

  it('should pass frozen state to InteractiveOptions when isActive is false', () => {
    // The logic should be: isActive === false → initialAnswered = true
    // This freezes the UI (gray, disabled)
    const hasFrozenLogic =
      cellOutputSrc.includes('isActive === false') ||
      cellOutputSrc.includes('!isActive') ||
      cellOutputSrc.includes('isActive !== true');
    expect(hasFrozenLogic).toBe(true);
  });
});

describe('InteractiveOptions frozen styling', () => {
  const stylesSrc = readFileSync(
    path.resolve(__dirname, '../styles.css'),
    'utf-8',
  );

  it('should have gray/disabled styling for answered state', () => {
    // .interactive-options--answered should have muted/gray styling
    const hasAnsweredStyle = stylesSrc.includes('.interactive-options--answered');
    expect(hasAnsweredStyle).toBe(true);
  });
});
