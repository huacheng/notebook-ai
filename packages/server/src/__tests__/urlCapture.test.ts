import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs/promises';
import { UrlCaptureRequestSchema, UrlCaptureResultSchema, SuggestNextStepSchema } from '@notebook-ai/shared';

// ── Schema tests ─────────────────────────────────────────────────────────────

describe('UrlCaptureRequestSchema', () => {
  it('validates a well-formed url_capture message', () => {
    const msg = { type: 'url_capture', session_id: 'nb-abc123', url: 'https://example.com' };
    const result = UrlCaptureRequestSchema.safeParse(msg);
    expect(result.success).toBe(true);
  });

  it('rejects invalid URL', () => {
    const msg = { type: 'url_capture', session_id: 'nb-abc123', url: 'not-a-url' };
    const result = UrlCaptureRequestSchema.safeParse(msg);
    expect(result.success).toBe(false);
  });

  it('rejects missing session_id', () => {
    const msg = { type: 'url_capture', url: 'https://example.com' };
    const result = UrlCaptureRequestSchema.safeParse(msg);
    expect(result.success).toBe(false);
  });
});

describe('UrlCaptureResultSchema', () => {
  it('validates a success result', () => {
    const msg = { type: 'url_capture_result', url: 'https://example.com', file_path: '/tmp/screenshot.png', format: 'image' };
    const result = UrlCaptureResultSchema.safeParse(msg);
    expect(result.success).toBe(true);
  });

  it('validates an error result', () => {
    const msg = { type: 'url_capture_result', url: 'https://example.com', file_path: '', format: 'image', error: 'timeout' };
    const result = UrlCaptureResultSchema.safeParse(msg);
    expect(result.success).toBe(true);
  });
});

describe('SuggestNextStepSchema', () => {
  it('validates well-formed suggestions', () => {
    const msg = { suggestions: ['Run tests', 'Implement step 2'] };
    const result = SuggestNextStepSchema.safeParse(msg);
    expect(result.success).toBe(true);
  });

  it('rejects empty suggestions', () => {
    const msg = { suggestions: [] };
    const result = SuggestNextStepSchema.safeParse(msg);
    expect(result.success).toBe(false);
  });

  it('rejects more than 4 suggestions', () => {
    const msg = { suggestions: ['a', 'b', 'c', 'd', 'e'] };
    const result = SuggestNextStepSchema.safeParse(msg);
    expect(result.success).toBe(false);
  });

  it('accepts optional context', () => {
    const msg = { suggestions: ['Next'], context: 'After completing step 1' };
    const result = SuggestNextStepSchema.safeParse(msg);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.context).toBe('After completing step 1');
  });
});

// ── captureUrl unit tests (mocking playwright) ──────────────────────────────

describe('captureUrl', () => {
  const mockScreenshot = vi.fn().mockResolvedValue(Buffer.from('PNG'));
  const mockGoto = vi.fn().mockResolvedValue(undefined);
  const mockClose = vi.fn().mockResolvedValue(undefined);
  const mockNewPage = vi.fn().mockResolvedValue({
    goto: mockGoto,
    screenshot: mockScreenshot,
  });

  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    mockNewPage.mockResolvedValue({
      goto: mockGoto,
      screenshot: mockScreenshot,
    });
  });

  it('calls launch/goto/screenshot/close in correct order', async () => {
    vi.doMock('playwright', () => ({
      chromium: {
        launch: vi.fn().mockResolvedValue({
          newPage: mockNewPage,
          close: mockClose,
        }),
      },
    }));

    const { captureUrl } = await import('../url-capture');
    const tmpDir = path.join('/tmp', `url-capture-test-${Date.now()}`);
    await fs.mkdir(tmpDir, { recursive: true });

    const result = await captureUrl('https://example.com', tmpDir);

    expect(mockNewPage).toHaveBeenCalledWith({ viewport: { width: 1280, height: 900 } });
    expect(mockGoto).toHaveBeenCalledWith('https://example.com', { waitUntil: 'networkidle', timeout: 30_000 });
    expect(mockScreenshot).toHaveBeenCalled();
    expect(mockClose).toHaveBeenCalled();
    expect(result).toMatch(/\.screenshots\/screenshot-\d+\.png$/);

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('closes browser even when goto fails', async () => {
    mockGoto.mockRejectedValueOnce(new Error('net::ERR_NAME_NOT_RESOLVED'));

    vi.doMock('playwright', () => ({
      chromium: {
        launch: vi.fn().mockResolvedValue({
          newPage: mockNewPage,
          close: mockClose,
        }),
      },
    }));

    const { captureUrl } = await import('../url-capture');
    const tmpDir = path.join('/tmp', `url-capture-test-${Date.now()}`);

    await expect(captureUrl('https://invalid.example', tmpDir)).rejects.toThrow();
    expect(mockClose).toHaveBeenCalled();

    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });
});

// ── AgentProcess --add-dir tests ─────────────────────────────────────────────

describe('AgentProcess --add-dir', () => {
  it('includes --add-dir flags when allowedDirs provided', async () => {
    const { AgentProcess } = await import('../agent-process');
    const agent = new AgentProcess('claude', '/tmp/cwd', undefined, undefined, ['/tmp/dir1', '/tmp/dir2']);
    const args: string[] = agent._buildArgs();

    const addDirIndices = args.reduce((acc: number[], a: string, i: number) => a === '--add-dir' ? [...acc, i] : acc, []);
    expect(addDirIndices.length).toBe(2);
    expect(args[addDirIndices[0] + 1]).toBe('/tmp/dir1');
    expect(args[addDirIndices[1] + 1]).toBe('/tmp/dir2');
  });

  it('omits --add-dir when allowedDirs not provided', async () => {
    const { AgentProcess } = await import('../agent-process');
    const agent = new AgentProcess('claude', '/tmp/cwd');
    const args: string[] = agent._buildArgs();
    expect(args).not.toContain('--add-dir');
  });

  it('omits --add-dir for gemini engine', async () => {
    const { AgentProcess } = await import('../agent-process');
    const agent = new AgentProcess('gemini', '/tmp/cwd', undefined, undefined, ['/tmp/dir1']);
    const args: string[] = agent._buildArgs();
    expect(args).not.toContain('--add-dir');
  });
});
