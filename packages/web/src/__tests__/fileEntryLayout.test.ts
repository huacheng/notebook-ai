/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { fileType } from '../components/FileSection';

// ── fileType — regression tests for layout change ──────────────────────────

describe('fileType', () => {
  it('returns "nb" for .notebook.json files', () => {
    expect(fileType('My Project.notebook.json')).toBe('nb');
  });

  it('maps common extensions to short type keys', () => {
    expect(fileType('main.py')).toBe('py');
    expect(fileType('index.ts')).toBe('ts');
    expect(fileType('app.js')).toBe('js');
    expect(fileType('readme.md')).toBe('md');
    expect(fileType('data.json')).toBe('json');
    expect(fileType('styles.css')).toBe('css');
    expect(fileType('page.html')).toBe('html');
    expect(fileType('doc.pdf')).toBe('pdf');
    expect(fileType('photo.png')).toBe('img');
    expect(fileType('archive.zip')).toBe('zip');
    expect(fileType('report.docx')).toBe('doc');
    expect(fileType('slides.pptx')).toBe('ppt');
    expect(fileType('table.xlsx')).toBe('xls');
  });

  it('returns truncated extension for unknown types', () => {
    expect(fileType('data.parquet')).toBe('parq');
    expect(fileType('model.onnx')).toBe('onnx');
  });

  it('returns truncated name for files without dot extension', () => {
    // No dot → name itself is treated as "extension", sliced to 4 chars
    expect(fileType('Makefile')).toBe('make');
    expect(fileType('Dockerfile')).toBe('dock');
  });

  it('is case-insensitive for extensions', () => {
    expect(fileType('README.MD')).toBe('md');
    expect(fileType('image.PNG')).toBe('img');
    expect(fileType('script.PY')).toBe('py');
  });

  it('.notebook.json takes priority over .json extension', () => {
    // This is important — fileType checks endsWith first
    expect(fileType('test.notebook.json')).toBe('nb');
    // But plain .json still maps to 'json'
    expect(fileType('config.json')).toBe('json');
  });
});
