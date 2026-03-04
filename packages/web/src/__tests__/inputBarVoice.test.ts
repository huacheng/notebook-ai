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

  it('should destructure error from useVoiceInput', () => {
    const src = getSrc();
    // Must extract error state to show permission denied etc.
    expect(src).toMatch(/error.*:.*voiceError.*=.*useVoiceInput/s);
  });

  it('should display voice error message to user', () => {
    const src = getSrc();
    // Must show error in UI (not silent failure)
    expect(src).toContain('voiceError');
    expect(src).toMatch(/voiceError.*&&/); // conditional render
  });

  it('should destructure requestPermission from useVoiceInput', () => {
    const src = getSrc();
    expect(src).toMatch(/requestPermission.*=.*useVoiceInput/s);
  });

  it('should have handleVoicePermission callback for retry', () => {
    const src = getSrc();
    expect(src).toContain('handleVoicePermission');
    expect(src).toMatch(/handleVoicePermission.*requestPermission/s);
  });

  it('should make voice-error clickable for retry', () => {
    const src = getSrc();
    // voice-error should be a button with onClick
    expect(src).toMatch(/voice-error.*onClick.*handleVoicePermission/s);
  });

  it('should destructure interimTranscript from useVoiceInput', () => {
    const src = getSrc();
    expect(src).toMatch(/interimTranscript.*=.*useVoiceInput/s);
  });

  it('should display voice-listening-indicator when isListening', () => {
    const src = getSrc();
    expect(src).toContain('voice-listening-indicator');
    expect(src).toContain('voice-interim-text');
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
