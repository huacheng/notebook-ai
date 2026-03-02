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
  // Mock route: invoke the handler with a mock route object that allows continue
  const mockRoute = vi.fn().mockImplementation(async (_pattern: string, _handler: (route: unknown) => Promise<void>) => {
    // In real Playwright, route handler intercepts requests; here we just register the call
  });
  const mockNewPage = vi.fn().mockResolvedValue({
    goto: mockGoto,
    screenshot: mockScreenshot,
    route: mockRoute,
  });

  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    mockNewPage.mockResolvedValue({
      goto: mockGoto,
      screenshot: mockScreenshot,
      route: mockRoute,
    });
  });

  it('calls launch/goto/screenshot/close in correct order', async () => {
    vi.doMock('dns/promises', () => ({
      lookup: vi.fn().mockResolvedValue({ address: '93.184.216.34', family: 4 }),
    }));
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

    vi.doMock('dns/promises', () => ({
      lookup: vi.fn().mockResolvedValue({ address: '93.184.216.34', family: 4 }),
    }));
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

// ── SSRF prevention (P0-3) ───────────────────────────────────────────────────

describe('captureUrl SSRF prevention (P0-3)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
  });

  it('rejects file:// URLs', async () => {
    const { captureUrl } = await import('../url-capture');
    await expect(captureUrl('file:///etc/passwd', '/tmp')).rejects.toThrow(/scheme/i);
  });

  it('rejects javascript: URLs', async () => {
    const { captureUrl } = await import('../url-capture');
    await expect(captureUrl('javascript:alert(1)', '/tmp')).rejects.toThrow(/scheme/i);
  });

  it('rejects data: URLs', async () => {
    const { captureUrl } = await import('../url-capture');
    await expect(captureUrl('data:text/html,<h1>hi</h1>', '/tmp')).rejects.toThrow(/scheme/i);
  });

  it('rejects ftp: URLs', async () => {
    const { captureUrl } = await import('../url-capture');
    await expect(captureUrl('ftp://evil.com/file', '/tmp')).rejects.toThrow(/scheme/i);
  });

  it('allows http: URLs', async () => {
    vi.doMock('dns/promises', () => ({
      lookup: vi.fn().mockResolvedValue({ address: '93.184.216.34', family: 4 }),
    }));
    vi.doMock('playwright', () => ({
      chromium: {
        launch: vi.fn().mockResolvedValue({
          newPage: vi.fn().mockResolvedValue({
            goto: vi.fn().mockResolvedValue(undefined),
            screenshot: vi.fn().mockResolvedValue(Buffer.from('PNG')),
            route: vi.fn().mockResolvedValue(undefined),
          }),
          close: vi.fn().mockResolvedValue(undefined),
        }),
      },
    }));
    const { captureUrl } = await import('../url-capture');
    const result = await captureUrl('http://example.com', '/tmp');
    expect(result).toBeTruthy();
  });

  it('allows https: URLs', async () => {
    vi.doMock('dns/promises', () => ({
      lookup: vi.fn().mockResolvedValue({ address: '93.184.216.34', family: 4 }),
    }));
    vi.doMock('playwright', () => ({
      chromium: {
        launch: vi.fn().mockResolvedValue({
          newPage: vi.fn().mockResolvedValue({
            goto: vi.fn().mockResolvedValue(undefined),
            screenshot: vi.fn().mockResolvedValue(Buffer.from('PNG')),
            route: vi.fn().mockResolvedValue(undefined),
          }),
          close: vi.fn().mockResolvedValue(undefined),
        }),
      },
    }));
    const { captureUrl } = await import('../url-capture');
    const result = await captureUrl('https://example.com', '/tmp');
    expect(result).toBeTruthy();
  });
});

// ── SSRF prevention — private IP blocking (P1-4) ────────────────────────────

describe('captureUrl SSRF private IP blocking (P1-4)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
  });

  // Static analysis: url-capture.ts must contain private IP check logic
  it('should contain DNS resolution + private IP check', () => {
    const fs = require('fs');
    const src = fs.readFileSync(
      path.resolve(__dirname, '../url-capture.ts'),
      'utf-8',
    );
    // Must resolve hostname and check against private ranges
    expect(src).toMatch(/dns\.lookup|dns\.resolve|getaddrinfo|lookup/i);
    expect(src).toMatch(/127\.|10\.|172\.|192\.168|::1|0\.0\.0\.0/);
  });

  it('rejects loopback 127.0.0.1', async () => {
    const { captureUrl } = await import('../url-capture');
    await expect(captureUrl('http://127.0.0.1/admin', '/tmp')).rejects.toThrow(/private|internal|loopback|blocked/i);
  });

  it('rejects loopback localhost', async () => {
    // Mock dns/promises to resolve localhost → 127.0.0.1
    vi.doMock('dns/promises', () => ({
      lookup: vi.fn().mockResolvedValue({ address: '127.0.0.1', family: 4 }),
    }));
    const { captureUrl } = await import('../url-capture');
    await expect(captureUrl('http://localhost/admin', '/tmp')).rejects.toThrow(/private|internal|loopback|blocked/i);
  });

  it('rejects private 10.x.x.x', async () => {
    const { captureUrl } = await import('../url-capture');
    await expect(captureUrl('http://10.0.0.1/', '/tmp')).rejects.toThrow(/private|internal|loopback|blocked/i);
  });

  it('rejects private 192.168.x.x', async () => {
    const { captureUrl } = await import('../url-capture');
    await expect(captureUrl('http://192.168.1.1/', '/tmp')).rejects.toThrow(/private|internal|loopback|blocked/i);
  });

  it('rejects private 172.16-31.x.x', async () => {
    const { captureUrl } = await import('../url-capture');
    await expect(captureUrl('http://172.16.0.1/', '/tmp')).rejects.toThrow(/private|internal|loopback|blocked/i);
  });

  it('rejects IPv6 loopback ::1', async () => {
    const { captureUrl } = await import('../url-capture');
    await expect(captureUrl('http://[::1]/', '/tmp')).rejects.toThrow(/private|internal|loopback|blocked/i);
  });

  it('rejects 0.0.0.0', async () => {
    const { captureUrl } = await import('../url-capture');
    await expect(captureUrl('http://0.0.0.0/', '/tmp')).rejects.toThrow(/private|internal|loopback|blocked/i);
  });

  it('rejects 169.254.x.x link-local', async () => {
    const { captureUrl } = await import('../url-capture');
    await expect(captureUrl('http://169.254.169.254/metadata', '/tmp')).rejects.toThrow(/private|internal|loopback|blocked/i);
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
