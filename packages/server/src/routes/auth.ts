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

    proc.on('close', async (exitCode) => {
      clearTimeout(timer);
      if (loginProc === proc) loginProc = null;
      if (!responded) {
        responded = true;
        res.status(500).json({ error: 'Login process exited unexpectedly', output });
      } else {
        // URL was already returned — store result for polling
        if (exitCode === 0) {
          try {
            const { stdout } = await execFile('claude', ['auth', 'status'], { timeout: 10000 });
            loginResult = { success: true, status: JSON.parse(stdout) };
          } catch {
            loginResult = { success: true };
          }
        } else {
          loginResult = { success: false, error: output || 'Login failed' };
        }
      }
    });
  });

  // Track login process completion
  let loginResult: { success: boolean; status?: unknown; error?: string } | null = null;

  // GET /api/auth/login-poll — check if login process completed
  router.get('/login-poll', async (_req: Request, res: Response) => {
    if (loginResult) {
      const result = loginResult;
      loginResult = null;
      res.json(result);
      return;
    }
    if (!loginProc) {
      // No process and no result — nothing is running
      res.json({ pending: false, error: 'No login in progress' });
      return;
    }
    // Process still running
    res.json({ pending: true });
  });

  // POST /api/auth/login-code — submit auth code to waiting process stdin
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
    // Write code to process stdin — process reads it at "Paste code here if prompted >"
    loginProc.stdin?.write(code.trim() + '\n');
    // Don't end stdin — let process decide when to exit
    // Result will be available via login-poll
    res.json({ ok: true });
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
