import type { StateCreator } from 'zustand';
import type { NotebookStore } from './types';

export const createAuthSlice: StateCreator<NotebookStore, [], [], Pick<NotebookStore,
  | 'authToken' | 'authRequired' | 'authMode' | 'authError' | 'authRetryAfter' | 'authLoading' | 'authVerifying'
  | 'preflightAlerts' | 'preflightDismissed'
  | 'checkAuthStatus' | 'login' | 'loginWithToken' | 'logout' | 'register' | 'clearAuthError'
  | 'fetchPreflight' | 'dismissPreflightAlert' | 'installCron'
>> = (set, get) => ({
  authToken: sessionStorage.getItem('nb-auth-token'),
  authRequired: null,
  authMode: null,
  authError: null,
  authRetryAfter: 0,
  authLoading: false,
  authVerifying: true,
  preflightAlerts: [],
  preflightDismissed: new Set<string>(),

  async checkAuthStatus() {
    set({ authVerifying: true });
    try {
      const res = await fetch('/api/auth/status');
      const data = (await res.json()) as { authEnabled: boolean; authMode?: 'token' | 'password' };
      set({ authRequired: data.authEnabled, authMode: data.authMode ?? 'password' });

      if (data.authEnabled) {
        const token = get().authToken;
        if (token) {
          const check = await fetch('/api/auth/verify', {
            headers: { 'Authorization': `Bearer ${token}` },
          });
          if (!check.ok) {
            sessionStorage.removeItem('nb-auth-token');
            set({ authToken: null });
          }
        }
      }
    } catch {
      set({ authRequired: false });
    } finally {
      set({ authVerifying: false });
    }
  },

  async login(email: string, password: string) {
    set({ authLoading: true, authError: null });
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error: string; retryAfter?: number };
        set({ authError: data.error, authRetryAfter: data.retryAfter ?? 0, authLoading: false });
        return;
      }
      const data = (await res.json()) as { token: string };
      sessionStorage.setItem('nb-auth-token', data.token);
      set({ authToken: data.token, authError: null, authRetryAfter: 0, authLoading: false, authVerifying: false });
    } catch {
      set({ authError: 'Failed to connect to server.', authLoading: false });
    }
  },

  async loginWithToken(token: string) {
    set({ authLoading: true, authError: null });
    try {
      const res = await fetch('/api/auth/login-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error: string; retryAfter?: number };
        set({ authError: data.error, authRetryAfter: data.retryAfter ?? 0, authLoading: false });
        return;
      }
      const data = (await res.json()) as { token: string };
      sessionStorage.setItem('nb-auth-token', data.token);
      set({ authToken: data.token, authError: null, authRetryAfter: 0, authLoading: false, authVerifying: false });
    } catch {
      set({ authError: 'Failed to connect to server.', authLoading: false });
    }
  },

  logout() {
    sessionStorage.removeItem('nb-auth-token');
    set({ authToken: null });
    get().disconnectWebSocket();
  },

  async register(username: string, password: string, inviteCode: string): Promise<boolean> {
    set({ authLoading: true, authError: null });
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, inviteCode }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error: string; retryAfter?: number };
        set({ authError: data.error, authRetryAfter: data.retryAfter ?? 0, authLoading: false });
        return false;
      }
      set({ authError: null, authRetryAfter: 0, authLoading: false });
      return true;
    } catch {
      set({ authError: 'Failed to connect to server.', authLoading: false });
      return false;
    }
  },

  clearAuthError() {
    set({ authError: null, authRetryAfter: 0 });
  },

  async fetchPreflight() {
    try {
      const token = get().authToken;
      const res = await fetch('/api/system/preflight', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const data = (await res.json()) as { alerts: Array<{ id: string; severity: string; message: string; action?: string }> };
        set({ preflightAlerts: data.alerts });
      }
    } catch { /* ignore */ }
  },

  dismissPreflightAlert(id: string) {
    const dismissed = new Set(get().preflightDismissed);
    dismissed.add(id);
    set({ preflightDismissed: dismissed });
  },

  async installCron() {
    try {
      const token = get().authToken;
      const res = await fetch('/api/system/install-cron', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        // Refresh preflight to clear the alert
        get().fetchPreflight();
      }
    } catch { /* ignore */ }
  },
});
