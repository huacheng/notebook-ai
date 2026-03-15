import { Router, type IRouter, type Request, type Response } from 'express';
import { handleLogin, handleTokenLogin, handleRegister, handleAuthStatus, handleVerify, handleWsTicket, handleLogout } from '../auth.js';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import pty from 'node-pty';

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

  // GET /api/auth/claude/status — current Claude auth status
  router.get('/status', async (_req: Request, res: Response) => {
    try {
      const { stdout } = await execFile('claude', ['auth', 'status'], { timeout: 10000 });
      res.json(JSON.parse(stdout));
    } catch (err) {
      res.json({ loggedIn: false, error: String(err) });
    }
  });

  // ── PTY-based interactive login ───────────────────────────────────────
  // Uses node-pty to drive Claude's interactive /login TUI:
  //   1. Spawn claude → wait for prompt → send /login
  //   2. Wait for menu → send Enter (option 1) or arrow+Enter (option 2/3)
  //   3. Parse URL from output → return to frontend
  //   4. Wait for "Paste code here" → frontend submits code via login-code
  //   5. Process completes → poll returns success

  let loginPty: pty.IPty | null = null;
  let loginOutput = '';
  let loginResult: { success: boolean; status?: unknown; error?: string } | null = null;
  let loginPhase: 'starting' | 'menu' | 'url' | 'paste' | 'done' = 'starting';
  let activeIdleTimer: ReturnType<typeof setTimeout> | null = null;

  function killLogin() {
    if (loginPty) {
      try { loginPty.kill(); } catch { /* ignore */ }
      loginPty = null;
    }
    if (activeIdleTimer) {
      clearTimeout(activeIdleTimer);
      activeIdleTimer = null;
    }
    loginOutput = '';
    loginPhase = 'starting';
  }

  // POST /api/auth/claude/login — start interactive login
  // Body: { method: 'claude' | 'console' | 'sso' }
  router.post('/login', (req: Request, res: Response) => {
    killLogin();
    loginResult = null;

    const method = (req.body as { method?: string })?.method ?? 'claude';

    // Determine which menu option to select (1=Claude, 2=Console, 3=3rd-party)
    const optionIndex = method === 'console' ? 2 : method === 'sso' ? 3 : 1;

    const proc = pty.spawn('claude', ['--dangerously-skip-permissions'], {
      env: { ...process.env, CLAUDECODE: '', TERM: 'xterm-256color' },
      cols: 200,
      rows: 50,
    });
    loginPty = proc;
    loginOutput = '';
    loginPhase = 'starting';

    let responded = false;
    let sentLogin = false;
    let sentSelect = false;
    // activeIdleTimer is tracked at module scope (activeIdleTimer) for killLogin() cleanup

    // Strip ANSI escape sequences for text matching
    const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');

    proc.onData((data: string) => {
      loginOutput += data;
      const clean = stripAnsi(loginOutput);

      // Phase 1: detect prompt '>', send /login
      if (!sentLogin && loginOutput.includes('>')) {
        sentLogin = true;
        loginPhase = 'menu';
        setTimeout(() => proc.write('/login\r'), 500);
      }

      // Phase 2: detect menu, send selection
      // Ink strips spaces in ANSI output, so match without spaces
      if (sentLogin && !sentSelect && clean.includes('loginmethod')) {
        sentSelect = true;
        setTimeout(() => {
          // Option 1 is pre-selected (❯). For option 2/3, press down arrow first.
          for (let i = 1; i < optionIndex; i++) {
            proc.write('\x1b[B'); // Arrow down
          }
          setTimeout(() => proc.write('\r'), 200); // Enter
        }, 1000);
      }

      // Phase 3: detect URL (use stripped output to avoid ANSI in URL)
      const urlMatch = clean.match(/(https:\/\/\S+authorize\S+)/);
      if (urlMatch && !responded) {
        responded = true;
        loginPhase = 'url';
        clearTimeout(urlTimer);
        // Timeout 2: 1 minute to complete auth after URL is shown
        activeIdleTimer = setTimeout(() => {
          loginResult = { success: false, error: 'Login timed out — no auth code submitted within 1 minute.' };
          killLogin();
        }, 60 * 1000);
        res.json({ url: urlMatch[1] });
      }

      // Phase 4: detect paste prompt
      if (clean.includes('Pastecodehereifprompted')) {
        loginPhase = 'paste';
      }
    });

    proc.onExit(async ({ exitCode }) => {
      clearTimeout(urlTimer);
      if (activeIdleTimer) clearTimeout(activeIdleTimer);
      if (loginPty === proc) loginPty = null;
      loginPhase = 'done';
      if (!responded) {
        responded = true;
        res.status(500).json({ error: 'Login process exited unexpectedly' });
      } else {
        // Store result for polling
        if (exitCode === 0) {
          try {
            const { stdout } = await execFile('claude', ['auth', 'status'], { timeout: 10000 });
            loginResult = { success: true, status: JSON.parse(stdout) };
          } catch {
            loginResult = { success: true };
          }
        } else {
          loginResult = { success: false, error: 'Login failed (exit code ' + exitCode + ')' };
        }
      }
    });

    // Timeout 1: 30s to reach URL (startup phase)
    const urlTimer = setTimeout(() => {
      if (!responded) {
        responded = true;
        killLogin();
        res.status(500).json({ error: 'Login timed out waiting for auth URL' });
      }
    }, 30000);
  });

  // GET /api/auth/claude/login-poll — check if login completed
  router.get('/login-poll', (_req: Request, res: Response) => {
    if (loginResult) {
      const result = loginResult;
      loginResult = null;
      res.json(result);
      return;
    }
    if (!loginPty) {
      res.json({ pending: false, error: 'No login in progress' });
      return;
    }
    res.json({ pending: true, phase: loginPhase });
  });

  // POST /api/auth/claude/login-code — submit auth code to PTY
  // Body: { code: string }
  router.post('/login-code', (req: Request, res: Response) => {
    const code = (req.body as { code?: string })?.code;
    if (!code) {
      res.status(400).json({ error: 'Missing auth code' });
      return;
    }
    if (!loginPty) {
      res.status(400).json({ error: 'No login process running' });
      return;
    }
    // Write code to PTY — ink's "Paste code here" reads from terminal input
    loginPty.write(code.trim() + '\r');
    res.json({ ok: true });
  });

  // POST /api/auth/claude/login-cancel
  router.post('/login-cancel', (_req: Request, res: Response) => {
    killLogin();
    loginResult = null;
    res.json({ ok: true });
  });

  // POST /api/auth/claude/logout
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
