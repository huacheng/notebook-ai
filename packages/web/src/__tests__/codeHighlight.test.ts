/**
 * @file codeHighlight.test.ts
 * TDD: FileViewer should support syntax highlighting for code files
 *
 * Supported languages: Python, Rust, TypeScript, JavaScript, C/C++, Java, Go
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('FileViewer code syntax highlighting', () => {
  const renderSrc = readFileSync(
    path.resolve(__dirname, '../components/FileViewerRender.tsx'),
    'utf-8'
  );

  it('should have a CODE_EXTENSIONS map for syntax highlighting', () => {
    // Should define which extensions get syntax highlighting
    expect(renderSrc).toMatch(/CODE_EXTENSIONS|CODE_EXT_MAP|codeExtensions/i);
  });

  it('should support Python highlighting (.py)', () => {
    // Check for py: 'python' in CODE_EXT_MAP
    expect(renderSrc).toMatch(/py:\s*['"]python['"]/);
  });

  it('should support Rust highlighting (.rs)', () => {
    // Check for rs: 'rust' in CODE_EXT_MAP
    expect(renderSrc).toMatch(/rs:\s*['"]rust['"]/);
  });

  it('should support TypeScript highlighting (.ts, .tsx)', () => {
    // Check for ts/tsx: 'typescript' in CODE_EXT_MAP
    expect(renderSrc).toMatch(/tsx?:\s*['"]typescript['"]/);
  });

  it('should support JavaScript highlighting (.js, .jsx)', () => {
    // Check for js/jsx: 'javascript' in CODE_EXT_MAP
    expect(renderSrc).toMatch(/jsx?:\s*['"]javascript['"]/);
  });

  it('should support C/C++ highlighting (.c, .cpp, .h, .hpp)', () => {
    // Check for c/cpp: 'c' or 'cpp' in CODE_EXT_MAP
    expect(renderSrc).toMatch(/cpp:\s*['"]cpp['"]/);
    expect(renderSrc).toMatch(/\bc:\s*['"]c['"]/);
  });

  it('should support Java highlighting (.java)', () => {
    // Check for java: 'java' in CODE_EXT_MAP
    expect(renderSrc).toMatch(/java:\s*['"]java['"]/);
  });

  it('should support Go highlighting (.go)', () => {
    // Check for go: 'go' in CODE_EXT_MAP
    expect(renderSrc).toMatch(/go:\s*['"]go['"]/);
  });

  it('should use highlight.js for code files', () => {
    // Should import and use hljs for code highlighting
    expect(renderSrc).toMatch(/hljs\.highlight|highlightAuto|highlight\.js/i);
  });

  it('should render code with line numbers', () => {
    // Should have line number rendering for code
    expect(renderSrc).toMatch(/line-number|lineNumber|fv-code-line/i);
  });

  it('should wrap code in a pre/code structure with language class', () => {
    // Should output <pre><code class="language-xxx">
    expect(renderSrc).toMatch(/language-\$\{|hljs|className.*language/i);
  });
});

describe('FileViewer code file detection', () => {
  const renderSrc = readFileSync(
    path.resolve(__dirname, '../components/FileViewerRender.tsx'),
    'utf-8'
  );

  it('should detect code files by extension', () => {
    // Should have logic to check if file is a code file
    expect(renderSrc).toMatch(/isCodeFile|isCode\s*=|codeLanguage|getLanguage/i);
  });

  it('should render code differently from plain text', () => {
    // Code files should NOT use the plain <pre>{content}</pre> path
    // They should use the highlighted code renderer
    expect(renderSrc).toMatch(/fv-render__code|CodeRenderer|hljs/i);
  });
});
