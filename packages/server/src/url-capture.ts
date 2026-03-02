import * as path from 'path';
import * as fs from 'fs/promises';
import * as dns from 'dns/promises';

/** D4: Simple counting semaphore to limit concurrent browser instances */
const MAX_CONCURRENT = 3;
let activeBrowsers = 0;
const waitQueue: Array<() => void> = [];

function acquire(): Promise<void> {
  if (activeBrowsers < MAX_CONCURRENT) {
    activeBrowsers++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    waitQueue.push(() => { activeBrowsers++; resolve(); });
  });
}

function release(): void {
  activeBrowsers--;
  const next = waitQueue.shift();
  if (next) next();
}

/** D2: Check if an IP address is private/internal (SSRF prevention) */
function isPrivateIP(ip: string): boolean {
  // IPv4-mapped IPv6 (::ffff:x.x.x.x) — strip prefix and recurse
  if (ip.startsWith('::ffff:') || ip.startsWith('::FFFF:')) {
    return isPrivateIP(ip.slice(7));
  }
  // IPv4
  if (ip === '0.0.0.0') return true;
  if (ip.startsWith('127.')) return true;           // 127.0.0.0/8 loopback
  if (ip.startsWith('10.')) return true;             // 10.0.0.0/8
  if (ip.startsWith('192.168.')) return true;        // 192.168.0.0/16
  if (ip.startsWith('169.254.')) return true;        // 169.254.0.0/16 link-local
  // 172.16.0.0 – 172.31.255.255
  if (ip.startsWith('172.')) {
    const second = parseInt(ip.split('.')[1], 10);
    if (second >= 16 && second <= 31) return true;
  }
  // IPv6
  if (ip === '::1') return true;                     // loopback
  if (ip.startsWith('fe80:')) return true;           // link-local
  if (ip.startsWith('fc') || ip.startsWith('fd')) return true; // unique-local
  return false;
}

/**
 * Captures a screenshot of a URL using Playwright.
 * Returns the absolute path to the saved PNG file.
 */
export async function captureUrl(url: string, outputDir: string): Promise<string> {
  // D2: SSRF prevention — only allow http/https schemes
  const ALLOWED_SCHEMES = ['http:', 'https:'];
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: unable to parse`);
  }
  if (!ALLOWED_SCHEMES.includes(parsed.protocol)) {
    throw new Error(`Disallowed URL scheme: ${parsed.protocol} — only http/https allowed`);
  }

  // D2: SSRF prevention — resolve hostname and block private/internal IPs
  const hostname = parsed.hostname.replace(/^\[|\]$/g, ''); // strip IPv6 brackets
  try {
    const { address } = await dns.lookup(hostname);
    if (isPrivateIP(address)) {
      throw new Error(`Blocked private/internal IP address: ${address}`);
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('Blocked private')) throw err;
    // For IP literals, check directly
    if (isPrivateIP(hostname)) {
      throw new Error(`Blocked private/internal IP address: ${hostname}`);
    }
    // DNS resolution failure — let Playwright handle it downstream
  }

  // Dynamic import — playwright is an optional dependency
  const { chromium } = await import('playwright');

  await acquire();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

    // D2: Intercept ALL network requests to block DNS rebinding attacks.
    // The pre-flight dns.lookup only checks the initial URL; page JS or redirects
    // could resolve to a different (private) IP via DNS rebinding.
    await page.route('**/*', async (route) => {
      try {
        const reqUrl = new URL(route.request().url());
        if (!ALLOWED_SCHEMES.includes(reqUrl.protocol)) {
          await route.abort('blockedbyclient');
          return;
        }
        const reqHost = reqUrl.hostname.replace(/^\[|\]$/g, '');
        // Resolve and check for private IPs
        try {
          const { address } = await dns.lookup(reqHost);
          if (isPrivateIP(address)) {
            await route.abort('blockedbyclient');
            return;
          }
        } catch {
          if (isPrivateIP(reqHost)) {
            await route.abort('blockedbyclient');
            return;
          }
        }
        await route.continue();
      } catch {
        // Route may already be handled; ignore
        try { await route.abort(); } catch { /* noop */ }
      }
    });

    await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });

    const screenshotDir = path.join(outputDir, '.screenshots');
    await fs.mkdir(screenshotDir, { recursive: true });

    const filename = `screenshot-${Date.now()}.png`;
    const filePath = path.join(screenshotDir, filename);

    await page.screenshot({ path: filePath, fullPage: true });
    return filePath;
  } finally {
    await browser.close();
    release();
  }
}
