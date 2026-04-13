/**
 * Task 11: Title validation in NotebookCreationPanel
 *
 * Tests the validation logic for notebook titles:
 * - Illegal filename characters trigger an error
 * - The error message is shown and submission is blocked
 * - Valid titles produce no error
 *
 * The component uses Zustand and is not rendered here. Instead,
 * the validation logic is extracted as a pure function and tested
 * directly — matching the project's testing style (no @testing-library/react).
 */

import { describe, it, expect } from 'vitest';
import { validateNotebookTitle } from '../utils/validateNotebookTitle';

describe('validateNotebookTitle — illegal char detection', () => {
  it('returns null for a valid simple title', () => {
    expect(validateNotebookTitle('My Notebook')).toBeNull();
  });

  it('returns null for empty / whitespace-only input (no error shown until submit)', () => {
    expect(validateNotebookTitle('')).toBeNull();
    expect(validateNotebookTitle('   ')).toBeNull();
  });

  it('returns error for title containing forward slash', () => {
    expect(validateNotebookTitle('bad/name')).not.toBeNull();
  });

  it('returns error for title containing backslash', () => {
    expect(validateNotebookTitle('bad\\name')).not.toBeNull();
  });

  it('returns error for title containing colon', () => {
    expect(validateNotebookTitle('bad:name')).not.toBeNull();
  });

  it('returns error for title containing asterisk', () => {
    expect(validateNotebookTitle('bad*name')).not.toBeNull();
  });

  it('returns error for title containing question mark', () => {
    expect(validateNotebookTitle('bad?name')).not.toBeNull();
  });

  it('returns error for title containing double quote', () => {
    expect(validateNotebookTitle('bad"name')).not.toBeNull();
  });

  it('returns error for title containing less-than', () => {
    expect(validateNotebookTitle('bad<name')).not.toBeNull();
  });

  it('returns error for title containing greater-than', () => {
    expect(validateNotebookTitle('bad>name')).not.toBeNull();
  });

  it('returns error for title containing pipe', () => {
    expect(validateNotebookTitle('bad|name')).not.toBeNull();
  });

  it('returns error for title containing control char (0x01)', () => {
    expect(validateNotebookTitle('bad\x01name')).not.toBeNull();
  });

  it('returns error for title containing null char (0x00)', () => {
    expect(validateNotebookTitle('bad\x00name')).not.toBeNull();
  });

  it('returns error for title containing unit separator (0x1f)', () => {
    expect(validateNotebookTitle('bad\x1fname')).not.toBeNull();
  });

  it('returns null for title with dash and underscore (allowed)', () => {
    expect(validateNotebookTitle('good-name_2024')).toBeNull();
  });

  it('returns null for title with unicode letters', () => {
    expect(validateNotebookTitle('我的笔记本')).toBeNull();
  });

  it('error message mentions the illegal characters', () => {
    const err = validateNotebookTitle('bad/name');
    expect(err).toContain('非法字符');
  });
});
