import * as path from 'path';
import * as fs from 'fs/promises';

/**
 * Captures a screenshot of a URL using Playwright.
 * Returns the absolute path to the saved PNG file.
 */
export async function captureUrl(url: string, outputDir: string): Promise<string> {
  // Dynamic import — playwright is an optional dependency
  const { chromium } = await import('playwright');

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });

    const screenshotDir = path.join(outputDir, '.screenshots');
    await fs.mkdir(screenshotDir, { recursive: true });

    const filename = `screenshot-${Date.now()}.png`;
    const filePath = path.join(screenshotDir, filename);

    await page.screenshot({ path: filePath, fullPage: true });
    return filePath;
  } finally {
    await browser.close();
  }
}
