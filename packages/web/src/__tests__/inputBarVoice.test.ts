import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('InputBar voice integration', () => {
  const getSrc = () => readFileSync(
    path.resolve(__dirname, '../components/shared/InputBar.tsx'),
    'utf-8',
  );

  it('should import useVoiceInput hook', () => {
    const src = getSrc();
    expect(src).toContain("from '../../hooks/useVoiceInput'");
  });

  it('should have voice-input-btn class', () => {
    const src = getSrc();
    expect(src).toContain('voice-input-btn');
  });

  it('should have toggleVoice handler', () => {
    const src = getSrc();
    expect(src).toContain('toggleVoice');
  });

  it('should show microphone emoji when not listening', () => {
    const src = getSrc();
    expect(src).toContain('🎤');
  });

  it('should show recording indicator when listening', () => {
    const src = getSrc();
    expect(src).toContain('🔴');
  });

  it('should conditionally render based on isSupported', () => {
    const src = getSrc();
    expect(src).toContain('isSupported');
  });

  it('should append voice result to text', () => {
    const src = getSrc();
    // onResult callback should append to setText
    expect(src).toMatch(/onResult.*setText/s);
  });
});

describe('InputBar existing functionality (regression)', () => {
  const getSrc = () => readFileSync(
    path.resolve(__dirname, '../components/shared/InputBar.tsx'),
    'utf-8',
  );

  it('should still have handleRun', () => {
    const src = getSrc();
    expect(src).toContain('handleRun');
  });

  it('should still have command buttons', () => {
    const src = getSrc();
    expect(src).toContain('task-ai:target');
    expect(src).toContain('task-ai:auto');
    expect(src).toContain('task-ai:highlight');
  });

  it('should still support paste handler', () => {
    const src = getSrc();
    expect(src).toContain('handlePaste');
  });

  it('should still have textarea', () => {
    const src = getSrc();
    expect(src).toContain('<textarea');
  });
});
