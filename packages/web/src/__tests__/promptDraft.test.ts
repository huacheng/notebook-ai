/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { loadDraft, saveDraft, clearDraft, DRAFT_PREFIX } from '../utils/promptDraft';

beforeEach(() => {
  localStorage.clear();
});

describe('promptDraft', () => {
  it('returns empty string when no draft saved', () => {
    expect(loadDraft('session-1')).toBe('');
  });

  it('saves and loads a draft', () => {
    saveDraft('session-1', 'hello world');
    expect(loadDraft('session-1')).toBe('hello world');
  });

  it('isolates drafts by session key', () => {
    saveDraft('session-1', 'aaa');
    saveDraft('session-2', 'bbb');
    expect(loadDraft('session-1')).toBe('aaa');
    expect(loadDraft('session-2')).toBe('bbb');
  });

  it('clearDraft removes the draft', () => {
    saveDraft('session-1', 'text');
    clearDraft('session-1');
    expect(loadDraft('session-1')).toBe('');
  });

  it('saveDraft with empty string removes the key', () => {
    saveDraft('s', 'text');
    saveDraft('s', '');
    expect(localStorage.getItem(`${DRAFT_PREFIX}s`)).toBeNull();
  });
});
