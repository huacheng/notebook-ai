import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('useVoiceInput hook', () => {
  const getSrc = () => readFileSync(
    path.resolve(__dirname, '../hooks/useVoiceInput.ts'),
    'utf-8',
  );

  it('should export useVoiceInput function', () => {
    const src = getSrc();
    expect(src).toMatch(/export function useVoiceInput/);
  });

  it('should export DEFAULT_LANG constant as zh-CN', () => {
    const src = getSrc();
    expect(src).toContain("export const DEFAULT_LANG = 'zh-CN'");
  });

  it('should check for SpeechRecognition API support', () => {
    const src = getSrc();
    expect(src).toContain('SpeechRecognition');
    expect(src).toContain('webkitSpeechRecognition');
  });

  it('should return isSupported flag', () => {
    const src = getSrc();
    expect(src).toContain('isSupported');
    expect(src).toMatch(/return\s*\{[^}]*isSupported/);
  });

  it('should return isListening state', () => {
    const src = getSrc();
    expect(src).toContain('isListening');
    expect(src).toMatch(/return\s*\{[^}]*isListening/);
  });

  it('should return transcript state', () => {
    const src = getSrc();
    expect(src).toContain('transcript');
    expect(src).toMatch(/return\s*\{[^}]*transcript/);
  });

  it('should return interimTranscript for real-time display', () => {
    const src = getSrc();
    expect(src).toContain('interimTranscript');
    expect(src).toMatch(/return\s*\{[^}]*interimTranscript/);
  });

  it('should return start and stop functions', () => {
    const src = getSrc();
    expect(src).toMatch(/return\s*\{[^}]*start[^}]*stop/s);
  });

  it('should return error state', () => {
    const src = getSrc();
    expect(src).toMatch(/return\s*\{[^}]*error/);
  });

  it('should handle recognition.onresult with isFinal check', () => {
    const src = getSrc();
    expect(src).toContain('isFinal');
    expect(src).toContain('onresult');
  });

  it('should handle recognition.onerror', () => {
    const src = getSrc();
    expect(src).toContain('onerror');
    expect(src).toContain('not-allowed');
  });

  it('should cleanup recognition on unmount', () => {
    const src = getSrc();
    // Should have useEffect with cleanup
    expect(src).toContain('useEffect');
    expect(src).toMatch(/return\s*\(\)\s*=>\s*\{/);
  });

  it('should support continuous mode option', () => {
    const src = getSrc();
    expect(src).toContain('continuous');
  });

  it('should support interimResults option', () => {
    const src = getSrc();
    expect(src).toContain('interimResults');
  });

  // D1-1 fix: clear transcript on start
  it('should clear transcript on start (D1-1 fix)', () => {
    const src = getSrc();
    // Check that start() clears transcript
    expect(src).toContain("setTranscript('')");
  });

  // D3-2 fix: handle no-speech timeout
  it('should handle no-speech error in continuous mode (D3-2 fix)', () => {
    const src = getSrc();
    expect(src).toContain("event.error === 'no-speech'");
    // Should auto-restart in continuous mode
    expect(src).toContain('no-speech');
  });

  // Permission request for denied microphone
  it('should return requestPermission function', () => {
    const src = getSrc();
    expect(src).toMatch(/return\s*\{[^}]*requestPermission/);
  });

  it('should use getUserMedia to request microphone permission', () => {
    const src = getSrc();
    expect(src).toContain('getUserMedia');
    expect(src).toContain('audio');
  });

  it('should clear error on successful permission grant', () => {
    const src = getSrc();
    // After getUserMedia succeeds, should clear error
    expect(src).toMatch(/getUserMedia.*setError\(null\)/s);
  });
});
