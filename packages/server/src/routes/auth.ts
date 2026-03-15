import { Router, type IRouter, type Request, type Response } from 'express';
import { handleLogin, handleTokenLogin, handleRegister, handleAuthStatus, handleVerify, handleWsTicket, handleLogout } from '../auth.js';
import { spawn, execFile as execFileCb } from 'child_process';
import { promisify } from 'util';

const execFile = promisify(execFileCb);

export function createAuthRouter(): IRouter {
  const router = Router();
  router.post('/login', handleLogin);
  router.post('/login-token', handleTokenLogin);
  router.post('/register', handleRegister);
  router.post('/logout', handleLogout);
  router.get('/status', handleAuthStatus);
  router.get('/verify', handleVerify);
  router.post('/ws-ticket', handleWsTicket);
  return router;
}

// ── Claude CLI auth (requires authentication) ─────────────────────────

export function createClaudeAuthRouter(): IRouter {
  const router = Router();

  // GET /api/auth/status — current Claude auth status
  router.get('/status', async (_req: Request, res: Response) => {
    try {
      const { stdout } = await execFile('claude', ['auth', 'status'], { timeout: 10000 });
      res.json(JSON.parse(stdout));
    } catch (err) {
      res.json({ loggedIn: false, error: String(err) });
    }
  });

  // Singleton login process — only one login at a time
  let loginProc: ReturnType<typeof spawn> | null = null;

  // POST /api/auth/login — start login, returns auth URL
  // Body: { method: 'claude' | 'console' | 'sso' }
  router.post('/login', (req: Request, res: Response) => {
    // Kill any previous login process
    if (loginProc) {
      loginProc.kill();
      loginProc = null;
    }

    const method = (req.body as { method?: string })?.method ?? 'claude';
    const args = ['auth', 'login'];
    if (method === 'sso') args.push('--sso');

    const proc = spawn('claude', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, BROWSER: 'echo' }, // Prevent opening browser
    });
    loginProc = proc;

    let output = '';
    let responded = false;

    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      // Parse auth URL from output
      const urlMatch = output.match(/visit:\s*(https:\/\/\S+)/);
      if (urlMatch && !responded) {
        responded = true;
        res.json({ url: urlMatch[1] });
      }
    };

    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', onData);

    // Timeout after 15s if no URL found
    const timer = setTimeout(() => {
      if (!responded) {
        responded = true;
        proc.kill();
        loginProc = null;
        res.status(500).json({ error: 'Login process did not produce auth URL' });
      }
    }, 15000);

    proc.on('close', () => {
      clearTimeout(timer);
      if (loginProc === proc) loginProc = null;
      if (!responded) {
        responded = true;
        res.status(500).json({ error: 'Login process exited unexpectedly', output });
      }
    });
  });

  // POST /api/auth/login-code — submit auth code to waiting process
  // Body: { code: string }
  router.post('/login-code', (req: Request, res: Response) => {
    const code = (req.body as { code?: string })?.code;
    if (!code) {
      res.status(400).json({ error: 'Missing auth code' });
      return;
    }
    if (!loginProc) {
      res.status(400).json({ error: 'No login process running' });
      return;
    }

    const proc = loginProc;
    let output = '';

    // Collect remaining output after submitting code
    const onData = (chunk: Buffer) => { output += chunk.toString(); };
    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', onData);

    proc.on('close', async (exitCode) => {
      if (loginProc === proc) loginProc = null;
      if (exitCode === 0) {
        // Fetch fresh status
        try {
          const { stdout } = await execFile('claude', ['auth', 'status'], { timeout: 10000 });
          res.json({ success: true, status: JSON.parse(stdout) });
        } catch {
          res.json({ success: true, output });
        }
      } else {
        res.json({ success: false, error: output || 'Login failed' });
      }
    });

    // Write auth code to stdin
    proc.stdin?.write(code + '\n');
    proc.stdin?.end();
  });

  // POST /api/auth/login-cancel — kill the login process
  router.post('/login-cancel', (_req: Request, res: Response) => {
    if (loginProc) {
      loginProc.kill();
      loginProc = null;
    }
    res.json({ ok: true });
  });

  // POST /api/auth/logout
  router.post('/logout', async (_req: Request, res: Response) => {
    try {
      await execFile('claude', ['auth', 'logout'], { timeout: 10000 });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  return router;
}
