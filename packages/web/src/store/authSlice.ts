import type { StateCreator } from 'zustand';
import type { NotebookStore } from './types';

export const createAuthSlice: StateCreator<NotebookStore, [], [], Pick<NotebookStore,
  | 'userId' | 'email'
  | 'authRequired' | 'authMode' | 'authError' | 'authRetryAfter' | 'authLoading' | 'authVerifying'
  | 'preflightAlerts' | 'preflightDismissed'
  | 'checkAuthStatus' | 'login' | 'loginWithToken' | 'logout' | 'register' | 'clearAuthError'
  | 'fetchPreflight' | 'dismissPreflightAlert' | 'installCron'
>> = (set, get) => ({
  userId: null,
  email: null,
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
        const check = await fetch('/api/auth/verify', {
          credentials: 'same-origin',
        });
        if (!check.ok) {
          set({ userId: null, email: null });
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
        credentials: 'same-origin',
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error: string; retryAfter?: number };
        set({ authError: data.error, authRetryAfter: data.retryAfter ?? 0, authLoading: false });
        return;
      }
      const data = (await res.json()) as { userId: string; email: string; token: string };
      set({ userId: data.userId, email: data.email, authError: null, authRetryAfter: 0, authLoading: false, authVerifying: false });
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
        credentials: 'same-origin',
        body: JSON.stringify({ token }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error: string; retryAfter?: number };
        set({ authError: data.error, authRetryAfter: data.retryAfter ?? 0, authLoading: false });
        return;
      }
      const data = (await res.json()) as { userId: string; email: string; token: string };
      set({ userId: data.userId, email: data.email, authError: null, authRetryAfter: 0, authLoading: false, authVerifying: false });
    } catch {
      set({ authError: 'Failed to connect to server.', authLoading: false });
    }
  },

  logout() {
    fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
    }).catch(() => { /* ignore */ });
    set({ userId: null, email: null });
    get().disconnectWebSocket();
  },

  async register(username: string, password: string, inviteCode: string): Promise<boolean> {
    set({ authLoading: true, authError: null });
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
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
      const res = await fetch('/api/system/preflight', {
        credentials: 'same-origin',
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
      const res = await fetch('/api/system/install-cron', {
        method: 'POST',
        credentials: 'same-origin',
      });
      if (res.ok) {
        // Refresh preflight to clear the alert
        get().fetchPreflight();
      }
    } catch { /* ignore */ }
  },
});
