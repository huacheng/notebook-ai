import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const src = readFileSync(
  path.resolve(__dirname, '../url-capture.ts'),
  'utf-8',
);

/**
 * P0-1: DNS rebinding bypass — the initial dns.lookup check can be bypassed
 * because Playwright does its own DNS resolution. Must intercept all page
 * network requests via page.route() and block private IPs at the browser level.
 */
describe('url_capture DNS rebinding prevention (P0-1)', () => {
  it('should use page.route to intercept requests and check IPs', () => {
    // page.route must appear before page.goto
    const routeIdx = src.indexOf('page.route');
    const gotoIdx = src.indexOf('page.goto');
    expect(routeIdx).toBeGreaterThan(-1);
    expect(gotoIdx).toBeGreaterThan(-1);
    expect(routeIdx).toBeLessThan(gotoIdx);
  });

  it('should check isPrivateIP inside the route handler', () => {
    // The route handler block should reference isPrivateIP
    const routeIdx = src.indexOf('page.route');
    const gotoIdx = src.indexOf('page.goto');
    const routeBlock = src.slice(routeIdx, gotoIdx);
    expect(routeBlock).toContain('isPrivateIP');
  });
});
