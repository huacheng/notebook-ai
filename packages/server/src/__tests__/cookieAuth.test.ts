import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { csrfMiddleware } from '../csrf.js';
import {
  authMiddleware,
  handleLogin,
  handleTokenLogin,
  handleVerify,
  handleLogout,
  handleAuthStatus,
} from '../auth.js';

const TEST_TOKEN = 'test-shared-secret-token-for-cookie-tests-1234';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(csrfMiddleware);
  app.use(authMiddleware);
  app.post('/api/auth/login', handleLogin);
  app.post('/api/auth/login-token', handleTokenLogin);
  app.get('/api/auth/verify', handleVerify);
  app.post('/api/auth/logout', handleLogout);
  app.get('/api/auth/status', handleAuthStatus);
  // A protected endpoint to test that the middleware gates non-auth routes
  app.get('/api/projects', (_req, res) => { res.json({ ok: true }); });
  return app;
}

beforeAll(() => {
  process.env['NB_AUTH_TOKEN'] = TEST_TOKEN;
});

afterEach(() => {
  // Reset env tweaks set by individual tests
});

async function loginViaToken(app: express.Express) {
  return request(app).post('/api/auth/login-token')
    .set('Origin', 'http://localhost:3003')
    .send({ token: TEST_TOKEN });
}

describe('Cookie auth flow', () => {
  it('POST /login-token sets HttpOnly Lax cookie', async () => {
    const r = await loginViaToken(makeApp());
    expect(r.status).toBe(200);
    const raw = r.headers['set-cookie'];
    const sc = (Array.isArray(raw) ? raw : [raw ?? '']).join(';').toLowerCase();
    expect(sc).toContain('nb-auth-token=');
    expect(sc).toContain('httponly');
    expect(sc).toContain('samesite=lax');
  });

  it('Cookie carries auth on subsequent GET (no Bearer needed)', async () => {
    const app = makeApp();
    const login = await loginViaToken(app);
    const cookie = login.headers['set-cookie'];
    expect(cookie).toBeTruthy();
    const r = await request(app).get('/api/auth/verify').set('Cookie', cookie);
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });

  it('Bearer header still works (backward compat)', async () => {
    const app = makeApp();
    const login = await loginViaToken(app);
    const r = await request(app).get('/api/auth/verify')
      .set('Authorization', `Bearer ${login.body.token}`);
    expect(r.status).toBe(200);
  });

  it('Cookie takes precedence over Bearer when both present', async () => {
    const app = makeApp();
    const login = await loginViaToken(app);
    const cookie = login.headers['set-cookie'];
    const r = await request(app).get('/api/auth/verify')
      .set('Cookie', cookie)
      .set('Authorization', 'Bearer wrong-token-but-ignored');
    expect(r.status).toBe(200);
  });

  it('Invalid cookie response includes clearCookie header', async () => {
    const app = makeApp();
    const r = await request(app).get('/api/projects')
      .set('Cookie', 'nb-auth-token=this-token-is-not-valid');
    expect(r.status).toBe(401);
    const raw2 = r.headers['set-cookie'];
    const sc = (Array.isArray(raw2) ? raw2 : [raw2 ?? '']).join(';');
    expect(sc).toContain('nb-auth-token=;');
  });

  it('login-token JSON response keeps token field for compat', async () => {
    const r = await loginViaToken(makeApp());
    expect(r.body.token).toBeDefined();
    expect(typeof r.body.token).toBe('string');
  });

  it('No-auth GET to protected route returns 401 without setting Set-Cookie', async () => {
    const app = makeApp();
    const r = await request(app).get('/api/projects');
    expect(r.status).toBe(401);
    expect(r.headers['set-cookie']).toBeUndefined();
  });

  it('Unauthenticated POST /login-token does not require CSRF Origin', async () => {
    // login endpoints are in the auth-middleware whitelist, but CSRF middleware
    // also gives a free pass when there's no auth cookie yet (first login).
    const app = makeApp();
    const r = await request(app).post('/api/auth/login-token')
      .send({ token: TEST_TOKEN });
    expect(r.status).toBe(200);
  });
});
