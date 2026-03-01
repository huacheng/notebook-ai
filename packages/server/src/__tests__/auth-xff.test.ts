import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * D2-3: X-Forwarded-For proxy validation
 *
 * getClientIp() should only trust XFF header when TRUST_PROXY env var is set.
 * Without TRUST_PROXY, always use req.socket.remoteAddress to prevent
 * attackers from spoofing their IP to bypass rate limiting.
 */

describe('getClientIp — XFF proxy validation (D2-3)', () => {
  let getClientIp: (req: any) => string;

  function makeReq(xff: string | undefined, remoteAddress: string) {
    return {
      headers: xff !== undefined ? { 'x-forwarded-for': xff } : {},
      socket: { remoteAddress },
    };
  }

  describe('when TRUST_PROXY is NOT set', () => {
    beforeEach(async () => {
      vi.resetModules();
      delete process.env['TRUST_PROXY'];
      const mod = await import('../auth.js');
      getClientIp = mod.getClientIp;
    });

    it('should ignore XFF header and use remoteAddress', () => {
      const req = makeReq('1.2.3.4', '127.0.0.1');
      expect(getClientIp(req as any)).toBe('127.0.0.1');
    });

    it('should use remoteAddress even with multiple XFF values', () => {
      const req = makeReq('10.0.0.1, 10.0.0.2', '192.168.1.1');
      expect(getClientIp(req as any)).toBe('192.168.1.1');
    });

    it('should return "unknown" when remoteAddress is undefined', () => {
      const req = { headers: {}, socket: { remoteAddress: undefined } };
      expect(getClientIp(req as any)).toBe('unknown');
    });
  });

  describe('when TRUST_PROXY is set', () => {
    beforeEach(async () => {
      vi.resetModules();
      process.env['TRUST_PROXY'] = '1';
      const mod = await import('../auth.js');
      getClientIp = mod.getClientIp;
    });

    afterEach(() => {
      delete process.env['TRUST_PROXY'];
    });

    it('should use XFF header first IP when present', () => {
      const req = makeReq('1.2.3.4', '127.0.0.1');
      expect(getClientIp(req as any)).toBe('1.2.3.4');
    });

    it('should use first IP from comma-separated XFF', () => {
      const req = makeReq('10.0.0.1, 10.0.0.2, 10.0.0.3', '127.0.0.1');
      expect(getClientIp(req as any)).toBe('10.0.0.1');
    });

    it('should fall back to remoteAddress when XFF is absent', () => {
      const req = makeReq(undefined, '192.168.1.1');
      expect(getClientIp(req as any)).toBe('192.168.1.1');
    });
  });
});
